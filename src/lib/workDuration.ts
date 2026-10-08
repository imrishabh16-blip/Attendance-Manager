// One attendance record, flattened with its article and client names. Shared
// input shape for Client Work Duration and Client Engagement — see
// lib/attendanceRecords.ts for the query that produces it.
export interface RawSessionRecord {
  article_id:      string
  attendance_date: string
  checked_in_at:   string
  checked_out_at:  string | null
  article_name:    string
  client_name:     string
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000
}

// One inactivity-split slot's aggregates — everything derived from a client's
// attendance dates, independent of the identity/label fields (client_name,
// slot number) that the caller attaches afterwards.
interface DateSlot {
  articles_count:  number
  article_names:   string
  attendance_days: number
  total_hours:     number
  status:          'Active' | 'Completed'
  first_date:      string
  last_date:       string
}

// Splits one client's attendance dates into slots on a >7-day inactivity gap,
// then aggregates each slot (distinct articles, total hours, span, status).
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

// Derives Client Work Duration rows — slot continuity is keyed by CLIENT
// alone rather than by assignment (client + work type). Articles sometimes
// punch into the wrong department/assignment for a client; grouping by client
// only keeps that from fragmenting one client's work history into unrelated
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
  article_id:          string
  article_name:        string
  last_punched_client: string
  days:                number
  first_attendance:    string
  last_attendance:     string
}

// Derives Client Engagement rows — one row per article over whatever records
// the caller passes in (the API bounds these to attendance from the selected
// Start Date through today). Deliberately does NOT go through computeSlots:
// there is no inactivity-gap splitting and no Active/Completed status,
// because this answers "how long has this Article been engaged with the
// client it most recently punched", not "what are the discrete work slots".
//
// Same boundary as Client Work Duration: only client-assigned attendance
// feeds RawSessionRecord, and clients are identified by client_name (never
// assignment_id), so the same client under different work types is one
// client.
//
// Two steps per article: (1) "Last Punched Client" is the client of the
// article's most recent check-in in the range; (2) Days / First Attendance /
// Last Attendance are then computed from that Article + Client combination
// only. Attendance for the article's other clients is deliberately ignored,
// so Days is not the article's total attendance days.
export function deriveArticleEngagementDuration(records: RawSessionRecord[]): ArticleEngagementRow[] {
  const byArticle = new Map<string, RawSessionRecord[]>()
  for (const r of records) {
    const list = byArticle.get(r.article_id) ?? []
    list.push(r)
    byArticle.set(r.article_id, list)
  }

  const rows: ArticleEngagementRow[] = []

  for (const articleRecords of byArticle.values()) {
    const { article_id, article_name } = articleRecords[0]

    const lastPunch = articleRecords.reduce((latest, r) =>
      new Date(r.checked_in_at).getTime() >= new Date(latest.checked_in_at).getTime() ? r : latest
    )

    const clientDates = [...new Set(
      articleRecords
        .filter(r => r.client_name === lastPunch.client_name)
        .map(r => r.attendance_date)
    )].sort()

    rows.push({
      article_id,
      article_name,
      last_punched_client: lastPunch.client_name,
      days:                clientDates.length,
      first_attendance:    clientDates[0],
      last_attendance:     clientDates[clientDates.length - 1],
    })
  }

  rows.sort((a, b) => a.article_name.localeCompare(b.article_name))

  return rows
}
