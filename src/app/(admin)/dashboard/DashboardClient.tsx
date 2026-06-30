'use client'

import { useState, useMemo } from 'react'
import { useRealtimeDashboard } from '@/hooks/useRealtimeDashboard'
import { MetricCard } from '@/components/dashboard/MetricCard'
import { LiveActivityTable } from '@/components/dashboard/LiveActivityTable'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { RefreshCw, UserCheck, UserX, Users, Layers, ChevronDown, Search, Download, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn, formatTime, workTypeBadgeColor } from '@/lib/utils'
import type { TodaySessionItem } from '@/app/api/dashboard/today-sessions/route'

interface Props {
  profile: { id: string; full_name: string; role: string }
}

// TodaySessionItem is imported from the API route — flat shape, names pre-resolved server-side
type TodaySessionRow = TodaySessionItem

function ModalSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative mb-4">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Search article..."
        className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-brand-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
      />
    </div>
  )
}

export default function DashboardClient({ profile: _ }: Props) {
  const { summary, liveActivity, onLeaveArticles, awolArticles, loading, refresh } = useRealtimeDashboard()

  const s = summary

  // ── Checked In Today modal — lazy loaded via server API ──────────────────
  const [checkedInOpen,        setCheckedInOpen]        = useState(false)
  const [checkedInSearch,      setCheckedInSearch]      = useState('')
  const [todaySessionsData,    setTodaySessionsData]    = useState<TodaySessionRow[] | null>(null)
  const [todaySessionsLoading, setTodaySessionsLoading] = useState(false)

  async function openCheckedInModal() {
    setCheckedInOpen(true)
    setTodaySessionsLoading(true)
    setTodaySessionsData(null)
    try {
      const res = await fetch('/api/dashboard/today-sessions')
      if (res.ok) {
        const { data } = await res.json() as { data: TodaySessionRow[] }
        setTodaySessionsData(data)
      }
    } catch {
      // Network failure — loading cleared, modal shows empty state
    } finally {
      setTodaySessionsLoading(false)
    }
  }

  const filteredTodaySessions = checkedInSearch.trim() && todaySessionsData
    ? todaySessionsData.filter(r =>
        r.article_name.toLowerCase().includes(checkedInSearch.toLowerCase())
      )
    : (todaySessionsData ?? [])

  // ── Unallocated modal ─────────────────────────────────────────────────────
  const [unallocatedOpen,   setUnallocatedOpen]   = useState(false)
  const [unallocatedSearch, setUnallocatedSearch] = useState('')

  const unallocatedRows = liveActivity.filter(r => r.attendance_type === 'unallocated')

  const filteredUnallocated = unallocatedSearch.trim()
    ? unallocatedRows.filter(r => r.article_name.toLowerCase().includes(unallocatedSearch.toLowerCase()))
    : unallocatedRows

  // ── Work Wise modal ───────────────────────────────────────────────────────
  // Distribution of currently checked-in articles across work types. Derived
  // from liveActivity (open sessions only) — regular check-ins carry a
  // work_type; unallocated/others rows have work_type = null and are excluded.
  const [workWiseOpen, setWorkWiseOpen] = useState(false)

  const workWiseCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const r of liveActivity) {
      if (r.attendance_type === 'regular' && r.work_type) {
        map.set(r.work_type, (map.get(r.work_type) ?? 0) + 1)
      }
    }
    return [...map.entries()]
      .map(([work_type, count]) => ({ work_type, count }))
      .sort((a, b) => b.count - a.count || a.work_type.localeCompare(b.work_type))
  }, [liveActivity])

  // ── On Leave modal ────────────────────────────────────────────────────────
  const [onLeaveOpen,   setOnLeaveOpen]   = useState(false)
  const [onLeaveSearch, setOnLeaveSearch] = useState('')

  const filteredOnLeave = onLeaveSearch.trim()
    ? onLeaveArticles.filter(r => r.article_name.toLowerCase().includes(onLeaveSearch.toLowerCase()))
    : onLeaveArticles

  // ── AWOL section ─────────────────────────────────────────────────────────
  const [awolExpanded, setAwolExpanded] = useState(false)
  const [awolSearch,   setAwolSearch]   = useState('')

  const filteredAwol = awolSearch.trim()
    ? awolArticles.filter(r => r.article_name.toLowerCase().includes(awolSearch.toLowerCase()))
    : awolArticles

  // ── Status Report download ────────────────────────────────────────────────
  const [srLoading, setSrLoading] = useState(false)

  async function downloadStatusReport() {
    setSrLoading(true)
    try {
      const res = await fetch('/api/export/status-report')
      if (!res.ok) { toast.error('Status report failed'); return }
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
      const blob  = await res.blob()
      const url   = URL.createObjectURL(blob)
      const a     = document.createElement('a')
      a.href      = url
      a.download  = `Status-Report-${today}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Status report failed')
    } finally {
      setSrLoading(false)
    }
  }

  // ── Currently Checked In section ──────────────────────────────────────────
  const [liveExpanded, setLiveExpanded] = useState(false)

  return (
    <div className="min-h-screen bg-brand-100">
      {/* Header */}
      <div className="bg-white border-b border-brand-200 px-4 sm:px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Dashboard</h1>
            <p className="text-xs text-gray-400">
              {new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400 hidden sm:block">
              Realtime
              <span className="inline-block w-1.5 h-1.5 bg-green-500 rounded-full ml-1.5 animate-pulse" />
            </span>
            <button onClick={refresh} className="p-3 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {loading ? (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="bg-white rounded-2xl border border-brand-200 shadow-sm p-4 flex flex-col gap-3 animate-pulse">
                  <div className="w-10 h-10 rounded-xl bg-brand-100" />
                  <div className="space-y-1.5">
                    <div className="h-7 w-10 bg-brand-100 rounded" />
                    <div className="h-3 w-28 bg-gray-100 rounded" />
                  </div>
                </div>
              ))}
            </div>
            <div className="bg-white rounded-2xl border border-brand-200 shadow-sm h-40 animate-pulse" />
          </>
        ) : (
          <>
            {/* Metric strip — 4 cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MetricCard
                label="Checked In Today"
                value={s?.active_articles_today ?? 0}
                icon={UserCheck}
                color="green"
                onClick={openCheckedInModal}
              />
              <MetricCard
                label="Unallocated"
                value={unallocatedRows.length}
                icon={Users}
                color="amber"
                onClick={() => setUnallocatedOpen(true)}
              />
              <MetricCard
                label="On Leave"
                value={s?.on_leave_today ?? 0}
                icon={UserX}
                color="amber"
                onClick={() => setOnLeaveOpen(true)}
              />
              <MetricCard
                label="Work Wise"
                value={workWiseCounts.length}
                icon={Layers}
                color="purple"
                onClick={() => setWorkWiseOpen(true)}
              />
            </div>

            {/* Currently Checked In — collapsible */}
            <Card>
              <CardHeader>
                <button
                  onClick={() => setLiveExpanded(e => !e)}
                  className="flex items-center justify-between w-full group"
                >
                  <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                    <span className="inline-block w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                    Currently Checked In ({liveActivity.length})
                  </h2>
                  <ChevronDown className={cn(
                    'h-4 w-4 text-gray-400 transition-transform group-hover:text-gray-600',
                    liveExpanded && 'rotate-180'
                  )} />
                </button>
              </CardHeader>
              {liveExpanded && (
                <CardBody className="p-0">
                  <LiveActivityTable rows={liveActivity} />
                </CardBody>
              )}
            </Card>

            {/* AWOL — collapsible */}
            <Card>
              <CardHeader>
                <button
                  onClick={() => setAwolExpanded(e => !e)}
                  className="flex items-center justify-between w-full group"
                >
                  <h2 className="text-sm font-semibold text-gray-900">
                    AWOL ({awolArticles.length})
                  </h2>
                  <ChevronDown className={cn(
                    'h-4 w-4 text-gray-400 transition-transform group-hover:text-gray-600',
                    awolExpanded && 'rotate-180'
                  )} />
                </button>
              </CardHeader>
              {awolExpanded && (
                <CardBody>
                  <ModalSearch value={awolSearch} onChange={setAwolSearch} />
                  {filteredAwol.length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">
                      {awolSearch.trim() ? 'No results' : 'All articles accounted for'}
                    </p>
                  ) : (
                    <ul className="divide-y divide-brand-100">
                      {filteredAwol.map(r => (
                        <li key={r.article_id} className="py-3 text-sm font-medium text-gray-800">
                          {r.article_name}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardBody>
              )}
            </Card>
            {/* Status Report */}
            <div className="flex justify-end pt-1">
              <button
                onClick={downloadStatusReport}
                disabled={srLoading}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium bg-white text-brand-700 border border-brand-200 hover:bg-brand-50 rounded-xl transition-colors disabled:opacity-50"
              >
                {srLoading
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Download className="h-4 w-4" />
                }
                Status Report
              </button>
            </div>
          </>
        )}
      </div>

      {/* ── Checked In Today modal — lazy-loaded, responsive ── */}
      <Modal
        open={checkedInOpen}
        onClose={() => { setCheckedInOpen(false); setCheckedInSearch(''); setTodaySessionsData(null) }}
        title="Checked In Today"
        className="sm:max-w-2xl"
      >
        <ModalSearch value={checkedInSearch} onChange={setCheckedInSearch} />

        {todaySessionsLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map(i => (
              <div key={i} className="h-14 bg-brand-100 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : filteredTodaySessions.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No attendance records today</p>
        ) : (
          <>
            {/* Mobile: stacked card list */}
            <ul className="space-y-2 sm:hidden">
              {filteredTodaySessions.map(row => (
                <li key={row.id} className="bg-brand-50 rounded-xl px-4 py-3 space-y-1">
                  <p className="text-sm font-semibold text-gray-900">{row.article_name}</p>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs text-gray-600">{row.client_label}</span>
                    {row.work_type && (
                      <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded-full', workTypeBadgeColor(row.work_type))}>
                        {row.work_type}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">
                    {formatTime(row.checked_in_at)}
                    {' → '}
                    {row.checked_out_at
                      ? formatTime(row.checked_out_at)
                      : <span className="text-green-600 font-medium">Active</span>
                    }
                  </p>
                </li>
              ))}
            </ul>

            {/* Desktop: table */}
            <div className="hidden sm:block">
              <Table>
                <Thead>
                  <tr>
                    <Th>Article</Th>
                    <Th>Assignment</Th>
                    <Th>Checked In</Th>
                    <Th>Checked Out</Th>
                  </tr>
                </Thead>
                <Tbody>
                  {filteredTodaySessions.map(row => (
                    <tr key={row.id} className="hover:bg-brand-50">
                      <Td>
                        <span className="font-medium text-gray-900">{row.article_name}</span>
                      </Td>
                      <Td>
                        <div className="flex flex-col gap-0.5">
                          <span>{row.client_label}</span>
                          {row.work_type && (
                            <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded-full w-fit', workTypeBadgeColor(row.work_type))}>
                              {row.work_type}
                            </span>
                          )}
                        </div>
                      </Td>
                      <Td>{formatTime(row.checked_in_at)}</Td>
                      <Td>
                        {row.checked_out_at
                          ? <span>{formatTime(row.checked_out_at)}</span>
                          : <span className="text-green-600 font-medium">Active</span>
                        }
                      </Td>
                    </tr>
                  ))}
                </Tbody>
              </Table>
            </div>
          </>
        )}
      </Modal>

      {/* ── Unallocated modal ── */}
      <Modal
        open={unallocatedOpen}
        onClose={() => { setUnallocatedOpen(false); setUnallocatedSearch('') }}
        title="Unallocated"
      >
        <ModalSearch value={unallocatedSearch} onChange={setUnallocatedSearch} />
        {filteredUnallocated.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No unallocated check-ins</p>
        ) : (
          <ul className="divide-y divide-brand-100">
            {filteredUnallocated.map(r => (
              <li key={r.record_id} className="py-3 text-sm font-medium text-gray-800">
                {r.article_name}
              </li>
            ))}
          </ul>
        )}
      </Modal>

      {/* ── On Leave modal ── */}
      <Modal
        open={onLeaveOpen}
        onClose={() => { setOnLeaveOpen(false); setOnLeaveSearch('') }}
        title="On Leave Today"
      >
        <ModalSearch value={onLeaveSearch} onChange={setOnLeaveSearch} />
        {filteredOnLeave.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No one on leave today</p>
        ) : (
          <ul className="divide-y divide-brand-100">
            {filteredOnLeave.map(r => (
              <li key={r.article_id} className="py-3 text-sm font-medium text-gray-800">
                {r.article_name}
              </li>
            ))}
          </ul>
        )}
      </Modal>

      {/* ── Work Wise modal ── */}
      <Modal
        open={workWiseOpen}
        onClose={() => setWorkWiseOpen(false)}
        title="Work Wise Articles"
      >
        {workWiseCounts.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No articles currently on client work</p>
        ) : (
          <Table>
            <Thead>
              <tr>
                <Th>Work Type</Th>
                <Th>Count</Th>
              </tr>
            </Thead>
            <Tbody>
              {workWiseCounts.map(row => (
                <tr key={row.work_type}>
                  <Td>
                    <span className="font-medium text-gray-900">{row.work_type}</span>
                  </Td>
                  <Td>
                    <span className="font-semibold text-gray-900">{row.count}</span>
                  </Td>
                </tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Modal>
    </div>
  )
}
