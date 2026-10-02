import type { SupabaseClient } from '@supabase/supabase-js'
import { ARTICLE_ROLES } from '@/types/app'
import { fetchAllPages } from '@/lib/attendanceRecords'

// Roster eligibility + On Leave eligibility — the single definition shared by
// the Attendance Report and Article Analytics so their leave counts can never
// disagree. Moved verbatim from api/export/attendance/route.ts.

export type RosterEventRow = {
  target_id:  string
  action:     string
  payload:    unknown
  created_at: string
}

function toISTDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

type RosterState = { status: string; role: string }

// Starting state mirrors the signup trigger's default (pending article).
const INITIAL_ROSTER_STATE: RosterState = { status: 'pending', role: 'article' }

// Applies one lifecycle event's payload to a roster state. Shared by
// isEligibleAsOf and eligibilityChangedOnDate so both replay the exact same
// state-transition rules.
function applyRosterEvent(state: RosterState, ev: RosterEventRow): RosterState {
  const payload = ev.payload as { status?: string; role?: string } | null
  let { status, role } = state

  if (ev.action === 'user.change_role') {
    if (payload?.role) role = payload.role
  } else {
    // user.approve | user.deactivate | user.reactivate
    if (payload?.status) status = payload.status
    if (ev.action === 'user.approve' && payload?.role) role = payload.role
  }

  return { status, role }
}

function isRosterEligible(state: RosterState): boolean {
  return state.status === 'active' && (ARTICLE_ROLES as readonly string[]).includes(state.role)
}

// Replays a person's approve/deactivate/reactivate/change_role history
// (events pre-sorted ascending by created_at) to determine whether they were
// an active article/intern as of IST date `dateIST` — instead of trusting
// their CURRENT profiles.role/status, which has no history of its own and
// silently erases past eligibility after a later promotion or deactivation.
// A person with no event on or before dateIST has never been approved as of
// that date and is never eligible — this also means a person with NO
// history at all (an audit_log gap) is conservatively excluded rather than
// assumed eligible.
export function isEligibleAsOf(events: RosterEventRow[], dateIST: string): boolean {
  let state    = INITIAL_ROSTER_STATE
  let sawEvent = false

  for (const ev of events) {
    if (toISTDate(ev.created_at) > dateIST) break
    sawEvent = true
    state = applyRosterEvent(state, ev)
  }

  if (!sawEvent) return false
  return isRosterEligible(state)
}

// True if this person's AWOL-roster eligibility (active article/intern, or
// not) flips at any point during dateIST — e.g. approved, deactivated,
// reactivated, or promoted/demoted across the article/intern boundary that
// same day. Collapsing an exact-timestamp transition onto a whole calendar
// day can't faithfully represent a partial-day eligibility window, so dates
// where it changed mid-day are skipped for synthetic rows entirely rather
// than guessed at. An article<->intern change_role never flips the boolean
// (both are in ARTICLE_ROLES), so it never triggers exclusion here — that
// falls out of comparing the actual eligibility predicate before/after each
// event, not from special-casing role values.
export function eligibilityChangedOnDate(events: RosterEventRow[], dateIST: string): boolean {
  let state = INITIAL_ROSTER_STATE

  for (const ev of events) {
    const evDate = toISTDate(ev.created_at)
    if (evDate > dateIST) break
    if (evDate < dateIST) {
      state = applyRosterEvent(state, ev)
      continue
    }
    const before = isRosterEligible(state)
    state = applyRosterEvent(state, ev)
    if (isRosterEligible(state) !== before) return true
  }

  return false
}

// Lifecycle events for one person (articleId) or everyone, ascending. The
// query and its explanation below are the Attendance Report's, unchanged.
export function fetchRosterEvents(admin: SupabaseClient, endOfRangeIST: string, articleId?: string) {
  return fetchAllPages<RosterEventRow>((from, to) => {
    let query = admin
      .from('audit_log')
      .select('target_id, action, payload, created_at')
      .eq('target_type', 'profiles')
      .in('action', ['user.approve', 'user.deactivate', 'user.reactivate', 'user.change_role'])
      .lte('created_at', endOfRangeIST)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })

    if (articleId) {
      query = query.eq('target_id', articleId)
    }

    return query.range(from, to)
  })
}

// True when a leave record on dateIST counts as a real "On Leave" day for a
// person with these lifecycle events — the Attendance Report's exact gate for
// its synthetic On Leave rows, in the same order: skip dates where
// eligibility flipped mid-day, then require historical eligibility as of the
// date. (Attendance precedence and the leave_records lookup are the caller's.)
export function isLeaveCountable(events: RosterEventRow[], dateIST: string): boolean {
  if (eligibilityChangedOnDate(events, dateIST)) return false
  return isEligibleAsOf(events, dateIST)
}
