import { createClient } from '@/lib/supabase/server'
import { buildAttendanceExcel } from '@/lib/export'
import { NextRequest, NextResponse } from 'next/server'

const ALLOWED_ROLES = ['admin', 'partner', 'manager']

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', session.user.id)
    .single()

  if (!profile || profile.status !== 'active' || !ALLOWED_ROLES.includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const startDate  = searchParams.get('start_date')
  const endDate    = searchParams.get('end_date')
  const articleId  = searchParams.get('article_id') ?? undefined

  if (!startDate || !endDate) {
    return NextResponse.json({ error: 'start_date and end_date required' }, { status: 400 })
  }

  const { data, error } = await supabase.rpc('get_attendance_export', {
    p_start_date: startDate,
    p_end_date:   endDate,
    p_article_id: articleId ?? null,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const buffer = await buildAttendanceExcel(data ?? [])
  const filename = `attendance_${startDate}_to_${endDate}.xlsx`

  // Wrap in Uint8Array — Buffer<ArrayBufferLike> is not directly assignable to BodyInit
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
