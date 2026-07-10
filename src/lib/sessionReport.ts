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

    // Distinct attendance dates, sorted ascending, split into sessions
    const dateSet     = new Set(assignmentRecords.map(r => r.attendance_date))
    const sortedDates = [...dateSet].sort()

    const sessions: string[][] = []
    let current = [sortedDates[0]]
    for (let i = 1; i < sortedDates.length; i++) {
      if (daysBetween(sortedDates[i - 1], sortedDates[i]) > 7) {
        sessions.push(current)
        current = [sortedDates[i]]
      } else {
        current.push(sortedDates[i])
      }
    }
    sessions.push(current)

    sessions.forEach((sessionDates, idx) => {
      const sessionDateSet = new Set(sessionDates)
      const sessionRecords = assignmentRecords.filter(r => sessionDateSet.has(r.attendance_date))

      const articleMap = new Map<string, string>()
      let totalHours = 0

      for (const r of sessionRecords) {
        if (!articleMap.has(r.article_id)) {
          articleMap.set(r.article_id, r.article_name)
        }
        if (r.checked_out_at) {
          totalHours +=
            (new Date(r.checked_out_at).getTime() - new Date(r.checked_in_at).getTime()) /
            3_600_000
        }
      }

      const articleNames = [...articleMap.values()].filter(Boolean).sort()
      const firstDate     = sessionDates[0]
      const lastDate       = sessionDates[sessionDates.length - 1]
      const status: 'Active' | 'Completed' =
        daysBetween(lastDate, todayIST) <= 7 ? 'Active' : 'Completed'

      rows.push({
        assignment_label: assignmentLabel,
        client_name,
        work_type,
        session_number:   `S${idx + 1}`,
        articles_count:   articleMap.size,
        article_names:    articleNames.join(', '),
        attendance_days:  sessionDates.length,
        total_hours:      Math.round(totalHours * 10) / 10,
        status,
        first_date: firstDate,
        last_date:  lastDate,
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
