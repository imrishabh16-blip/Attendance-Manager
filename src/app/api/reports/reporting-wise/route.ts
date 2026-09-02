import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const ALLOWED_ROLES = ['admin', 'partner', 'manager']

export type ReportingWiseArticle = {
  article_id: string
  full_name:  string
}

export type ReportingWiseGroup = {
  group_key:     string
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

type LiveActivityRow = {
  article_id:             string
  article_name:           string
  assignment_id:          string | null
  client_name:            string
  work_type:              string | null
  attendance_type:        string
  reporting_manager_id:   string | null
  reporting_manager_name: string | null
}

// Assignment-less sessions ('others' and 'unallocated') both have
// assignment_id = null, so grouping on assignment_id alone would merge two
// semantically different categories together. get_live_activity() also
// coalesces client_name to the same literal 'Others' string for both — see
// LiveActivityTable.tsx's identical "use attendance_type, not client_name"
// comment for the same RPC. Distinguishing by attendance_type here reuses
// that already-established terminology rather than inventing new labels.
function liveSessionGroupKey(row: LiveActivityRow): string {
  return row.assignment_id ?? `type:${row.attendance_type}`
}

function liveSessionLabel(row: LiveActivityRow): string {
  if (row.assignment_id) return row.client_name
  return row.attendance_type === 'others' ? 'Others' : 'Unallocated'
}

// GET /api/reports/reporting-wise
// Reporting Manager is captured per check-in (attendance_records.
// reporting_manager_id, migration 00025), not administratively assigned.
// This report is derived entirely from get_live_activity() — the single
// existing definition of "currently checked in" — grouped by
// reporting_manager_id and then by assignment. The top-level count and the
// drill-down are therefore always the exact same underlying set: everyone
// currently checked in under that manager right now. No separate
// relationship table or cross-referencing is needed.
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

  const { data: liveRows, error: liveError } = await supabase.rpc('get_live_activity')
  if (liveError) return NextResponse.json({ error: liveError.message }, { status: 500 })

  type ManagerAcc = {
    full_name:   string
    articleIds:  Set<string>
    groupsByKey: Map<string, ReportingWiseGroup>
  }
  const managersById = new Map<string, ManagerAcc>()

  for (const row of (liveRows ?? []) as LiveActivityRow[]) {
    if (!row.reporting_manager_id) continue // no manager selected for this session

    let acc = managersById.get(row.reporting_manager_id)
    if (!acc) {
      acc = {
        full_name:   row.reporting_manager_name ?? '—',
        articleIds:  new Set(),
        groupsByKey: new Map(),
      }
      managersById.set(row.reporting_manager_id, acc)
    }
    acc.articleIds.add(row.article_id)

    const key = liveSessionGroupKey(row)
    let group = acc.groupsByKey.get(key)
    if (!group) {
      group = {
        // Exposed as-is so the UI can key its rendered groups on the same
        // identity used here — assignment_id alone can't do this (it's null
        // for both Unallocated and Others), and re-deriving a second key
        // client-side from label text would silently break again if the
        // label wording ever changed.
        group_key:     key,
        assignment_id: row.assignment_id,
        label:         liveSessionLabel(row),
        work_type:     row.work_type,
        articles:      [],
      }
      acc.groupsByKey.set(key, group)
    }
    group.articles.push({ article_id: row.article_id, full_name: row.article_name })
  }

  const managers: ReportingWiseManager[] = [...managersById.entries()].map(([id, acc]) => {
    for (const group of acc.groupsByKey.values()) {
      group.articles.sort((a, b) => a.full_name.localeCompare(b.full_name))
    }
    const live_groups = [...acc.groupsByKey.values()].sort((a, b) =>
      b.articles.length - a.articles.length || a.label.localeCompare(b.label)
    )
    return {
      reporting_manager_id: id,
      full_name:            acc.full_name,
      active_count:         acc.articleIds.size,
      live_groups,
    }
  })

  managers.sort((a, b) => b.active_count - a.active_count || a.full_name.localeCompare(b.full_name))

  return NextResponse.json({ managers })
}
