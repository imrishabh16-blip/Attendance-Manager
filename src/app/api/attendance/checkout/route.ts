import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { isArticleRole } from '@/types/app'
import { isValidCoordinate } from '@/lib/gps'
import { effectiveCheckoutAt } from '@/lib/sessionClosure'

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
  const { record_id, latitude, longitude, note } = body

  if (!record_id) return NextResponse.json({ error: 'record_id required' }, { status: 400 })
  if (!isValidCoordinate(latitude, longitude)) {
    return NextResponse.json({ error: 'GPS coordinates are required for checkout' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Verify the record belongs to this article and is still open
  const { data: record } = await admin
    .from('attendance_records')
    .select('id, article_id, checked_out_at, attendance_date')
    .eq('id', record_id as string)
    .single()

  if (!record) return NextResponse.json({ error: 'Record not found' }, { status: 404 })
  if (record.article_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (record.checked_out_at) {
    return NextResponse.json({ error: 'Already checked out' }, { status: 409 })
  }

  // A session never spans more than its attendance date: checked out on that
  // IST date -> the actual time; after midnight (e.g. a tab left open) ->
  // capped at 23:59:59 IST of the original date.
  const { data, error } = await admin
    .from('attendance_records')
    .update({
      checked_out_at:  effectiveCheckoutAt(record.attendance_date, new Date()),
      checked_out_lat: latitude,
      checked_out_lng: longitude,
      note:            note ?? undefined,
    })
    .eq('id', record_id as string)
    .is('checked_out_at', null)
    .select()
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Already checked out' }, { status: 409 })
  return NextResponse.json({ record: data })
}
