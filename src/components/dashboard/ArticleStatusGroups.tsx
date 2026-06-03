'use client'

import { useState, useEffect } from 'react'
import { ChevronRight } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { formatDuration, formatTime, workTypeBadgeColor, cn } from '@/lib/utils'
import type { LiveActivityRow, OnLeaveArticleRow } from '@/types/app'

type GroupKey = 'assigned' | 'unallocated' | 'onleave'

interface Props {
  liveActivity:    LiveActivityRow[]
  onLeaveArticles: OnLeaveArticleRow[]
}

function useMinuteTick() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  return now
}

// ── Group header — clickable, shows count badge + chevron ──────────────────
function GroupHeader({
  label, count, color, onClick,
}: {
  label: string; count: number; color: string; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 mb-3 w-full group text-left py-1"
    >
      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
        {label}
      </span>
      <span className={cn('text-xs font-semibold px-1.5 py-0.5 rounded-full', color)}>
        {count}
      </span>
      <ChevronRight className="ml-auto h-3.5 w-3.5 text-gray-300 group-hover:text-gray-500 flex-shrink-0" />
    </button>
  )
}

// ── Main widget ────────────────────────────────────────────────────────────
export function ArticleStatusGroups({ liveActivity, onLeaveArticles }: Props) {
  const now = useMinuteTick()
  const [activeGroup, setActiveGroup] = useState<GroupKey | null>(null)

  const assigned    = liveActivity.filter(r => r.attendance_type === 'regular')
  const unallocated = liveActivity.filter(r => r.attendance_type !== 'regular')

  const modalTitles: Record<GroupKey, string> = {
    assigned:    'Assigned',
    unallocated: 'Unallocated',
    onleave:     'On Leave Today',
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">

        {/* ASSIGNED */}
        <div className="p-4">
          <GroupHeader
            label="Assigned"
            count={assigned.length}
            color="bg-blue-100 text-blue-700"
            onClick={() => setActiveGroup('assigned')}
          />
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

        {/* UNALLOCATED */}
        <div className="p-4">
          <GroupHeader
            label="Unallocated"
            count={unallocated.length}
            color="bg-amber-100 text-amber-700"
            onClick={() => setActiveGroup('unallocated')}
          />
          {unallocated.length === 0 ? (
            <p className="text-xs text-gray-400">None</p>
          ) : (
            <ul className="space-y-3">
              {unallocated.map(row => {
                const elapsed = Math.max(0, Math.floor((now - new Date(row.checked_in_at).getTime()) / 60_000))
                return (
                  <li key={row.record_id}>
                    <div className="font-medium text-sm text-gray-900">{row.article_name}</div>
                    <div className="text-xs text-green-700 font-medium mt-0.5">
                      {formatDuration(elapsed)}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* ON LEAVE */}
        <div className="p-4">
          <GroupHeader
            label="On Leave"
            count={onLeaveArticles.length}
            color="bg-rose-100 text-rose-700"
            onClick={() => setActiveGroup('onleave')}
          />
          {onLeaveArticles.length === 0 ? (
            <p className="text-xs text-gray-400">None</p>
          ) : (
            <ul className="space-y-1.5">
              {onLeaveArticles.map(row => (
                <li key={row.article_id} className="text-sm text-gray-700">
                  {row.article_name}
                </li>
              ))}
            </ul>
          )}
        </div>

      </div>

      {/* ── Drill-down modal ──────────────────────────────────────────────── */}
      <Modal
        open={activeGroup !== null}
        onClose={() => setActiveGroup(null)}
        title={activeGroup ? modalTitles[activeGroup] : ''}
      >
        {activeGroup === 'assigned' && (
          <AssignedDetail rows={assigned} now={now} />
        )}
        {activeGroup === 'unallocated' && (
          <UnallocatedDetail rows={unallocated} now={now} />
        )}
        {activeGroup === 'onleave' && (
          <OnLeaveDetail rows={onLeaveArticles} />
        )}
      </Modal>
    </>
  )
}

// ── Drill-down detail panels ───────────────────────────────────────────────

function AssignedDetail({ rows, now }: { rows: LiveActivityRow[]; now: number }) {
  if (rows.length === 0) {
    return <p className="text-sm text-gray-400 py-6 text-center">No articles currently assigned</p>
  }
  return (
    <ul className="space-y-4">
      {rows.map(row => {
        const elapsed = Math.max(0, Math.floor((now - new Date(row.checked_in_at).getTime()) / 60_000))
        return (
          <li key={row.record_id} className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-900 truncate">{row.article_name}</p>
              <p className="text-sm text-gray-600 mt-0.5 truncate">{row.client_name}</p>
              {row.work_type && (
                <span className={cn(
                  'inline-block text-xs font-medium px-1.5 py-0.5 rounded-full mt-1',
                  workTypeBadgeColor(row.work_type)
                )}>
                  {row.work_type}
                </span>
              )}
              <p className="text-xs text-gray-400 mt-1">
                In since {formatTime(row.checked_in_at)}
              </p>
            </div>
            <span className="text-sm font-bold text-green-700 flex-shrink-0 pt-0.5">
              {formatDuration(elapsed)}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function UnallocatedDetail({ rows, now }: { rows: LiveActivityRow[]; now: number }) {
  if (rows.length === 0) {
    return <p className="text-sm text-gray-400 py-6 text-center">No unallocated check-ins</p>
  }
  return (
    <ul className="space-y-4">
      {rows.map(row => {
        const elapsed = Math.max(0, Math.floor((now - new Date(row.checked_in_at).getTime()) / 60_000))
        return (
          <li key={row.record_id} className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold text-gray-900">{row.article_name}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                In since {formatTime(row.checked_in_at)}
              </p>
            </div>
            <span className="text-sm font-bold text-amber-700 flex-shrink-0 pt-0.5">
              {formatDuration(elapsed)}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function OnLeaveDetail({ rows }: { rows: OnLeaveArticleRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-gray-400 py-6 text-center">No one on leave today</p>
  }
  const today = new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
  return (
    <div>
      <p className="text-xs text-gray-400 mb-4">{today}</p>
      <ul className="space-y-3">
        {rows.map(row => (
          <li key={row.article_id} className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-rose-400 flex-shrink-0" />
            <span className="text-sm font-medium text-gray-800">{row.article_name}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
