import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { isArticleRole, type WorkType } from '@/types/app'
import { isValidCoordinate } from '@/lib/gps'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('status, role')
    .eq('id', user.id)
    .single()

  if (!profile || profile.status !== 'active') {
    return NextResponse.json({ error: 'Account not active' }, { status: 403 })
  }
  if (!isArticleRole(profile.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const { client_name, work_type, latitude, longitude, attendance_type, note, reporting_manager_id } = body

  // --- Input validation ---
  if (!isValidCoordinate(latitude, longitude)) {
    return NextResponse.json({ error: 'GPS coordinates are required' }, { status: 400 })
  }
  if (!attendance_type || !['regular', 'unallocated'].includes(attendance_type as string)) {
    return NextResponse.json({ error: 'Invalid attendance type' }, { status: 400 })
  }
  if (attendance_type === 'regular' && (!client_name || !work_type)) {
    return NextResponse.json({ error: 'client_name and work_type are required for regular attendance' }, { status: 400 })
  }
  // Reporting Manager is mandatory for every check-in (regular or
  // unallocated) — enforced here independently of the UI, which also
  // requires it, since a client-side-only check can be bypassed.
  if (!reporting_manager_id || typeof reporting_manager_id !== 'string') {
    return NextResponse.json({ error: 'Reporting Manager is required' }, { status: 400 })
  }
  if (reporting_manager_id === user.id) {
    return NextResponse.json({ error: 'You cannot report to yourself' }, { status: 400 })
  }

  // IST date — UTC split gives wrong date between midnight and 05:30 IST
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

  // Admin client needed for stale-record auto-close and final insert
  const admin = createAdminClient()

  // Reporting Manager is explicitly not role-restricted — any currently
  // active profile (any role) other than the caller qualifies. Checked
  // against current data, not trusted from the client.
  const { data: reportingManager } = await admin
    .from('profiles')
    .select('status')
    .eq('id', reporting_manager_id)
    .single()

  if (!reportingManager || reportingManager.status !== 'active') {
    return NextResponse.json({ error: 'Selected Reporting Manager is not an active user' }, { status: 400 })
  }

  // --- Block if ANY prior session is still open (across all dates) ---
  const { data: openRecord } = await supabase
    .from('attendance_records')
    .select('id, attendance_date')
    .eq('article_id', user.id)
    .is('checked_out_at', null)
    .not('checked_in_at', 'is', null)
    .maybeSingle()

  if (openRecord) {
    if (openRecord.attendance_date === today) {
      // Same-day open record — block as before
      return NextResponse.json(
        {
          error: `You have an unclosed check-in from ${openRecord.attendance_date}. Please check out first.`,
          open_record_id:   openRecord.id,
          open_record_date: openRecord.attendance_date,
        },
        { status: 409 }
      )
    }
    // Stale record from a previous day — auto-close at 23:59:59 IST and continue
    const { error: autoCloseError } = await admin
      .from('attendance_records')
      .update({
        checked_out_at: new Date(`${openRecord.attendance_date}T23:59:59+05:30`).toISOString(),
        note:           'Auto-closed: check-out not recorded',
      })
      .eq('id', openRecord.id)

    if (autoCloseError) {
      return NextResponse.json(
        { error: 'Could not automatically close your previous session. Please contact an administrator.' },
        { status: 500 }
      )
    }
  }

  // --- Block check-in if leave is already marked for today ---
  const { data: leaveRecord } = await supabase
    .from('leave_records')
    .select('id')
    .eq('article_id', user.id)
    .eq('leave_date', today)
    .maybeSingle()

  if (leaveRecord) {
    return NextResponse.json(
      { error: 'Today is marked as leave. Cancel your leave first to check in.' },
      { status: 409 }
    )
  }

  // --- Resolve assignment for 'regular' attendance (find or auto-create) ---
  let resolvedAssignmentId: string | null = null

  if (attendance_type === 'regular') {
    // 1. Find existing active assignment for this client + work-type combo.
    //    Deliberately checked BEFORE any master-data validation: assignments
    //    are free-text (no FK to clients/work_types), so an assignment that
    //    already exists must always be resolved on its own history, even if
    //    its client or work type has since been renamed/removed from the
    //    master lists — otherwise a routine master-data cleanup (or a
    //    stale client-side cache of the dropdown) would wrongly break
    //    check-ins for an assignment articles are actively working under.
    const { data: existing } = await supabase
      .from('assignments')
      .select('id')
      .eq('client_name', client_name as string)
      .eq('work_type', work_type as WorkType)
      .eq('status', 'active')
      .maybeSingle()

    if (existing) {
      resolvedAssignmentId = existing.id
    } else {
      // 2. Check if an inactive assignment exists — block re-creation until admin reactivates
      const { data: inactive } = await supabase
        .from('assignments')
        .select('id')
        .eq('client_name', client_name as string)
        .eq('work_type', work_type as WorkType)
        .eq('status', 'inactive')
        .maybeSingle()

      if (inactive) {
        return NextResponse.json(
          { error: `${client_name} (${work_type}) has been deactivated. Ask your admin to reactivate it.` },
          { status: 409 }
        )
      }

      // 3. No assignment exists yet — validate against master data before
      //    fabricating a brand-new one. The check-in UI (ClientWorkSelector)
      //    only ever offers values already present in these two tables, so a
      //    legitimate request always passes this; it only rejects a
      //    forged/stale client_name or work_type that doesn't exist anywhere,
      //    which previously would have silently auto-created a brand-new
      //    assignment from unvalidated input.
      const [{ data: clientMatch }, { data: workTypeMatch }] = await Promise.all([
        supabase.from('clients').select('id').eq('name', client_name as string).maybeSingle(),
        supabase.from('work_types').select('id').eq('name', work_type as string).maybeSingle(),
      ])
      if (!clientMatch) {
        return NextResponse.json({ error: 'Unknown client. Ask your admin to add it.' }, { status: 400 })
      }
      if (!workTypeMatch) {
        return NextResponse.json({ error: 'Unknown work type. Ask your admin to add it.' }, { status: 400 })
      }

      // 4. Auto-create a new assignment (service role bypasses RLS)
      const { data: created, error: createError } = await admin
        .from('assignments')
        .insert({
          client_name: client_name as string,
          work_type:   work_type as WorkType,
          created_by:  user.id,
          status:      'active',
        })
        .select('id')
        .single()

      if (!createError && created) {
        resolvedAssignmentId = created.id
      } else if (createError?.code === '23505') {
        // Race: another concurrent request already created this assignment — look it up
        const { data: raceWinner } = await admin
          .from('assignments')
          .select('id')
          .eq('client_name', client_name as string)
          .eq('work_type', work_type as WorkType)
          .eq('status', 'active')
          .maybeSingle()
        if (!raceWinner) {
          return NextResponse.json({ error: 'Failed to create assignment record' }, { status: 500 })
        }
        resolvedAssignmentId = raceWinner.id
      } else {
        return NextResponse.json({ error: 'Failed to create assignment record' }, { status: 500 })
      }
    }
  }

  // --- Insert attendance record ---
  const { data, error } = await admin
    .from('attendance_records')
    .insert({
      article_id:            user.id,
      assignment_id:         resolvedAssignmentId,
      attendance_date:       today,
      checked_in_at:         new Date().toISOString(),
      checked_in_lat:        latitude,
      checked_in_lng:        longitude,
      note:                  note ?? null,
      attendance_type,
      reporting_manager_id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ record: data }, { status: 201 })
}
