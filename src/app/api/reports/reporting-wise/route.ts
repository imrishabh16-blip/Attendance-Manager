import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { groupLiveActivityByReportingManager } from '@/lib/reportingWise'
import type { LiveActivityRow } from '@/types/app'

export type { ReportingWiseArticle, ReportingWiseGroup, ReportingWiseManager } from '@/lib/reportingWise'

const ALLOWED_ROLES = ['admin', 'partner', 'manager']

// GET /api/reports/reporting-wise
// Reporting Manager is captured per check-in (attendance_records.
// reporting_manager_id, migration 00025), not administratively assigned.
// This report is derived entirely from get_live_activity() — the single
// existing definition of "currently checked in" — grouped by
// reporting_manager_id and then by assignment/category. The top-level count
// and the drill-down are therefore always the exact same underlying set:
// everyone currently checked in under that manager right now.
//
// Grouping logic lives in lib/reportingWise.ts, shared with the Dashboard's
// Reporting Wise tile so both surfaces derive identical results from the
// same live-activity rows — no separate relationship table, no duplicated
// grouping logic to drift out of sync.
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

  const managers = groupLiveActivityByReportingManager((liveRows ?? []) as LiveActivityRow[])

  return NextResponse.json({ managers })
}
