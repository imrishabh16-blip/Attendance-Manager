'use client'

import { useState, useEffect } from 'react'
import { ChevronRight, Search } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { LiveActivityTable } from '@/components/dashboard/LiveActivityTable'
import { formatDuration, workTypeBadgeColor, cn } from '@/lib/utils'
import type { LiveActivityRow } from '@/types/app'

interface Props {
  liveActivity: LiveActivityRow[]
}

function useMinuteTick() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  return now
}

export function ArticleStatusGroups({ liveActivity }: Props) {
  const now = useMinuteTick()
  const [modalOpen, setModalOpen] = useState(false)
  const [search, setSearch]       = useState('')

  const assigned = liveActivity.filter(
    r => r.attendance_type === 'regular' || r.attendance_type === 'others'
  )

  const filteredAssigned = search.trim()
    ? assigned.filter(r => r.article_name.toLowerCase().includes(search.toLowerCase()))
    : assigned

  return (
    <>
      <div className="p-4">
        {/* Group header — clickable */}
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-2 mb-3 w-full group text-left py-1"
        >
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Assigned
          </span>
          <span className="text-xs font-semibold px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">
            {assigned.length}
          </span>
          <ChevronRight className="ml-auto h-3.5 w-3.5 text-gray-300 group-hover:text-gray-500 flex-shrink-0" />
        </button>

        {/* Preview list */}
        {assigned.length === 0 ? (
          <p className="text-xs text-gray-400">None</p>
        ) : (
          <ul className="space-y-3">
            {assigned.map(row => {
              const elapsed = Math.max(0, Math.floor((now - new Date(row.checked_in_at).getTime()) / 60_000))
              return (
                <li key={row.record_id}>
                  <div className="font-medium text-sm text-gray-900">{row.article_name}</div>
                  <div className="text-xs text-gray-600 mt-0.5">{row.client_name}</div>
                  {row.work_type && (
                    <span className={cn(
                      'inline-block text-xs font-medium px-1.5 py-0.5 rounded-full mt-0.5',
                      workTypeBadgeColor(row.work_type)
                    )}>
                      {row.work_type}
                    </span>
                  )}
                  <div className="text-xs text-green-700 font-medium mt-0.5">
                    {formatDuration(elapsed)}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Assigned detail modal with search */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setSearch('') }}
        title="Assigned"
        className="sm:max-w-2xl"
      >
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search article..."
            className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-brand-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
          />
        </div>
        <LiveActivityTable rows={filteredAssigned} />
      </Modal>
    </>
  )
}
