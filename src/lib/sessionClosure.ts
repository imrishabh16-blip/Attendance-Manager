import type { PostgrestError } from '@supabase/supabase-js'
import type { createAdminClient } from '@/lib/supabase/admin'

// Session closure rule — the ONE place that decides what checked_out_at a
// session receives when something other than the article's own on-time
// check-out closes it (or when a check-out arrives late):
//
//   An attendance session never spans more than its attendance_date (an IST
//   calendar date). Closing it at time T gives
//
//       checked_out_at = min(T, 23:59:59 IST of the session's attendance_date)
//
//   - closed on the same IST date  -> T itself (the actual action time; never
//     pushed into the future)
//   - closed on a later date       -> 23:59:59 IST of the ORIGINAL date
//
// Used by every path that closes a session: the next check-in's stale-session
// close, admin deactivation, role change out of article/intern, and a manual
// check-out that arrives after midnight.
//
// All date maths is explicit-offset (+05:30): India has no DST, and nothing
// here depends on the server's local timezone.

const ATTENDANCE_DATE = /^\d{4}-\d{2}-\d{2}$/

// 23:59:59 IST on the given attendance date (YYYY-MM-DD).
export function endOfAttendanceDay(attendanceDate: string): Date {
  if (!ATTENDANCE_DATE.test(attendanceDate)) {
    throw new Error(`Invalid attendance date: ${attendanceDate}`)
  }
  const end = new Date(`${attendanceDate}T23:59:59+05:30`)
  if (Number.isNaN(end.getTime())) throw new Error(`Invalid attendance date: ${attendanceDate}`)
  return end
}

// checked_out_at (ISO string) for a session of `attendanceDate` closed at `at`.
export function effectiveCheckoutAt(attendanceDate: string, at: Date): string {
  const end = endOfAttendanceDay(attendanceDate)
  return (at.getTime() <= end.getTime() ? at : end).toISOString()
}

// Keeps whatever note the session already has and appends the auto-close
// marker; with no existing note it is just the marker.
export function withAutoCloseNote(existingNote: string | null | undefined, reason: string): string {
  const marker = `Auto-closed: ${reason}`
  return existingNote && existingNote.trim() ? `${existingNote} — ${marker}` : marker
}

type AdminClient = ReturnType<typeof createAdminClient>

export interface OpenSessionRecord {
  id:              string
  attendance_date: string
  note:            string | null
}

// Closes one known-open session at `now` per the rule above. The UPDATE only
// matches a row that is STILL open, so a session that was closed in the
// meantime (e.g. by the article, between our read and this write) is left
// exactly as it is — never overwritten.
export async function closeSessionRecord(
  admin: AdminClient,
  record: OpenSessionRecord,
  reason: string,
  now: Date
): Promise<PostgrestError | null> {
  const { error } = await admin
    .from('attendance_records')
    .update({
      checked_out_at: effectiveCheckoutAt(record.attendance_date, now),
      note:           withAutoCloseNote(record.note, reason),
    })
    .eq('id', record.id)
    .is('checked_out_at', null)

  return error
}

// Closes the article's open session, if it has one. Returns the error (or null
// when there was nothing to close / it succeeded) so the caller can abort the
// surrounding admin action instead of leaving an inconsistent state. Targets
// exactly what the one-open-session unique index covers — checked in AND not
// checked out — and surfaces a lookup failure rather than treating it as
// "nothing to close".
export async function closeOpenSession(
  admin: AdminClient,
  articleId: string,
  reason: string,
  now: Date
): Promise<PostgrestError | null> {
  const { data: openRecord, error: lookupError } = await admin
    .from('attendance_records')
    .select('id, attendance_date, note')
    .eq('article_id', articleId)
    .is('checked_out_at', null)
    .not('checked_in_at', 'is', null)
    .maybeSingle()

  if (lookupError) return lookupError
  if (!openRecord) return null

  return closeSessionRecord(admin, openRecord as OpenSessionRecord, reason, now)
}
