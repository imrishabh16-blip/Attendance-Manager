import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('status')
    .eq('id', session.user.id)
    .single()

  if (!profile || profile.status !== 'active') {
    return NextResponse.json({ error: 'Account not active' }, { status: 403 })
  }

  const { leave_date, note } = await req.json()
  if (!leave_date) return NextResponse.json({ error: 'leave_date required' }, { status: 400 })

  // Fix 7: Block leave marking if attendance already exists for that date
  const { data: existingAttendance } = await supabase
    .from('attendance_records')
    .select('id')
    .eq('article_id', session.user.id)
    .eq('attendance_date', leave_date)
    .not('checked_in_at', 'is', null)
    .maybeSingle()

  if (existingAttendance) {
    return NextResponse.json(
      { error: 'Attendance is already recorded for this date. Cannot mark it as leave.' },
      { status: 409 }
    )
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('leave_records')
    .upsert(
      { article_id: session.user.id, leave_date, note: note ?? null },
      { onConflict: 'article_id,leave_date', ignoreDuplicates: true }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ leave: data }, { status: 201 })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { leave_date } = await req.json()
  if (!leave_date) return NextResponse.json({ error: 'leave_date required' }, { status: 400 })

  const admin = createAdminClient()
  const { error } = await admin
    .from('leave_records')
    .delete()
    .eq('article_id', session.user.id)
    .eq('leave_date', leave_date)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
