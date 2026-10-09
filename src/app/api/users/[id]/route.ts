import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { isArticleRole, type UserRole } from '@/types/app'
import { closeOpenSession } from '@/lib/sessionClosure'

const VALID_ROLES: UserRole[] = ['article', 'intern', 'manager', 'partner', 'admin']

// Open sessions are closed through lib/sessionClosure before an admin action
// removes the user's ability to check themselves out: at the action time if
// it is still the session's attendance date, otherwise at 23:59:59 IST of
// that original date — never later. A close failure aborts the action.
const CLOSE_SESSION_FAILED =
  "Could not close the user's open attendance session. No changes were made. Please try again."

// The raw database error stays in the server log; the admin gets this stable,
// actionable message instead.
function sessionCloseFailed(action: string, userId: string, error: unknown) {
  console.error(`users/${userId}: ${action} aborted — could not close the open attendance session`, error)
  return NextResponse.json({ error: CLOSE_SESSION_FAILED }, { status: 500 })
}

// PATCH /api/users/[id] — approve | deactivate | reactivate | change_role
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: actor } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', user.id)
    .single()

  if (!actor || actor.status !== 'active') {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const isAdmin   = actor.role === 'admin'
  const isPartner = actor.role === 'partner'

  let body: { action: string; role?: UserRole }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const { action, role } = body

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
      approved_by: user.id,
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

    const nowDate = new Date()
    const now     = nowDate.toISOString()

    // Deactivation revokes portal access, so an article/intern with an open
    // session can no longer check themselves out. Close it first — if this
    // fails, abort before the profile is touched, so nothing is half-applied.
    if (target && isArticleRole(target.role as UserRole)) {
      const closeError = await closeOpenSession(admin, id, 'user deactivated', nowDate)
      if (closeError) return sessionCloseFailed('deactivate', id, closeError)
    }

    updatePayload = {
      status:         'deactivated',
      deactivated_by: user.id,
      deactivated_at: now,
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
    if (id === user.id) {
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

    // Auto-close an open session only when moving OUT of an attendance-
    // capable role — never between article and intern, since checkout
    // access is unaffected by that transition.
    if (target && isArticleRole(target.role as UserRole) && !isArticleRole(role)) {
      const closeError = await closeOpenSession(admin, id, 'role changed', new Date())
      if (closeError) return sessionCloseFailed('change_role', id, closeError)
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
    actor_id:    user.id,
    action:      `user.${action}`,
    target_type: 'profiles',
    target_id:   id,
    payload:     updatePayload,
  })

  return NextResponse.json({ profile: data })
}
