import { createClient } from '@/lib/supabase/server'
import { buildAssignmentActivityExcel } from '@/lib/export'
import { NextResponse } from 'next/server'

const ALLOWED_ROLES = ['admin', 'partner', 'manager']

export async function GET() {
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

  const { data, error } = await supabase.rpc('get_assignment_activity_export')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const buffer = await buildAssignmentActivityExcel(data ?? [])
  const filename = `assignment_activity_${new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })}.xlsx`

  // Wrap in Uint8Array — Buffer<ArrayBufferLike> is not directly assignable to BodyInit
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type':        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
