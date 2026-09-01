import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { isArticleRole } from '@/types/app'

const ALLOWED_ROLES = ['admin', 'partner', 'manager']

type AuthResult = { userId: string } | { error: NextResponse }

async function authorize(): Promise<AuthResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const { data: actor } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', user.id)
    .single()

  if (!actor || actor.status !== 'active' || !ALLOWED_ROLES.includes(actor.role)) {
    return { error: NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 }) }
  }
  return { userId: user.id }
}

// POST /api/reporting-managers — { article_id, reporting_manager_id }
export async function POST(req: NextRequest) {
  const auth = await authorize()
  if ('error' in auth) return auth.error

  let body: { article_id?: string; reporting_manager_id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const { article_id, reporting_manager_id } = body
  if (!article_id || !reporting_manager_id) {
    return NextResponse.json({ error: 'article_id and reporting_manager_id are required' }, { status: 400 })
  }
  if (article_id === reporting_manager_id) {
    return NextResponse.json({ error: 'A person cannot report to themselves' }, { status: 400 })
  }

  const admin = createAdminClient()

  // The reports side of this feature is scoped to the existing Article/Intern
  // concept — checked here (current role at creation time), not as a DB
  // constraint, since role is mutable and this table intentionally preserves
  // relationships across later role changes (see migration 00024).
  const { data: article } = await admin
    .from('profiles').select('role').eq('id', article_id).single()
  if (!article || !isArticleRole(article.role)) {
    return NextResponse.json({ error: 'article_id must be a current Article/Intern' }, { status: 400 })
  }

  const { data: manager } = await admin
    .from('profiles').select('id').eq('id', reporting_manager_id).single()
  if (!manager) {
    return NextResponse.json({ error: 'reporting_manager_id does not exist' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('reporting_relationships')
    .insert({ article_id, reporting_manager_id, created_by: auth.userId })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'This reporting relationship already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await admin.from('audit_log').insert({
    actor_id:    auth.userId,
    action:      'reporting_manager.add',
    target_type: 'profiles',
    target_id:   article_id,
    payload:     { reporting_manager_id },
  })

  return NextResponse.json({ relationship: data }, { status: 201 })
}

// DELETE /api/reporting-managers — { article_id, reporting_manager_id }
export async function DELETE(req: NextRequest) {
  const auth = await authorize()
  if ('error' in auth) return auth.error

  let body: { article_id?: string; reporting_manager_id?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const { article_id, reporting_manager_id } = body
  if (!article_id || !reporting_manager_id) {
    return NextResponse.json({ error: 'article_id and reporting_manager_id are required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin
    .from('reporting_relationships')
    .delete()
    .eq('article_id', article_id)
    .eq('reporting_manager_id', reporting_manager_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await admin.from('audit_log').insert({
    actor_id:    auth.userId,
    action:      'reporting_manager.remove',
    target_type: 'profiles',
    target_id:   article_id,
    payload:     { reporting_manager_id },
  })

  return NextResponse.json({ ok: true })
}
