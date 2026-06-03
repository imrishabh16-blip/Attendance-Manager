'use client'

import { useState, useEffect } from 'react'
import { formatDuration, workTypeBadgeColor, cn } from '@/lib/utils'
import type { LiveActivityRow, OnLeaveArticleRow } from '@/types/app'

interface Props {
  liveActivity:     LiveActivityRow[]
  onLeaveArticles:  OnLeaveArticleRow[]
}

function useMinuteTick() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  return now
}

function GroupHeader({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</span>
      <span className={cn('text-xs font-semibold px-1.5 py-0.5 rounded-full', color)}>
        {count}
      </span>
    </div>
  )
}

export function ArticleStatusGroups({ liveActivity, onLeaveArticles }: Props) {
  const now = useMinuteTick()

  const assigned    = liveActivity.filter(r => r.attendance_type === 'regular')
  const unallocated = liveActivity.filter(r => r.attendance_type !== 'regular')

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">

      {/* ASSIGNED */}
      <div className="p-4">
        <GroupHeader label="Assigned" count={assigned.length} color="bg-blue-100 text-blue-700" />
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
                  <div className="text-xs text-green-700 font-medium mt-0.5">{formatDuration(elapsed)}</div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* UNALLOCATED */}
      <div className="p-4">
        <GroupHeader label="Unallocated" count={unallocated.length} color="bg-amber-100 text-amber-700" />
        {unallocated.length === 0 ? (
          <p className="text-xs text-gray-400">None</p>
        ) : (
          <ul className="space-y-3">
            {unallocated.map(row => {
              const elapsed = Math.max(0, Math.floor((now - new Date(row.checked_in_at).getTime()) / 60_000))
              return (
                <li key={row.record_id}>
                  <div className="font-medium text-sm text-gray-900">{row.article_name}</div>
                  <div className="text-xs text-green-700 font-medium mt-0.5">{formatDuration(elapsed)}</div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* ON LEAVE */}
      <div className="p-4">
        <GroupHeader label="On Leave" count={onLeaveArticles.length} color="bg-rose-100 text-rose-700" />
        {onLeaveArticles.length === 0 ? (
          <p className="text-xs text-gray-400">None</p>
        ) : (
          <ul className="space-y-1.5">
            {onLeaveArticles.map(row => (
              <li key={row.article_id} className="text-sm text-gray-700">{row.article_name}</li>
            ))}
          </ul>
        )}
      </div>

    </div>
  )
}
