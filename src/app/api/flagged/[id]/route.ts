import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

const ELEVATED = ['admin', 'partner', 'manager']

// PATCH /api/flagged/[id] — mark_reviewed | resolve
//
// Flagging semantics: a record is flagged when the article entered a client
// name that does not exist in the client master (attendance_type = 'others').
//
// Resolution adds the missing client to the clients master table.
// The dynamic assignment model then handles future check-ins automatically.
// No assignment is created here.
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params   // attendance_record id

  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: actor } = await supabase
    .from('profiles')
    .select('role, status, full_name')
    .eq('id', session.user.id)
    .single()

  if (!actor || actor.status !== 'active' || !ELEVATED.includes(actor.role)) {
    return NextResponse.json({ error: 'Elevated access required' }, { status: 403 })
  }

  const body = await req.json()
  const { action, new_client_name, existing_client_id } = body as {
    action:              'mark_reviewed' | 'resolve'
    new_client_name?:    string
    existing_client_id?: string
  }

  if (action !== 'mark_reviewed' && action !== 'resolve') {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const admin           = createAdminClient()
  const now             = new Date().toISOString()
  let clientResolved: string | null = null

  if (action === 'resolve') {
    if (new_client_name?.trim()) {
      // Add new client to the client master
      const { error: clientErr } = await admin
        .from('clients')
        .insert({ name: new_client_name.trim() })
      // 23505 = unique_violation — client already exists, treat as success
      if (clientErr && !clientErr.code?.includes('23505')) {
        return NextResponse.json({ error: 'Failed to add client to master' }, { status: 500 })
      }
      clientResolved = new_client_name.trim()

    } else if (existing_client_id) {
      // Map to an existing client — verify it exists, no insert needed
      const { data: existing } = await admin
        .from('clients')
        .select('name')
        .eq('id', existing_client_id)
        .single()
      if (!existing) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
      clientResolved = existing.name as string

    } else {
      return NextResponse.json(
        { error: 'resolve requires new_client_name or existing_client_id' },
        { status: 400 }
      )
    }
  }

  const updatePayload: Record<string, unknown> = {
    flagged_for_review: false,
    reviewed_at:        now,
    reviewed_by:        session.user.id,
  }

  const { error: updateErr } = await admin
    .from('attendance_records')
    .update(updatePayload)
    .eq('id', id)

  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 })

  await admin.from('audit_log').insert({
    actor_id:    session.user.id,
    action:      `flagged.${action}`,
    target_type: 'attendance_records',
    target_id:   id,
    payload:     { ...updatePayload, client_resolved: clientResolved },
  })

  return NextResponse.json({
    record_id:          id,
    flagged_for_review: false,
    reviewed_at:        now,
    reviewed_by_name:   actor.full_name as string,
    client_resolved:    clientResolved,
  })
}
