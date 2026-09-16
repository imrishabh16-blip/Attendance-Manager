import type { SessionReportRow } from '@/lib/export'

export interface RawSessionRecord {
  article_id:      string
  attendance_date: string
  checked_in_at:   string
  checked_out_at:  string | null
  assignment_id:   string
  article_name:    string
  client_name:     string
  work_type:       string
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000
}

// One inactivity-split slot's aggregates — the part of session/slot
// derivation that's identical regardless of what the records were grouped
// by (assignment, client, ...). Deliberately excludes any identity/label
// fields (client_name, work_type, session/slot number) since those are
// meaningful only to the caller's grouping choice, not to this shared math.
interface DateSlot {
  articles_count:  number
  article_names:   string
  attendance_days: number
  total_hours:     number
  status:          'Active' | 'Completed'
  first_date:      string
  last_date:       string
}

// Splits one group's attendance dates into slots on a >7-day inactivity gap,
// then aggregates each slot (distinct articles, total hours, span, status).
// Shared by deriveSessionReport (grouped by assignment) and
// deriveClientWorkDuration (grouped by client) so both apply exactly the
// same inactivity/completion rule — only the grouping key upstream differs.
function computeSlots(groupRecords: RawSessionRecord[], todayIST: string): DateSlot[] {
  // Distinct attendance dates, sorted ascending, split into slots
  const dateSet     = new Set(groupRecords.map(r => r.attendance_date))
  const sortedDates = [...dateSet].sort()

  const buckets: string[][] = []
  let current = [sortedDates[0]]
  for (let i = 1; i < sortedDates.length; i++) {
    if (daysBetween(sortedDates[i - 1], sortedDates[i]) > 7) {
      buckets.push(current)
      current = [sortedDates[i]]
    } else {
      current.push(sortedDates[i])
    }
  }
  buckets.push(current)

  return buckets.map(bucketDates => {
    const bucketDateSet = new Set(bucketDates)
    const bucketRecords = groupRecords.filter(r => bucketDateSet.has(r.attendance_date))

    const articleMap = new Map<string, string>()
    let totalHours = 0

    for (const r of bucketRecords) {
      if (!articleMap.has(r.article_id)) {
        articleMap.set(r.article_id, r.article_name)
      }
      if (r.checked_out_at) {
        totalHours +=
          (new Date(r.checked_out_at).getTime() - new Date(r.checked_in_at).getTime()) /
          3_600_000
      }
    }

    const firstDate = bucketDates[0]
    const lastDate  = bucketDates[bucketDates.length - 1]

    return {
      articles_count:  articleMap.size,
      article_names:   [...articleMap.values()].filter(Boolean).sort().join(', '),
      attendance_days: bucketDates.length,
      total_hours:     Math.round(totalHours * 10) / 10,
      status:          (daysBetween(lastDate, todayIST) <= 7 ? 'Active' : 'Completed') as 'Active' | 'Completed',
      first_date:      firstDate,
      last_date:       lastDate,
    }
  })
}

// Derives Session Report rows from raw attendance records, splitting each
// assignment's attendance into sessions on a 7-day inactivity gap.
//
// This is the single source of truth for session derivation — both the JSON
// preview and the Excel export call this function against the same query
// result, so the two views can never diverge. Grouping by assignment_id means
// the exact same logic produces one assignment's sessions (assignment_id
// filter applied upstream) or every assignment's sessions (no filter) with no
// branching here.
export function deriveSessionReport(records: RawSessionRecord[], todayIST: string): SessionReportRow[] {
  const byAssignment = new Map<string, RawSessionRecord[]>()
  for (const r of records) {
    const list = byAssignment.get(r.assignment_id) ?? []
    list.push(r)
    byAssignment.set(r.assignment_id, list)
  }

  const rows: SessionReportRow[] = []

  for (const assignmentRecords of byAssignment.values()) {
    const { client_name, work_type } = assignmentRecords[0]
    const assignmentLabel = `${client_name} — ${work_type}`

    computeSlots(assignmentRecords, todayIST).forEach((slot, idx) => {
      rows.push({
        assignment_label: assignmentLabel,
        client_name,
        work_type,
        session_number:   `S${idx + 1}`,
        ...slot,
      })
    })
  }

  // Group by client/work type for readability across "All Assignments".
  // Array.prototype.sort is stable, so each assignment's own S1, S2, ...
  // order (already chronological from the push order above) is preserved.
  rows.sort((a, b) =>
    a.client_name.localeCompare(b.client_name) ||
    a.work_type.localeCompare(b.work_type)
  )

  return rows
}

export interface ClientWorkSlot {
  client_name:     string
  slot_number:     string
  articles_count:  number
  article_names:   string
  attendance_days: number
  total_hours:     number
  status:          'Active' | 'Completed'
  first_date:      string
  last_date:       string
}

// Derives Client Work Duration rows — the same slot/inactivity machinery as
// deriveSessionReport above, but slot continuity is keyed by CLIENT alone
// rather than by assignment (client + work type). Articles sometimes punch
// into the wrong department/assignment for a client; grouping by client only
// keeps that from fragmenting one client's work history into unrelated
// slots. Work type is intentionally not part of the identity or the output
// here — a client's slot can span multiple work types.
export function deriveClientWorkDuration(records: RawSessionRecord[], todayIST: string): ClientWorkSlot[] {
  const byClient = new Map<string, RawSessionRecord[]>()
  for (const r of records) {
    const list = byClient.get(r.client_name) ?? []
    list.push(r)
    byClient.set(r.client_name, list)
  }

  const rows: ClientWorkSlot[] = []

  for (const clientRecords of byClient.values()) {
    const { client_name } = clientRecords[0]

    computeSlots(clientRecords, todayIST).forEach((slot, idx) => {
      rows.push({
        client_name,
        slot_number: `WS${idx + 1}`,
        ...slot,
      })
    })
  }

  // Management-facing order: Active slots first (oldest First Punch first
  // within each), then Completed slots (oldest First Punch first within
  // each) — surfaces the longest-running engagements first. Client name is
  // only a tie-breaker when status and first_date both match. This does not
  // affect slot_number, which was already assigned chronologically above.
  rows.sort((a, b) =>
    (a.status === b.status ? 0 : a.status === 'Active' ? -1 : 1) ||
    a.first_date.localeCompare(b.first_date) ||
    a.client_name.localeCompare(b.client_name)
  )

  return rows
}

export interface ArticleEngagementRow {
  article_id:       string
  article_name:     string
  client_name:      string
  days_punched:     number
  hours_punched:    number
  first_attendance: string
  last_attendance:  string
}

// Derives Article Engagement Duration rows — one cumulative row per
// (article, client) pair across all history. Deliberately does NOT go
// through computeSlots: there is no inactivity-gap splitting and no
// Active/Completed status here, because this report answers "how much has
// this Article engaged with this Client in total", not "what are the
// discrete work sessions". Grouping is keyed by article_id + client_name
// (never assignment_id), so the same Article working the same Client under
// different assignments/work types/departments still collapses into a
// single row — mirrors the identity rule deriveClientWorkDuration already
// applies at the client-only level.
export function deriveArticleEngagementDuration(records: RawSessionRecord[]): ArticleEngagementRow[] {
  const byArticleClient = new Map<string, RawSessionRecord[]>()
  for (const r of records) {
    const key = `${r.article_id}::${r.client_name}`
    const list = byArticleClient.get(key) ?? []
    list.push(r)
    byArticleClient.set(key, list)
  }

  const rows: ArticleEngagementRow[] = []

  for (const groupRecords of byArticleClient.values()) {
    const { article_id, article_name, client_name } = groupRecords[0]

    const dateSet = new Set(groupRecords.map(r => r.attendance_date))
    let totalHours = 0
    for (const r of groupRecords) {
      if (r.checked_out_at) {
        totalHours +=
          (new Date(r.checked_out_at).getTime() - new Date(r.checked_in_at).getTime()) /
          3_600_000
      }
    }

    const sortedDates = [...dateSet].sort()

    rows.push({
      article_id,
      article_name,
      client_name,
      days_punched:     dateSet.size,
      hours_punched:    Math.round(totalHours * 10) / 10,
      first_attendance: sortedDates[0],
      last_attendance:  sortedDates[sortedDates.length - 1],
    })
  }

  rows.sort((a, b) =>
    a.client_name.localeCompare(b.client_name) ||
    a.article_name.localeCompare(b.article_name)
  )

  return rows
}
