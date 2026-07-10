'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import toast from 'react-hot-toast'
import { Download, FileSpreadsheet, Eye } from 'lucide-react'
import type { SessionReportRow } from '@/lib/export'

interface Props {
  articles:    { id: string; full_name: string }[]
  assignments: { id: string; client_name: string; work_type: string; status: string }[]
}

const ALL_ASSIGNMENTS = 'all'

export default function ReportsClient({ articles, assignments }: Props) {
  // Use IST date for default range — UTC split returns wrong date around midnight IST
  const today      = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
  const monthStart = today.slice(0, 8) + '01'

  const [startDate, setStart]           = useState(monthStart)
  const [endDate, setEnd]               = useState(today)
  const [articleId, setArticleId]       = useState('')
  const [assignmentId, setAssignmentId] = useState(ALL_ASSIGNMENTS)
  const [downloading, setDl]            = useState<'attendance' | 'assignments' | null>(null)

  const [previewOpen, setPreviewOpen]       = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewRows, setPreviewRows]       = useState<SessionReportRow[]>([])

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

  // Shared by preview and export so both hit the exact same query/derivation
  // on the server — only the response format differs.
  function sessionParams(extra?: Record<string, string>) {
    const params = new URLSearchParams(extra)
    if (assignmentId !== ALL_ASSIGNMENTS) params.set('assignment_id', assignmentId)
    return params
  }

  async function downloadAssignments() {
    setDl('assignments')
    const res = await fetch(`/api/export/assignments?${sessionParams()}`)
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

  async function openPreview() {
    setPreviewOpen(true)
    setPreviewLoading(true)
    const res = await fetch(`/api/export/assignments?${sessionParams({ format: 'json' })}`)
    if (!res.ok) {
      toast.error('Preview failed')
      setPreviewOpen(false)
      setPreviewLoading(false)
      return
    }
    const { rows } = await res.json() as { rows: SessionReportRow[] }
    setPreviewRows(rows)
    setPreviewLoading(false)
  }

  // Derived from previewRows — no additional query. For a single assignment
  // assignmentsCovered is naturally 1 (all rows share one assignment_label).
  const assignmentsCovered = new Set(previewRows.map(r => r.assignment_label)).size
  const totalSessions      = previewRows.length

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
                  <option value={ALL_ASSIGNMENTS}>All Assignments</option>
                  {assignments.map(a => (
                    <option key={a.id} value={a.id}>
                      {`${a.client_name} — ${a.work_type}${a.status !== 'active' ? ' (Archived)' : ''}`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  onClick={openPreview}
                  loading={previewLoading}
                  className="w-full sm:w-auto"
                >
                  <Eye className="h-4 w-4" />
                  Preview
                </Button>
                <Button
                  onClick={downloadAssignments}
                  loading={downloading === 'assignments'}
                  className="w-full sm:w-auto"
                >
                  <Download className="h-4 w-4" />
                  Export Session Report (.xlsx)
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Session Report preview */}
      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Session Report Preview"
        className="sm:max-w-5xl"
      >
        {previewLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map(i => (
              <div key={i} className="h-12 bg-brand-100 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : previewRows.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">No sessions found</p>
        ) : (
          <>
            <div className="flex gap-5 mb-4 text-sm">
              <div>
                <span className="font-semibold text-gray-900">{assignmentsCovered}</span>
                <span className="text-gray-400 ml-1">
                  {assignmentsCovered === 1 ? 'assignment covered' : 'assignments covered'}
                </span>
              </div>
              <div>
                <span className="font-semibold text-gray-900">{totalSessions}</span>
                <span className="text-gray-400 ml-1">
                  {totalSessions === 1 ? 'total session' : 'total sessions'}
                </span>
              </div>
            </div>
            <Table>
              <Thead>
                <tr>
                  <Th>Client</Th>
                  <Th>Work Type</Th>
                  <Th>Session</Th>
                  <Th>Articles</Th>
                  <Th>Article Names</Th>
                  <Th>Days</Th>
                  <Th>Hours</Th>
                  <Th>Status</Th>
                  <Th>First</Th>
                  <Th>Last</Th>
                </tr>
              </Thead>
              <Tbody>
                {previewRows.map((row, i) => (
                  <tr key={`${row.assignment_label}-${row.session_number}-${i}`} className="hover:bg-brand-50">
                    <Td>{row.client_name}</Td>
                    <Td>{row.work_type}</Td>
                    <Td>{row.session_number}</Td>
                    <Td>{row.articles_count}</Td>
                    <Td className="max-w-xs truncate">
                      <span title={row.article_names}>{row.article_names}</span>
                    </Td>
                    <Td>{row.attendance_days}</Td>
                    <Td>{row.total_hours}</Td>
                    <Td>
                      <span className={row.status === 'Active' ? 'text-green-700 font-medium' : 'text-blue-700 font-medium'}>
                        {row.status}
                      </span>
                    </Td>
                    <Td>{new Date(row.first_date).toLocaleDateString('en-IN')}</Td>
                    <Td>{new Date(row.last_date).toLocaleDateString('en-IN')}</Td>
                  </tr>
                ))}
              </Tbody>
            </Table>
          </>
        )}
      </Modal>
    </div>
  )
}
