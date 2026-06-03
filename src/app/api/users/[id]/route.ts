import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import type { UserRole } from '@/types/app'

const VALID_ROLES: UserRole[] = ['article', 'manager', 'partner', 'admin']

// PATCH /api/users/[id] — approve | deactivate | reactivate | change_role
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: actor } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', session.user.id)
    .single()

  if (!actor || actor.status !== 'active') {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const isAdmin   = actor.role === 'admin'
  const isPartner = actor.role === 'partner'

  const body = await req.json()
  const { action, role } = body as { action: string; role?: UserRole }

  const admin = createAdminClient()
  let updatePayload: Record<string, unknown> = {}

  // ── approve ────────────────────────────────────────────────────────────
  if (action === 'approve') {
    if (!isAdmin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    if (role && !VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }
    updatePayload = {
      status:      'active',
      approved_by: session.user.id,
      approved_at: new Date().toISOString(),
      ...(role ? { role } : {}),
    }

  // ── deactivate ─────────────────────────────────────────────────────────
  } else if (action === 'deactivate') {
    if (!isAdmin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

    // Last-admin guard: never allow deactivating the only active admin
    const { data: target } = await admin
      .from('profiles').select('role').eq('id', id).single()
    if (target?.role === 'admin') {
      const { count } = await admin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin')
        .eq('status', 'active')
      if ((count ?? 0) <= 1) {
        return NextResponse.json(
          { error: 'Cannot deactivate the last admin account' },
          { status: 403 }
        )
      }
    }

    updatePayload = {
      status:         'deactivated',
      deactivated_by: session.user.id,
      deactivated_at: new Date().toISOString(),
    }

  // ── reactivate ─────────────────────────────────────────────────────────
  } else if (action === 'reactivate') {
    if (!isAdmin) return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    updatePayload = { status: 'active' }

  // ── change_role ────────────────────────────────────────────────────────
  } else if (action === 'change_role') {
    if (!isAdmin && !isPartner) {
      return NextResponse.json({ error: 'Admin or partner access required' }, { status: 403 })
    }
    if (!role || !VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    }
    // Block self-role-change entirely — prevents accidental self-lockout
    if (id === session.user.id) {
      return NextResponse.json({ error: 'Cannot change your own role' }, { status: 403 })
    }
    // Partners cannot elevate anyone to admin
    if (isPartner && role === 'admin') {
      return NextResponse.json({ error: 'Partners cannot assign the admin role' }, { status: 403 })
    }
    // Last-admin guard: never allow demoting the only active admin
    const { data: target } = await admin
      .from('profiles').select('role').eq('id', id).single()
    if (target?.role === 'admin' && role !== 'admin') {
      const { count } = await admin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'admin')
        .eq('status', 'active')
      if ((count ?? 0) <= 1) {
        return NextResponse.json(
          { error: 'Cannot demote the last admin account' },
          { status: 403 }
        )
      }
    }

    updatePayload = { role }

  } else {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('profiles')
    .update(updatePayload)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await admin.from('audit_log').insert({
    actor_id:    session.user.id,
    action:      `user.${action}`,
    target_type: 'profiles',
    target_id:   id,
    payload:     updatePayload,
  })

  return NextResponse.json({ profile: data })
}
