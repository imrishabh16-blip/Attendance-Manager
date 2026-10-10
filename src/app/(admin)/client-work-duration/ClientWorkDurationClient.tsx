'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/Button'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Table, Thead, Tbody, Th, Td } from '@/components/ui/Table'
import toast from 'react-hot-toast'
import { Download, FileSpreadsheet } from 'lucide-react'
import type { ClientWorkSlot } from '@/lib/workDuration'

interface Props {
  clients: string[]
}

// Hands a downloaded blob to the browser as a file.
function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  a.href     = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

export default function ClientWorkDurationClient({ clients }: Props) {
  const [clientName, setClientName]     = useState('')
  const [exporting, setExporting]       = useState(false)
  const [exportingAll, setExportingAll] = useState(false)

  // Nothing is fetched until a client is selected: `enabled` keeps the query
  // idle, and the server filters attendance to that one client in the
  // database. Switching client changes the key, which aborts the in-flight
  // request and starts the new one.
  const { data: rows, isLoading, isError } = useQuery({
    queryKey: ['client-work-duration', clientName],
    enabled:  clientName !== '',
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({ client_name: clientName, format: 'json' })
      const res = await fetch(`/api/export/client-work-duration?${params}`, { signal })
      if (!res.ok) throw new Error('Request failed')
      const { rows } = await res.json() as { rows: ClientWorkSlot[] }
      return rows
    },
  })

  // Same endpoint and client as the preview fetch, without format=json —
  // server returns the .xlsx binary built from the exact same
  // deriveClientWorkDuration() result. Mirrors ReportsClient's download
  // pattern.
  async function downloadExcel() {
    if (!clientName) return
    setExporting(true)
    try {
      const res = await fetch(`/api/export/client-work-duration?${new URLSearchParams({ client_name: clientName })}`)
      if (!res.ok) { toast.error('Export failed'); return }

      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
      const safeClient = clientName.replace(/[^a-zA-Z0-9]+/g, '_')
      saveBlob(await res.blob(), `client_analytics_${safeClient}_${today}.xlsx`)
    } catch {
      toast.error('Export failed')
    } finally {
      setExporting(false)
    }
  }

  // Export-only: the server aggregates every client from a single attendance
  // query and returns just the .xlsx. Nothing is rendered or held in the
  // browser, and there is deliberately no JSON form of this report.
  async function downloadAllClientsExcel() {
    setExportingAll(true)
    try {
      const res = await fetch(`/api/export/client-work-duration?${new URLSearchParams({ export: 'all_clients' })}`)
      if (!res.ok) { toast.error('Export failed'); return }

      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
      saveBlob(await res.blob(), `client_analytics_All_Clients_${today}.xlsx`)
    } catch {
      toast.error('Export failed')
    } finally {
      setExportingAll(false)
    }
  }

  return (
    <div className="min-h-screen bg-brand-100">
      <div className="bg-white border-b border-brand-200 px-4 sm:px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
          <h1 className="text-lg font-bold text-gray-900">Client Analytics</h1>
          <Button onClick={downloadExcel} loading={exporting} disabled={!clientName}>
            <Download className="h-4 w-4" />
            Export Excel
          </Button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5">
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-blue-600" />
                <h2 className="text-sm font-semibold text-gray-900">Work Slots by Client</h2>
              </div>
              <div className="flex flex-col gap-2 w-full sm:w-auto">
                <select
                  aria-label="Client"
                  value={clientName}
                  onChange={e => setClientName(e.target.value)}
                  className="w-full sm:w-72 px-3 py-2 rounded-xl border border-brand-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">Select a client…</option>
                  {clients.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <Button variant="secondary" onClick={downloadAllClientsExcel} loading={exportingAll} className="w-full">
                  <Download className="h-4 w-4" />
                  Export All Clients
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardBody className={rows && rows.length > 0 ? 'p-0' : undefined}>
            {clientName === '' ? (
              <p className="text-sm text-gray-400 text-center py-8">Select a client to view work slots.</p>
            ) : isLoading ? (
              <div className="p-5 space-y-2">
                {[0, 1, 2, 3].map(i => (
                  <div key={i} className="h-12 bg-brand-100 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : isError ? (
              <p className="text-sm text-red-600 text-center py-8">Failed to load Client Analytics</p>
            ) : !rows || rows.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-8">No work slots found for this client</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <Thead>
                    <tr>
                      <Th>Client</Th>
                      <Th>Work Slot</Th>
                      <Th>Articles</Th>
                      <Th>Article Names</Th>
                      <Th>Department Type</Th>
                      <Th>Work Days</Th>
                      <Th>Article Days</Th>
                      <Th>Status</Th>
                      <Th>First Punch</Th>
                      <Th>Last Punch</Th>
                    </tr>
                  </Thead>
                  <Tbody>
                    {rows.map((row, i) => (
                      <tr key={`${row.client_name}-${row.slot_number}-${i}`} className="hover:bg-brand-50">
                        <Td>{row.client_name}</Td>
                        <Td>{row.slot_number}</Td>
                        <Td>{row.articles_count}</Td>
                        <Td className="max-w-xs truncate">
                          <span title={row.article_names}>{row.article_names}</span>
                        </Td>
                        <Td className="max-w-xs truncate">
                          <span title={row.department_types}>{row.department_types}</span>
                        </Td>
                        <Td>{row.attendance_days}</Td>
                        <Td>{row.article_days}</Td>
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
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
