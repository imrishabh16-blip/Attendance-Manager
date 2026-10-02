'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Users } from 'lucide-react'
import { MetricCard } from '@/components/dashboard/MetricCard'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import type { ArticleAnalyticsRow } from '@/lib/workDuration'

interface Props {
  // Already loaded with the Dashboard — this component makes no request for it.
  total: number
}

export function ArticleAnalyticsSection({ total }: Props) {
  const [startDate, setStartDate] = useState('')

  // IST date, same convention as the rest of the app — UTC split is wrong
  // around midnight IST. Caps the picker; a later date would just be empty.
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

  // Nothing is fetched until a Start Date exists: `enabled` keeps the query
  // idle, and the server only reads attendance on/after that date.
  const { data: rows, isLoading, isError } = useQuery({
    queryKey: ['article-analytics', startDate],
    enabled:  startDate !== '',
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/dashboard/article-analytics?start_date=${startDate}`, { signal })
      if (!res.ok) throw new Error('Request failed')
      const { rows } = await res.json() as { rows: ArticleAnalyticsRow[] }
      return rows
    },
  })

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-gray-900">Article Analytics</h2>

      <MetricCard label="Total Articles" value={total} icon={Users} color="blue" wide />

      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-gray-900">Work Duration by Article</h3>
            <div className="flex items-center gap-2">
              <label htmlFor="article-analytics-start" className="text-xs font-medium text-gray-500">
                Start Date
              </label>
              <input
                id="article-analytics-start"
                type="date"
                value={startDate}
                max={today}
                onChange={e => setStartDate(e.target.value)}
                className="px-3 py-2 rounded-xl border border-brand-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>
        </CardHeader>

        <CardBody className={rows && rows.length > 0 ? 'p-0' : undefined}>
          {startDate === '' ? (
            <p className="text-sm text-gray-400 text-center py-8">Select a start date to view analytics.</p>
          ) : isLoading ? (
            <div className="space-y-2">
              {[0, 1, 2].map(i => (
                <div key={i} className="h-12 bg-brand-100 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : isError ? (
            <p className="text-sm text-red-600 text-center py-8">Failed to load analytics</p>
          ) : !rows || rows.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">No client attendance from this date</p>
          ) : (
            <Table>
              <Thead>
                <tr>
                  <Th>Article</Th>
                  <Th>Clients Worked</Th>
                  <Th>Days Worked</Th>
                  <Th>Hours</Th>
                </tr>
              </Thead>
              <Tbody>
                {rows.map(row => (
                  <tr key={row.article_id} className="hover:bg-brand-50">
                    <Td><span className="font-medium text-gray-900">{row.article_name}</span></Td>
                    <Td>{row.clients_worked}</Td>
                    <Td>{row.days_worked}</Td>
                    <Td>{row.hours_worked}</Td>
                  </tr>
                ))}
              </Tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </section>
  )
}
