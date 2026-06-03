import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { ArrowLeft, MapPin } from 'lucide-react'
import { buildMapsLink } from '@/lib/gps'
import { formatDate, workTypeBadgeColor, cn } from '@/lib/utils'
import type { UserStatus, AttendanceType } from '@/types/app'

// IST-aware formatters for server components
const fmtTimeIST = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   true,
  })

const fmtDateIST = (iso: string) =>
  new Date(iso).toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day:      'numeric',
    month:    'short',
    year:     'numeric',
  })

function typeBadge(type: AttendanceType) {
  if (type === 'others')      return <Badge variant="warning" className="text-xs">Flagged</Badge>
  if (type === 'unallocated') return <Badge className="text-xs">Unallocated</Badge>
  return null
}

export default async function ArticleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) redirect('/login')

  const { data: viewer } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', session.user.id)
    .single()

  if (!viewer || viewer.status !== 'active') {
    redirect(viewer?.status === 'deactivated' ? '/deactivated' : '/awaiting')
  }
  if (viewer.role === 'article') redirect('/attend')

  // Fetch the article profile
  const { data: article } = await supabase
    .from('profiles')
    .select('id, full_name, email, status, role, created_at, approved_at')
    .eq('id', id)
    .single()

  if (!article || article.role !== 'article') notFound()

  // Fetch recent attendance (last 60 sessions, newest first)
  const { data: sessions } = await supabase
    .from('attendance_records')
    .select(`
      id, attendance_date, checked_in_at, checked_out_at,
      checked_in_lat, checked_in_lng,
      note, attendance_type, others_client_name,
      assignments(client_name, work_type)
    `)
    .eq('article_id', id)
    .order('attendance_date', { ascending: false })
    .order('checked_in_at',   { ascending: false })
    .limit(60)

  // Fetch leave records (last 30)
  const { data: leaves } = await supabase
    .from('leave_records')
    .select('id, leave_date, note')
    .eq('article_id', id)
    .order('leave_date', { ascending: false })
    .limit(30)

  // Compute summary from completed sessions
  let totalHours = 0
  const uniqueDays         = new Set<string>()
  const uniqueAssignments  = new Set<string>()

  for (const s of sessions ?? []) {
    uniqueDays.add(s.attendance_date)
    if (s.checked_in_at && s.checked_out_at) {
      totalHours +=
        (new Date(s.checked_out_at).getTime() - new Date(s.checked_in_at).getTime()) /
        3_600_000
    }
    const a = (s as unknown as { assignments?: { client_name: string } }).assignments
    if (a?.client_name) uniqueAssignments.add(a.client_name)
  }

  const h = Math.floor(totalHours)
  const m = Math.round((totalHours - h) * 60)
  const totalHoursLabel = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`

  return (
    <div className="min-h-screen bg-brand-100">
      {/* Header */}
      <div className="bg-white border-b border-brand-200 px-4 sm:px-6 py-4">
        <div className="max-w-3xl mx-auto">
          <Link
            href="/articles"
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-3"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Articles
          </Link>

          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-lg font-bold text-gray-900">{article.full_name}</h1>
              <p className="text-xs text-gray-400 mt-0.5">{article.email}</p>
              {article.approved_at && (
                <p className="text-xs text-gray-400 mt-0.5">
                  Joined {fmtDateIST(article.approved_at)}
                </p>
              )}
            </div>
            <StatusBadge status={article.status as UserStatus} />
          </div>

          {/* Summary strip */}
          {uniqueDays.size > 0 && (
            <div className="flex gap-5 mt-4 text-sm">
              <div>
                <span className="font-semibold text-gray-900">{uniqueDays.size}</span>
                <span className="text-gray-400 ml-1">days</span>
              </div>
              <div>
                <span className="font-semibold text-gray-900">{totalHoursLabel}</span>
                <span className="text-gray-400 ml-1">hours</span>
              </div>
              <div>
                <span className="font-semibold text-gray-900">{uniqueAssignments.size}</span>
                <span className="text-gray-400 ml-1">
                  {uniqueAssignments.size === 1 ? 'client' : 'clients'}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5 space-y-5">

        {/* Attendance history */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-gray-900">
              Attendance History
              {sessions && sessions.length > 0 && (
                <span className="ml-1.5 text-xs font-normal text-gray-400">
                  (last {sessions.length} sessions)
                </span>
              )}
            </h2>
          </CardHeader>
          <CardBody className="p-0">
            {!sessions || sessions.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10">
                No attendance records yet.
              </p>
            ) : (
              <ul className="divide-y divide-brand-100">
                {sessions.map(s => {
                  const asgn = (
                    s as unknown as { assignments?: { client_name: string; work_type: string } }
                  ).assignments

                  const type = s.attendance_type as AttendanceType

                  let clientLabel: string
                  if (type === 'unallocated') {
                    clientLabel = 'Unallocated'
                  } else if (asgn?.client_name) {
                    clientLabel = asgn.client_name
                  } else {
                    clientLabel = s.others_client_name ?? 'Others'
                  }

                  const durationMins =
                    s.checked_in_at && s.checked_out_at
                      ? Math.round(
                          (new Date(s.checked_out_at).getTime() -
                            new Date(s.checked_in_at).getTime()) /
                            60_000
                        )
                      : null

                  const dh = durationMins !== null ? Math.floor(durationMins / 60) : 0
                  const dm = durationMins !== null ? durationMins % 60 : 0
                  const durationLabel =
                    durationMins !== null
                      ? dh > 0
                        ? `${dh}h ${dm}m`
                        : `${dm}m`
                      : null

                  return (
                    <li key={s.id} className="px-5 py-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-gray-900">{clientLabel}</span>
                            {asgn?.work_type && (
                              <span className={cn(
                                'text-xs font-medium px-1.5 py-0.5 rounded-full',
                                workTypeBadgeColor(asgn.work_type)
                              )}>
                                {asgn.work_type}
                              </span>
                            )}
                            {typeBadge(type)}
                          </div>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {formatDate(s.attendance_date)}
                            {' · '}
                            {s.checked_in_at ? fmtTimeIST(s.checked_in_at) : '—'}
                            {' → '}
                            {s.checked_out_at
                              ? fmtTimeIST(s.checked_out_at)
                              : <span className="text-green-600 font-medium">Active</span>}
                            {durationLabel && (
                              <span className="ml-2 font-medium text-brand-600">{durationLabel}</span>
                            )}
                          </p>
                          {s.note && (
                            <p className="text-xs text-gray-400 mt-0.5 truncate">{s.note}</p>
                          )}
                        </div>
                        {s.checked_in_lat && (
                          <a
                            href={buildMapsLink(s.checked_in_lat, s.checked_in_lng!)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-brand-400 hover:text-brand-600 flex-shrink-0 mt-0.5"
                          >
                            <MapPin className="h-4 w-4" />
                          </a>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* Leave history */}
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-gray-900">
              Leave History
              {leaves && leaves.length > 0 && (
                <span className="ml-1.5 text-xs font-normal text-gray-400">
                  (last {leaves.length})
                </span>
              )}
            </h2>
          </CardHeader>
          <CardBody className="p-0">
            {!leaves || leaves.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No leave records.</p>
            ) : (
              <ul className="divide-y divide-brand-100">
                {leaves.map(l => (
                  <li key={l.id} className="px-5 py-3 flex items-center justify-between gap-3">
                    <span className="text-sm text-gray-700">{formatDate(l.leave_date)}</span>
                    {l.note && (
                      <span className="text-xs text-gray-400 truncate max-w-xs">{l.note}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: UserStatus }) {
  if (status === 'active')      return <Badge variant="success" className="text-xs">Active</Badge>
  if (status === 'deactivated') return <Badge variant="danger"  className="text-xs">Deactivated</Badge>
  return                               <Badge variant="warning" className="text-xs">Pending</Badge>
}
