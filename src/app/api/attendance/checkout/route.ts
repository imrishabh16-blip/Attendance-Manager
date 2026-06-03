import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

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
  const { record_id, latitude, longitude, note } = body

  if (!record_id) return NextResponse.json({ error: 'record_id required' }, { status: 400 })
  if (latitude == null || longitude == null) {
    return NextResponse.json({ error: 'GPS coordinates are required for checkout' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Verify the record belongs to this article and is still open
  const { data: record } = await admin
    .from('attendance_records')
    .select('id, article_id, checked_out_at')
    .eq('id', record_id)
    .single()

  if (!record) return NextResponse.json({ error: 'Record not found' }, { status: 404 })
  if (record.article_id !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (record.checked_out_at) {
    return NextResponse.json({ error: 'Already checked out' }, { status: 409 })
  }

  const { data, error } = await admin
    .from('attendance_records')
    .update({
      checked_out_at:  new Date().toISOString(),
      checked_out_lat: latitude,
      checked_out_lng: longitude,
      note:            note ?? undefined,
    })
    .eq('id', record_id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ record: data })
}
