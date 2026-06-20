import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { formatDate, workTypeBadgeColor, cn } from '@/lib/utils'
import { ArrowLeft } from 'lucide-react'

type AttendanceRecordRow = {
  article_id:      string
  attendance_date: string
  profiles:        { full_name: string } | { full_name: string }[] | null
}

type ExperienceEntry = {
  article_id: string
  full_name:  string
  days:       number
  first:      string
  last:       string
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return (Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000
}

function extractName(profiles: AttendanceRecordRow['profiles']): string {
  if (Array.isArray(profiles)) return profiles[0]?.full_name ?? '—'
  if (profiles) return profiles.full_name
  return '—'
}

function buildExperience(records: AttendanceRecordRow[]): ExperienceEntry[] {
  // Collect distinct attendance dates and sort ascending
  const dateSet     = new Set(records.map(r => r.attendance_date))
  const sortedDates = [...dateSet].sort()

  if (sortedDates.length === 0) return []

  // Derive sessions using 7-day gap rule
  const sessions: string[][] = []
  let current = [sortedDates[0]]

  for (let i = 1; i < sortedDates.length; i++) {
    if (daysBetween(sortedDates[i - 1], sortedDates[i]) > 7) {
      sessions.push(current)
      current = [sortedDates[i]]
    } else {
      current.push(sortedDates[i])
    }
  }
  sessions.push(current)

  // Filter to latest session only
  const latestDates = new Set(sessions[sessions.length - 1])

  // Aggregate per-article within the latest session
  const byArticle = new Map<string, { full_name: string; dates: Set<string> }>()

  for (const r of records) {
    if (!latestDates.has(r.attendance_date)) continue
    if (!byArticle.has(r.article_id)) {
      byArticle.set(r.article_id, { full_name: extractName(r.profiles), dates: new Set() })
    }
    byArticle.get(r.article_id)!.dates.add(r.attendance_date)
  }

  // Sort: last attendance DESC, then days DESC
  return [...byArticle.entries()]
    .map(([article_id, e]) => {
      const sorted = [...e.dates].sort()
      return {
        article_id,
        full_name: e.full_name,
        days:      sorted.length,
        first:     sorted[0],
        last:      sorted[sorted.length - 1],
      }
    })
    .sort((a, b) => {
      if (a.last !== b.last) return a.last > b.last ? -1 : 1
      return b.days - a.days
    })
}

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

  const { data: rawRecords } = await supabase
    .from('attendance_records')
    .select('article_id, attendance_date, profiles!article_id(full_name)')
    .eq('assignment_id', id)
    .not('checked_in_at', 'is', null)
    .order('attendance_date', { ascending: true })

  const records    = (rawRecords ?? []) as AttendanceRecordRow[]
  const experience = buildExperience(records)

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
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5 space-y-4">
        {experience.length > 0 && (
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-gray-900">Assignment Experience</h2>
            </CardHeader>
            <CardBody className="p-0">
              <ul className="divide-y divide-brand-100">
                {experience.map(r => (
                  <li
                    key={r.article_id}
                    className="px-5 py-3.5 flex items-center justify-between gap-4"
                  >
                    <span className="text-sm font-medium text-gray-900 truncate min-w-0">
                      {r.full_name}
                    </span>
                    <div className="flex items-center gap-5 shrink-0 text-sm">
                      <span>
                        <span className="font-semibold text-gray-900">{r.days}</span>
                        <span className="ml-1 text-xs text-gray-400">days</span>
                      </span>
                      <span className="hidden sm:inline text-right">
                        <span className="text-xs text-gray-400 mr-1">first</span>
                        <span className="text-gray-500">{formatDate(r.first)}</span>
                      </span>
                      <span className="text-right">
                        <span className="text-xs text-gray-400 mr-1">last</span>
                        <span className="text-gray-600">{formatDate(r.last)}</span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  )
}
