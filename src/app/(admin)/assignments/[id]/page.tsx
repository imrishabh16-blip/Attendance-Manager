import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { formatDate, formatTime, formatHours, workTypeBadgeColor, cn } from '@/lib/utils'
import { ArrowLeft, MapPin } from 'lucide-react'
import { buildMapsLink } from '@/lib/gps'

export default async function AssignmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, status')
    .eq('id', session.user.id)
    .single()

  if (!profile || profile.status !== 'active') redirect(profile?.status === 'deactivated' ? '/deactivated' : '/awaiting')
  if (profile.role === 'article') redirect('/attend')

  const { data: assignment } = await supabase
    .from('assignments')
    .select('*')
    .eq('id', id)
    .single()

  if (!assignment) notFound()

  // Fetch recent attendance sessions for this assignment.
  // Note: Supabase returns joined rows as an array even for many-to-one
  // relationships when using the string join syntax.
  const { data: sessions } = await supabase
    .from('attendance_records')
    .select('id, article_id, attendance_date, checked_in_at, checked_out_at, checked_in_lat, checked_in_lng, note, profiles!article_id(full_name)')
    .eq('assignment_id', id)
    .not('checked_out_at', 'is', null)
    .order('attendance_date', { ascending: false })
    .order('checked_in_at', { ascending: false })
    .limit(60)

  // Compute summary totals
  let totalHours = 0
  const uniqueDays = new Set<string>()
  const uniqueArticles = new Set<string>()

  for (const s of sessions ?? []) {
    if (s.checked_in_at && s.checked_out_at) {
      totalHours +=
        (new Date(s.checked_out_at).getTime() - new Date(s.checked_in_at).getTime()) /
        3_600_000
    }
    uniqueDays.add(s.attendance_date)
    uniqueArticles.add(s.article_id)
  }

  return (
    <div className="min-h-screen bg-brand-100">
      {/* Header */}
      <div className="bg-white border-b border-brand-200 px-4 sm:px-6 py-4">
        <div className="max-w-3xl mx-auto">
          <Link
            href="/assignments"
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-3"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Assignments
          </Link>

          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-lg font-bold text-gray-900">{assignment.client_name}</h1>
              <span
                className={cn(
                  'inline-block text-xs font-medium px-2 py-0.5 rounded-full mt-1',
                  workTypeBadgeColor(assignment.work_type)
                )}
              >
                {assignment.work_type}
              </span>
            </div>
            <Badge variant={assignment.status === 'active' ? 'success' : 'warning'}>
              {assignment.status}
            </Badge>
          </div>

          {assignment.notes && (
            <p className="text-sm text-gray-500 mt-2">{assignment.notes}</p>
          )}

          {/* Summary strip */}
          {uniqueDays.size > 0 && (
            <div className="flex gap-5 mt-4 text-sm">
              <div>
                <span className="font-semibold text-gray-900">{uniqueDays.size}</span>
                <span className="text-gray-400 ml-1">days</span>
              </div>
              <div>
                <span className="font-semibold text-gray-900">{formatHours(totalHours)}</span>
                <span className="text-gray-400 ml-1">total</span>
              </div>
              <div>
                <span className="font-semibold text-gray-900">{uniqueArticles.size}</span>
                <span className="text-gray-400 ml-1">
                  {uniqueArticles.size === 1 ? 'article' : 'articles'}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Attendance history */}
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5">
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
                No completed attendance sessions yet.
              </p>
            ) : (
              <ul className="divide-y divide-brand-100">
                {sessions.map((s: {
                  id: string
                  article_id: string
                  attendance_date: string
                  checked_in_at: string
                  checked_out_at: string
                  checked_in_lat: number | null
                  checked_in_lng: number | null
                  note: string | null
                  // Supabase string-join returns array even for many-to-one
                  profiles: { full_name: string }[] | null
                }) => {
                  const durationMins = Math.round(
                    (new Date(s.checked_out_at).getTime() - new Date(s.checked_in_at).getTime()) /
                      60_000
                  )
                  const h = Math.floor(durationMins / 60)
                  const m = durationMins % 60
                  const duration = h > 0 ? `${h}h ${m}m` : `${m}m`

                  return (
                    <li key={s.id} className="px-5 py-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium text-gray-900">
                              {(Array.isArray(s.profiles) ? s.profiles[0]?.full_name : null) ?? '—'}
                            </span>
                            <span className="text-xs text-gray-400">
                              {formatDate(s.attendance_date)}
                            </span>
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {formatTime(s.checked_in_at)} → {formatTime(s.checked_out_at)}
                            <span className="ml-2 font-medium text-brand-600">{duration}</span>
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
      </div>
    </div>
  )
}
