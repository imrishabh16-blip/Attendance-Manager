import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { ARTICLE_ROLES } from '@/types/app'

const ALLOWED_ROLES = ['admin', 'partner', 'manager']

export type ReportingWiseArticle = {
  article_id: string
  full_name:  string
}

export type ReportingWiseGroup = {
  assignment_id: string | null
  label:         string
  work_type:     string | null
  articles:      ReportingWiseArticle[]
}

export type ReportingWiseManager = {
  reporting_manager_id: string
  full_name:            string
  active_count:         number
  live_groups:          ReportingWiseGroup[]
}

type ProfileRow = { id: string; full_name: string; role: string; status: string }
type RelationshipRow = { article_id: string; reporting_manager_id: string }
type LiveActivityRow = {
  article_id:    string
  assignment_id: string | null
  client_name:   string
  work_type:     string | null
}

// GET /api/reports/reporting-wise
// Read-only organisational report: for each Reporting Manager, the count of
// currently active Article/Intern reports, plus a live drill-down of what
// those reports are working on right now (today's open attendance sessions
// only — see get_live_activity, the app's single existing definition of
// "currently checked in"). Bounded to 3 queries total regardless of firm
// size or number of managers — no per-manager or per-article queries.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', user.id)
    .single()

  if (!profile || profile.status !== 'active' || !ALLOWED_ROLES.includes(profile.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const [relRes, profileRes, liveRes] = await Promise.all([
    supabase.from('reporting_relationships').select('article_id, reporting_manager_id'),
    supabase.from('profiles').select('id, full_name, role, status'),
    // Reuses the exact same RPC the live dashboard uses — the single
    // existing source of truth for "currently checked in" (today's IST
    // date, checked_in_at set, checked_out_at still null). Not reimplemented
    // here to avoid a second, potentially-diverging definition.
    supabase.rpc('get_live_activity'),
  ])

  if (relRes.error)     return NextResponse.json({ error: relRes.error.message },     { status: 500 })
  if (profileRes.error) return NextResponse.json({ error: profileRes.error.message }, { status: 500 })
  if (liveRes.error)    return NextResponse.json({ error: liveRes.error.message },    { status: 500 })

  const profileById = new Map<string, ProfileRow>(
    ((profileRes.data ?? []) as ProfileRow[]).map(p => [p.id, p])
  )
  const liveByArticle = new Map<string, LiveActivityRow>(
    ((liveRes.data ?? []) as LiveActivityRow[]).map(r => [r.article_id, r])
  )

  // Qualifying (currently active Article/Intern) relationships, grouped by manager.
  const articlesByManager = new Map<string, Set<string>>()
  for (const rel of (relRes.data ?? []) as RelationshipRow[]) {
    const p = profileById.get(rel.article_id)
    if (!p || p.status !== 'active' || !(ARTICLE_ROLES as readonly string[]).includes(p.role)) continue
    const set = articlesByManager.get(rel.reporting_manager_id) ?? new Set<string>()
    set.add(rel.article_id)
    articlesByManager.set(rel.reporting_manager_id, set)
  }

  const managers: ReportingWiseManager[] = []

  for (const [managerId, articleIds] of articlesByManager) {
    const managerProfile = profileById.get(managerId)
    if (!managerProfile) continue // defensive — relationship row with no matching profile

    // Live drill-down: only articles with an open session today. Grouped by
    // assignment_id; a null assignment_id (unallocated/others attendance)
    // groups under the same 'Others' label get_live_activity already
    // computes (coalesce(client_name, 'Others')) — no separate exclusion or
    // new label invented here.
    const groupsByKey = new Map<string, ReportingWiseGroup>()

    for (const articleId of articleIds) {
      const live = liveByArticle.get(articleId)
      if (!live) continue // not currently checked in — counted above, no live group

      const key = live.assignment_id ?? 'others'
      let group = groupsByKey.get(key)
      if (!group) {
        group = {
          assignment_id: live.assignment_id,
          label:         live.client_name,
          work_type:     live.work_type,
          articles:      [],
        }
        groupsByKey.set(key, group)
      }
      group.articles.push({
        article_id: articleId,
        full_name:  profileById.get(articleId)?.full_name ?? '—',
      })
    }

    for (const group of groupsByKey.values()) {
      group.articles.sort((a, b) => a.full_name.localeCompare(b.full_name))
    }

    const live_groups = [...groupsByKey.values()].sort((a, b) =>
      b.articles.length - a.articles.length || a.label.localeCompare(b.label)
    )

    managers.push({
      reporting_manager_id: managerId,
      full_name:            managerProfile.full_name,
      active_count:         articleIds.size,
      live_groups,
    })
  }

  // Zero-count managers are never added to articlesByManager in the first
  // place (a manager only appears once at least one qualifying relationship
  // exists), so no explicit filter is needed — matches Work Wise Articles'
  // own precedent of never showing a zero-count group.
  managers.sort((a, b) => b.active_count - a.active_count || a.full_name.localeCompare(b.full_name))

  return NextResponse.json({ managers })
}
