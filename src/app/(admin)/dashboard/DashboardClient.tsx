'use client'

import { useState } from 'react'
import { useRealtimeDashboard } from '@/hooks/useRealtimeDashboard'
import { MetricCard } from '@/components/dashboard/MetricCard'
import { LiveActivityTable } from '@/components/dashboard/LiveActivityTable'
import { ArticleStatusGroups } from '@/components/dashboard/ArticleStatusGroups'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { RefreshCw, UserCheck, UserX, Users, Flag, ChevronDown, Search } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  profile: { id: string; full_name: string; role: string }
}

// File-local search input used in all three dashboard modals
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
  const { summary, liveActivity, onLeaveArticles, loading, refresh } = useRealtimeDashboard()

  const s = summary

  // Modal open states
  const [checkedInOpen,   setCheckedInOpen]   = useState(false)
  const [unallocatedOpen, setUnallocatedOpen] = useState(false)
  const [onLeaveOpen,     setOnLeaveOpen]     = useState(false)

  // Modal search states
  const [checkedInSearch,   setCheckedInSearch]   = useState('')
  const [unallocatedSearch, setUnallocatedSearch] = useState('')
  const [onLeaveSearch,     setOnLeaveSearch]     = useState('')

  // Currently Checked In section — collapsed by default
  const [liveExpanded, setLiveExpanded] = useState(false)

  // Unallocated count derived from already-fetched liveActivity — no extra query
  const unallocatedRows = liveActivity.filter(r => r.attendance_type === 'unallocated')

  // Filtered rows for modals
  const filteredCheckedIn = checkedInSearch.trim()
    ? liveActivity.filter(r => r.article_name.toLowerCase().includes(checkedInSearch.toLowerCase()))
    : liveActivity

  const filteredUnallocated = unallocatedSearch.trim()
    ? unallocatedRows.filter(r => r.article_name.toLowerCase().includes(unallocatedSearch.toLowerCase()))
    : unallocatedRows

  const filteredOnLeave = onLeaveSearch.trim()
    ? onLeaveArticles.filter(r => r.article_name.toLowerCase().includes(onLeaveSearch.toLowerCase()))
    : onLeaveArticles

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
            <div className="bg-white rounded-2xl border border-brand-200 shadow-sm h-32 animate-pulse" />
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
                onClick={() => setCheckedInOpen(true)}
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
                label="Flagged Records"
                value={s?.flagged_attendance ?? 0}
                icon={Flag}
                color="red"
                alert={(s?.flagged_attendance ?? 0) > 0}
                href="/flagged"
              />
            </div>

            {/* Currently Checked In — collapsed by default */}
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

            {/* Article Status — Assigned only */}
            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-gray-900">Article Status</h2>
              </CardHeader>
              <CardBody className="p-0">
                <ArticleStatusGroups liveActivity={liveActivity} />
              </CardBody>
            </Card>
          </>
        )}
      </div>

      {/* ── Checked In Today modal ── */}
      <Modal
        open={checkedInOpen}
        onClose={() => { setCheckedInOpen(false); setCheckedInSearch('') }}
        title="Checked In Today"
        className="sm:max-w-2xl"
      >
        <ModalSearch value={checkedInSearch} onChange={setCheckedInSearch} />
        <LiveActivityTable rows={filteredCheckedIn} />
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
    </div>
  )
}
