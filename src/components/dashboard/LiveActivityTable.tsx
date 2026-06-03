'use client'

import { useState, useEffect } from 'react'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { formatTime, formatDuration, workTypeBadgeColor, cn } from '@/lib/utils'
import type { LiveActivityRow } from '@/types/app'

interface Props {
  rows: LiveActivityRow[]
}

// Ticks every 60 seconds so the displayed elapsed time stays accurate
// without requiring a full DB round-trip.
function useMinuteTick() {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  return now
}

export function LiveActivityTable({ rows }: Props) {
  const now = useMinuteTick()

  if (rows.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-gray-400">
        No articles currently checked in
      </div>
    )
  }

  return (
    <Table>
      <Thead>
        <tr>
          <Th>Article</Th>
          <Th>Assignment</Th>
          <Th>Checked In</Th>
          <Th>Duration</Th>
        </tr>
      </Thead>
      <Tbody>
        {rows.map(row => {
          // Compute elapsed time client-side from the stored timestamp so the
          // display updates every minute without a DB round-trip.
          const elapsedMins = Math.max(
            0,
            Math.floor((now - new Date(row.checked_in_at).getTime()) / 60_000)
          )

          // Use attendance_type — not client_name — to drive the label.
          // get_live_activity returns coalesce(a.client_name, 'Others') so
          // client_name is never null; the ?? fallback would never fire.
          const clientLabel =
            row.attendance_type === 'regular'    ? (row.client_name ?? '—') :
            row.attendance_type === 'others'     ? 'Others' :
            /* unallocated */                       'Unallocated'

          return (
            <tr key={row.record_id} className="hover:bg-brand-50">
              <Td>
                <span className="font-medium text-gray-900">{row.article_name}</span>
              </Td>
              <Td>
                <div className="flex flex-col gap-0.5">
                  <span className="text-gray-900">{clientLabel}</span>
                  {row.work_type && (
                    <span className={cn(
                      'text-xs font-medium px-1.5 py-0.5 rounded-full w-fit',
                      workTypeBadgeColor(row.work_type)
                    )}>
                      {row.work_type}
                    </span>
                  )}
                </div>
              </Td>
              <Td>{formatTime(row.checked_in_at)}</Td>
              <Td>
                <span className="font-medium text-green-700">
                  {formatDuration(elapsedMins)}
                </span>
              </Td>
            </tr>
          )
        })}
      </Tbody>
    </Table>
  )
}
