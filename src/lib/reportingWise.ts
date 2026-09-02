import type { LiveActivityRow } from '@/types/app'

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
  // A real profile UUID, or NO_MANAGER_KEY for the synthetic "No Reporting
  // Manager" category. Consumers only ever use this for React keys and
  // expand/collapse comparison, never to look up a profile, so the
  // synthetic string is safe to carry in the same field.
  reporting_manager_id: string
  full_name:            string
  active_count:         number
  live_groups:          ReportingWiseGroup[]
}

// Namespaced like the 'type:unallocated' / 'type:others' group keys below,
// so it can never collide with a real manager's UUID.
const NO_MANAGER_KEY = 'manager:none'

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
  if (row.assignment_id) return row.client_name ?? ''
  return row.attendance_type === 'others' ? 'Others' : 'Unallocated'
}

// Shared by the Reporting Wise report (Reports tab) and the Dashboard's
// Reporting Wise tile so both surfaces derive identical groupings from the
// same live-activity rows — one implementation, no risk of the two silently
// drifting apart. active_count and live_groups are built from the exact same
// pass over `rows`, so the top-level count always equals the drill-down
// population by construction.
export function groupLiveActivityByReportingManager(rows: LiveActivityRow[]): ReportingWiseManager[] {
  type ManagerAcc = {
    full_name:   string
    articleIds:  Set<string>
    groupsByKey: Map<string, ReportingWiseGroup>
  }
  const managersById = new Map<string, ManagerAcc>()

  for (const row of rows) {
    // NULL is a genuine, expected state — an unallocated check-in may
    // legitimately have nobody to report to. It must still be represented,
    // under the synthetic "No Reporting Manager" category, not dropped.
    const managerKey = row.reporting_manager_id ?? NO_MANAGER_KEY

    let acc = managersById.get(managerKey)
    if (!acc) {
      acc = {
        full_name:   row.reporting_manager_id ? (row.reporting_manager_name ?? '—') : 'No Reporting Manager',
        articleIds:  new Set(),
        groupsByKey: new Map(),
      }
      managersById.set(managerKey, acc)
    }
    acc.articleIds.add(row.article_id)

    const key = liveSessionGroupKey(row)
    let group = acc.groupsByKey.get(key)
    if (!group) {
      group = {
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
  return managers
}
