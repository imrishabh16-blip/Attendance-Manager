import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import type { WorkType } from '@/types/app'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('status, role')
    .eq('id', session.user.id)
    .single()

  if (!profile || profile.status !== 'active') {
    return NextResponse.json({ error: 'Account not active' }, { status: 403 })
  }
  if (profile.role !== 'article') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const { client_name, work_type, latitude, longitude, attendance_type, others_client_name, note } = body

  // --- Input validation ---
  if (latitude == null || longitude == null) {
    return NextResponse.json({ error: 'GPS coordinates are required' }, { status: 400 })
  }
  if (!attendance_type || !['regular', 'others', 'unallocated'].includes(attendance_type)) {
    return NextResponse.json({ error: 'Invalid attendance type' }, { status: 400 })
  }
  if (attendance_type === 'regular' && (!client_name || !work_type)) {
    return NextResponse.json({ error: 'client_name and work_type are required for regular attendance' }, { status: 400 })
  }

  // IST date — UTC split gives wrong date between midnight and 05:30 IST
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

  // Admin client needed for stale-record auto-close and final insert
  const admin = createAdminClient()

  // --- Block if ANY prior session is still open (across all dates) ---
  const { data: openRecord } = await supabase
    .from('attendance_records')
    .select('id, attendance_date')
    .eq('article_id', session.user.id)
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
    await admin
      .from('attendance_records')
      .update({
        checked_out_at: new Date(`${openRecord.attendance_date}T23:59:59+05:30`).toISOString(),
        note:           'Auto-closed: check-out not recorded',
      })
      .eq('id', openRecord.id)
  }

  // --- Block check-in if leave is already marked for today ---
  const { data: leaveRecord } = await supabase
    .from('leave_records')
    .select('id')
    .eq('article_id', session.user.id)
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
    // 1. Find existing active assignment for this client + work-type combo
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
      // 2. Check if an archived assignment exists — block re-creation until admin reactivates
      const { data: archived } = await supabase
        .from('assignments')
        .select('id')
        .eq('client_name', client_name as string)
        .eq('work_type', work_type as WorkType)
        .eq('status', 'archived')
        .maybeSingle()

      if (archived) {
        return NextResponse.json(
          { error: `${client_name} (${work_type}) has been archived. Ask your admin to reactivate it.` },
          { status: 409 }
        )
      }

      // 3. Auto-create a new assignment (service role bypasses RLS)
      const { data: created, error: createError } = await admin
        .from('assignments')
        .insert({
          client_name: client_name as string,
          work_type:   work_type as WorkType,
          created_by:  session.user.id,
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
      article_id:         session.user.id,
      assignment_id:      resolvedAssignmentId,
      attendance_date:    today,
      checked_in_at:      new Date().toISOString(),
      checked_in_lat:     latitude,
      checked_in_lng:     longitude,
      note:               note ?? null,
      attendance_type,
      others_client_name: attendance_type === 'others' ? (others_client_name ?? null) : null,
      flagged_for_review: attendance_type === 'others',
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ record: data }, { status: 201 })
}
