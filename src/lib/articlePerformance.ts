import { computeStatus, sessionDurationHours } from '@/lib/attendanceStatus'

// One real attendance session (checked_in_at present) for a single article.
export interface PerformanceSession {
  attendance_date: string
  attendance_type: string
  checked_in_at:   string
  checked_out_at:  string | null
}

export interface ArticlePerformanceRow {
  month:            string   // e.g. "Apr-26"
  present_days:     number
  half_days:        number
  leaves:           number
  unallocated_days: number
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface DayTotals {
  allUnallocated: boolean   // every session that day is unallocated/others
  hasOpenSession: boolean   // some session has no check-out yet
  hours:          number    // sum of the closed sessions' durations
}

interface MonthCounts { present: number; half: number; leaves: number; unallocated: number }

// Derives month-wise Present / Half Day / Leave / Unallocated day counts for
// one article.
//
// Each calendar date is classified once, from the TOTAL of that day's
// sessions — never from any single session:
//
//   1. Total attended duration = the sum of every session's duration, each
//      taken with the Attendance Report's own rule (sessionDurationHours:
//      check-out minus check-in, rounded to 2 decimals), the sum rounded
//      likewise.
//   2. The day's status is then the Attendance Report's computeStatus(),
//      applied to the day instead of a session:
//        Unallocated — every session that day is unallocated/others
//        Half Day    — total over 0 and under 4 hours
//        Present     — total of 4 hours or more ("Completed" in the report)
//      So two 3-hour sessions on one day = 6 hours = Present.
//
//   A fully closed day whose total is 0.00 hours is neither Present nor Half
//   Day — it is counted in none of the four columns. This is deliberately
//   Article Analytics only: computeStatus's "under 4 hours" has no lower
//   bound, so the Attendance Report still calls such a day a Half Day. The
//   record still exists, so it keeps its month in the range and, as with any
//   attendance, takes precedence over a leave on the same date.
//
//   A day containing a session that was never checked out has no total
//   duration; computeStatus treats an unknown duration as not-Half-Day, so
//   such a day is Present, exactly as the report treats the open session.
//
// Leave: leaveDates must already be the dates that count as On Leave per the
// Attendance Report (see lib/rosterEligibility.ts isLeaveCountable, and
// capped at today by the caller). Attendance always wins over leave: a leave
// date that has any real attendance session is ignored here.
//
// Every day is counted once, in the month of its attendance_date /
// leave_date. Months run continuously from the article's first to last month
// with any activity, so a month with none shows zeros instead of vanishing.
export function deriveArticlePerformance(
  sessions: PerformanceSession[],
  leaveDates: string[],
): ArticlePerformanceRow[] {
  const days = new Map<string, DayTotals>()
  for (const s of sessions) {
    const day = days.get(s.attendance_date) ?? { allUnallocated: true, hasOpenSession: false, hours: 0 }
    const duration = sessionDurationHours(s.checked_in_at, s.checked_out_at)

    // computeStatus ignores duration for unallocated/others, so a null probe
    // asks it "is this type unallocated?" without restating the type list.
    if (computeStatus(s.attendance_type, null) !== 'Unallocated') day.allUnallocated = false
    if (duration === null) day.hasOpenSession = true
    else day.hours += duration

    days.set(s.attendance_date, day)
  }

  const byMonth = new Map<string, MonthCounts>()
  const bucket = (date: string): MonthCounts => {
    const key = date.slice(0, 7) // YYYY-MM
    let counts = byMonth.get(key)
    if (!counts) {
      counts = { present: 0, half: 0, leaves: 0, unallocated: 0 }
      byMonth.set(key, counts)
    }
    return counts
  }

  for (const [date, day] of days) {
    const totalHours = Math.round(day.hours * 100) / 100
    const counts = bucket(date)

    // 0.00 total hours on a fully closed, non-unallocated day: no column.
    if (!day.allUnallocated && !day.hasOpenSession && totalHours === 0) continue

    const status = computeStatus(
      day.allUnallocated ? 'unallocated' : 'regular',
      day.hasOpenSession ? null : totalHours,
    )
    if (status === 'Completed')     counts.present++
    else if (status === 'Half Day') counts.half++
    else                            counts.unallocated++
  }
  for (const date of new Set(leaveDates)) {
    if (!days.has(date)) bucket(date).leaves++
  }

  if (byMonth.size === 0) return []

  const keys = [...byMonth.keys()].sort()
  const [firstY, firstM] = keys[0].split('-').map(Number)
  const [lastY,  lastM]  = keys[keys.length - 1].split('-').map(Number)

  const rows: ArticlePerformanceRow[] = []
  let y = firstY
  let m = firstM
  while (y < lastY || (y === lastY && m <= lastM)) {
    const counts = byMonth.get(`${y}-${String(m).padStart(2, '0')}`)
    rows.push({
      month:            `${MONTH_NAMES[m - 1]}-${String(y).slice(2)}`,
      present_days:     counts?.present     ?? 0,
      half_days:        counts?.half        ?? 0,
      leaves:           counts?.leaves      ?? 0,
      unallocated_days: counts?.unallocated ?? 0,
    })
    if (m === 12) { y++; m = 1 } else { m++ }
  }

  return rows
}
