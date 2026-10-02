'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import { BarChart3 } from 'lucide-react'
import type { ArticlePerformanceRow } from '@/lib/articlePerformance'

interface Props {
  articles: { id: string; full_name: string; status: string }[]
}

export default function ArticleAnalyticsClient({ articles }: Props) {
  const [articleId, setArticleId] = useState('')

  // Nothing is fetched until an article is selected: `enabled` keeps the
  // query idle, and the server filters and aggregates that one article in the
  // database layer. Switching article changes the key, which aborts the
  // in-flight request and starts the new one.
  const { data: rows, isLoading, isError } = useQuery({
    queryKey: ['article-performance', articleId],
    enabled:  articleId !== '',
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ article_id: articleId })
      const res = await fetch(`/api/article-analytics/performance?${params}`, { signal })
      if (!res.ok) throw new Error('Request failed')
      const { rows } = await res.json() as { rows: ArticlePerformanceRow[] }
      return rows
    },
  })

  return (
    <div className="min-h-screen bg-brand-100">
      <div className="bg-white border-b border-brand-200 px-4 sm:px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-lg font-bold text-gray-900">Article Analytics</h1>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-5">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-blue-600" />
              <h2 className="text-sm font-semibold text-gray-900">Article Performance</h2>
            </div>
          </CardHeader>
          <CardBody>
            <div className="flex flex-col gap-1 sm:max-w-sm">
              <label htmlFor="article-select" className="text-xs font-medium text-gray-500">Article</label>
              <select
                id="article-select"
                value={articleId}
                onChange={e => setArticleId(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="">Select Article</option>
                {articles.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.full_name}{a.status === 'deactivated' ? ' (Deactivated)' : ''}
                  </option>
                ))}
              </select>
            </div>
          </CardBody>

          {articleId !== '' && (
            <div className="border-t border-brand-200">
              {isLoading ? (
                <div className="p-5 space-y-2">
                  {[0, 1, 2, 3].map(i => (
                    <div key={i} className="h-12 bg-brand-100 rounded-xl animate-pulse" />
                  ))}
                </div>
              ) : isError ? (
                <p className="text-sm text-red-600 text-center py-8">Failed to load Article Performance</p>
              ) : !rows || rows.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-8">No attendance or leave recorded for this article</p>
              ) : (
                <Table>
                  <Thead>
                    <tr>
                      <Th>Month</Th>
                      <Th>Present Days</Th>
                      <Th>Half Days</Th>
                      <Th>Leaves</Th>
                      <Th>Unallocated Days</Th>
                    </tr>
                  </Thead>
                  <Tbody>
                    {rows.map(row => (
                      <tr key={row.month} className="hover:bg-brand-50">
                        <Td><span className="font-medium text-gray-900">{row.month}</span></Td>
                        <Td>{row.present_days}</Td>
                        <Td>{row.half_days}</Td>
                        <Td>{row.leaves}</Td>
                        <Td>{row.unallocated_days}</Td>
                      </tr>
                    ))}
                  </Tbody>
                </Table>
              )}
            </div>
          )}
        </Card>

        {articleId === '' && (
          <p className="text-sm text-gray-400 text-center py-8">Select an article to view month-wise performance.</p>
        )}
      </div>
    </div>
  )
}
