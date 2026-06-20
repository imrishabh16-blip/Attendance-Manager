'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import toast from 'react-hot-toast'
import { Download, FileSpreadsheet } from 'lucide-react'

interface Props {
  articles:    { id: string; full_name: string }[]
  assignments: { id: string; client_name: string; work_type: string; status: string }[]
}

export default function ReportsClient({ articles, assignments }: Props) {
  // Use IST date for default range — UTC split returns wrong date around midnight IST
  const today      = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  const monthStart = today.slice(0, 8) + '01'

  const [startDate, setStart]           = useState(monthStart)
  const [endDate, setEnd]               = useState(today)
  const [articleId, setArticleId]       = useState('')
  const [assignmentId, setAssignmentId] = useState('')
  const [downloading, setDl]            = useState<'attendance' | 'assignments' | null>(null)

  async function downloadAttendance() {
    if (!startDate || !endDate) { toast.error('Select date range'); return }
    setDl('attendance')
    const params = new URLSearchParams({ start_date: startDate, end_date: endDate })
    if (articleId) params.set('article_id', articleId)

    const res = await fetch(`/api/export/attendance?${params}`)
    if (!res.ok) { toast.error('Export failed'); setDl(null); return }

    const blob = await res.blob()
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `attendance_${startDate}_to_${endDate}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
    setDl(null)
    toast.success('Attendance report downloaded')
  }

  async function downloadAssignments() {
    if (!assignmentId) { toast.error('Select an assignment'); return }
    setDl('assignments')
    const res = await fetch(`/api/export/assignments?assignment_id=${assignmentId}`)
    if (!res.ok) { toast.error('Export failed'); setDl(null); return }

    const blob = await res.blob()
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `session_report_${today}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
    setDl(null)
    toast.success('Session report downloaded')
  }

  return (
    <div className="min-h-screen bg-brand-100">
      <div className="bg-white border-b border-brand-200 px-4 sm:px-6 py-4">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-lg font-bold text-gray-900">Reports & Export</h1>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5 space-y-4">
        {/* Attendance Report */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-green-600" />
              <h2 className="text-sm font-semibold text-gray-900">Attendance Report</h2>
            </div>
          </CardHeader>
          <CardBody>
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-500">From</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={e => setStart(e.target.value)}
                    className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-gray-500">To</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={e => setEnd(e.target.value)}
                    className="px-3 py-2.5 rounded-xl border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500">Article (optional — leave blank for all)</label>
                <select
                  value={articleId}
                  onChange={e => setArticleId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">All Articles</option>
                  {articles.map(a => (
                    <option key={a.id} value={a.id}>{a.full_name}</option>
                  ))}
                </select>
              </div>

              <Button
                onClick={downloadAttendance}
                loading={downloading === 'attendance'}
                className="w-full sm:w-auto"
              >
                <Download className="h-4 w-4" />
                Export Attendance (.xlsx)
              </Button>

              <p className="text-xs text-gray-400">
                Includes: Article, Assignment, Check-in/out times, Google Maps links, Hours, Status, Notes
              </p>
            </div>
          </CardBody>
        </Card>

        {/* Session Report */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-blue-600" />
              <h2 className="text-sm font-semibold text-gray-900">Session Report</h2>
            </div>
          </CardHeader>
          <CardBody>
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-gray-500">Assignment</label>
                <select
                  value={assignmentId}
                  onChange={e => setAssignmentId(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">Select Assignment</option>
                  {assignments.map(a => (
                    <option key={a.id} value={a.id}>
                      {`${a.client_name} — ${a.work_type}${a.status !== 'active' ? ' (Archived)' : ''}`}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                onClick={downloadAssignments}
                loading={downloading === 'assignments'}
                disabled={!assignmentId}
                variant="secondary"
                className="w-full sm:w-auto"
              >
                <Download className="h-4 w-4" />
                Export Session Report (.xlsx)
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
