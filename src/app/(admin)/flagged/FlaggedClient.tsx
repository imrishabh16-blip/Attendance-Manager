'use client'

import { useState } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import toast from 'react-hot-toast'
import { formatDate, formatTime, workTypeBadgeColor, cn } from '@/lib/utils'
import type { FlaggedRecord, AttendanceType } from '@/types/app'
import { CheckCircle, UserPlus, Link2 } from 'lucide-react'

interface Props {
  records: FlaggedRecord[]
}

interface ClientOption {
  id:   string
  name: string
}

function flagReason(r: FlaggedRecord): string {
  if (r.attendance_type === 'others') {
    return r.others_client_name
      ? `Unknown client: "${r.others_client_name}"`
      : 'Unknown client'
  }
  if (!r.assignment_id) return 'Missing assignment'
  return 'Flagged for review'
}

function AttendanceTypeBadge({ type }: { type: AttendanceType }) {
  const map: Record<AttendanceType, { label: string; className: string }> = {
    regular:     { label: 'Regular',     className: 'bg-blue-100 text-blue-700' },
    others:      { label: 'Others',      className: 'bg-orange-100 text-orange-700' },
    unallocated: { label: 'Unallocated', className: 'bg-gray-100 text-gray-600' },
  }
  const { label, className } = map[type]
  return (
    <span className={cn('text-xs font-medium px-1.5 py-0.5 rounded-full', className)}>
      {label}
    </span>
  )
}

export default function FlaggedClient({ records: initial }: Props) {
  const supabase = getSupabaseBrowserClient()

  const [records, setRecords]             = useState(initial)
  const [tab, setTab]                     = useState<'pending' | 'resolved'>('pending')
  const [working, setWorking]             = useState<string | null>(null)
  const [resolveModal, setResolveModal]   = useState<FlaggedRecord | null>(null)
  const [resolveMode, setResolveMode]     = useState<'new' | 'existing'>('new')
  const [clientOptions, setClientOptions] = useState<ClientOption[]>([])
  const [newClientName, setNewClientName] = useState('')
  const [selectedClientId, setSelectedClientId] = useState('')

  const pending   = records.filter(r => r.flagged_for_review)
  const resolved  = records.filter(r => !r.flagged_for_review)
  const displayed = tab === 'pending' ? pending : resolved

  async function openResolveModal(record: FlaggedRecord) {
    setResolveMode('new')
    setNewClientName(record.others_client_name ?? '')
    setSelectedClientId('')
    setResolveModal(record)

    const { data } = await supabase.from('clients').select('id, name').order('name')
    const list = (data ?? []) as ClientOption[]
    setClientOptions(list)
    if (list.length) setSelectedClientId(list[0].id)
  }

  function applyResult(result: {
    record_id: string; flagged_for_review: boolean
    reviewed_at: string; reviewed_by_name: string
  }) {
    setRecords(prev => prev.map(r =>
      r.record_id !== result.record_id ? r : {
        ...r,
        flagged_for_review: false,
        reviewed_at:        result.reviewed_at,
        reviewed_by_name:   result.reviewed_by_name,
      }
    ))
  }

  async function callApi(recordId: string, body: Record<string, unknown>) {
    setWorking(recordId)
    const res = await fetch(`/api/flagged/${recordId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    const json = await res.json()
    setWorking(null)
    if (!res.ok) { toast.error(json.error); return null }
    return json
  }

  async function markReviewed(recordId: string) {
    const result = await callApi(recordId, { action: 'mark_reviewed' })
    if (result) { applyResult(result); toast.success('Marked as reviewed') }
  }

  async function confirmResolve() {
    if (!resolveModal) return

    if (resolveMode === 'new' && !newClientName.trim()) {
      toast.error('Client name is required'); return
    }
    if (resolveMode === 'existing' && !selectedClientId) {
      toast.error('Please select a client'); return
    }

    const body = resolveMode === 'new'
      ? { action: 'resolve', new_client_name: newClientName.trim() }
      : { action: 'resolve', existing_client_id: selectedClientId }

    const result = await callApi(resolveModal.record_id, body)
    if (result) {
      applyResult(result)
      const msg = resolveMode === 'new'
        ? `"${result.client_resolved}" added to client master`
        : 'Mapped to existing client'
      toast.success(msg)
      setResolveModal(null)
    }
  }

  return (
    <div className="min-h-screen bg-brand-50">
      {/* Header */}
      <div className="bg-white border-b border-brand-100 px-4 sm:px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Flagged Records</h1>
            <p className="text-xs text-gray-400">
              Unknown clients entered by articles — add them to the client master to resolve
            </p>
          </div>
          {pending.length > 0 && (
            <span className="text-xs font-semibold bg-red-100 text-red-700 px-2.5 py-1 rounded-full">
              {pending.length} pending
            </span>
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-5 space-y-4">
        {/* Tabs */}
        <div className="flex gap-2 border-b border-gray-200 pb-1">
          {(['pending', 'resolved'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                tab === t
                  ? 'text-brand-600 border-b-2 border-brand-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
              <span className="ml-1.5 text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">
                {t === 'pending' ? pending.length : resolved.length}
              </span>
            </button>
          ))}
        </div>

        {displayed.length === 0 && (
          <div className="text-center py-16 text-sm text-gray-400">
            {tab === 'pending' ? 'No pending flagged records' : 'No resolved records yet'}
          </div>
        )}

        {/* Record cards */}
        <div className="grid gap-3">
          {displayed.map(r => (
            <Card key={r.record_id}>
              <div className="px-5 py-4 space-y-3">
                {/* Name + type + status */}
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900">{r.article_name}</span>
                    <AttendanceTypeBadge type={r.attendance_type} />
                  </div>
                  {r.flagged_for_review
                    ? <Badge variant="warning"  className="text-xs flex-shrink-0">Pending</Badge>
                    : <Badge variant="success"  className="text-xs flex-shrink-0">Resolved</Badge>
                  }
                </div>

                {/* Date / times */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs text-gray-600">
                  <div>
                    <span className="text-gray-400 block">Date</span>
                    {formatDate(r.attendance_date)}
                  </div>
                  <div>
                    <span className="text-gray-400 block">Check-in</span>
                    {r.checked_in_at ? formatTime(r.checked_in_at) : '—'}
                  </div>
                  <div>
                    <span className="text-gray-400 block">Check-out</span>
                    {r.checked_out_at
                      ? formatTime(r.checked_out_at)
                      : <span className="text-amber-600">Open</span>}
                  </div>
                </div>

                {/* Flag reason */}
                <div className="text-xs">
                  <span className="text-gray-400">Reason: </span>
                  <span className="text-orange-700 font-medium">{flagReason(r)}</span>
                </div>

                {/* Assignment info if present */}
                {r.client_name && (
                  <div className="text-xs">
                    <span className="text-gray-400">Assignment: </span>
                    <span className="text-gray-800">{r.client_name}</span>
                    {r.work_type && (
                      <span className={cn(
                        'ml-1.5 inline-block font-medium px-1.5 py-0.5 rounded-full',
                        workTypeBadgeColor(r.work_type)
                      )}>
                        {r.work_type}
                      </span>
                    )}
                  </div>
                )}

                {/* Reviewer info (resolved only) */}
                {!r.flagged_for_review && r.reviewed_at && (
                  <div className="text-xs text-gray-400">
                    Reviewed by {r.reviewed_by_name ?? 'unknown'} on {formatDate(r.reviewed_at)}
                  </div>
                )}

                {/* Actions (pending only) */}
                {r.flagged_for_review && (
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      size="sm"
                      onClick={() => openResolveModal(r)}
                      disabled={!!working}
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      Add Client &amp; Resolve
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={working === r.record_id}
                      onClick={() => markReviewed(r.record_id)}
                    >
                      <CheckCircle className="h-3.5 w-3.5" />
                      Mark Reviewed
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* ── Resolve modal ── */}
      <Modal open={!!resolveModal} onClose={() => setResolveModal(null)} title="Add Client &amp; Resolve">
        {resolveModal && (
          <div className="flex flex-col gap-4">
            {/* Record summary */}
            <div className="bg-brand-50 rounded-xl px-4 py-3 space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-medium text-gray-900">{resolveModal.article_name}</span>
                <AttendanceTypeBadge type={resolveModal.attendance_type} />
              </div>
              <p className="text-xs text-gray-500">{formatDate(resolveModal.attendance_date)}</p>
              <p className="text-xs text-orange-700">{flagReason(resolveModal)}</p>
            </div>

            {/* Mode toggle */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setResolveMode('new')}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-sm font-medium transition-colors',
                  resolveMode === 'new'
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                )}
              >
                <UserPlus className="h-4 w-4" />
                Add New
              </button>
              <button
                onClick={() => setResolveMode('existing')}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-xl border py-2.5 text-sm font-medium transition-colors',
                  resolveMode === 'existing'
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                )}
              >
                <Link2 className="h-4 w-4" />
                Map Existing
              </button>
            </div>

            {/* Add new client */}
            {resolveMode === 'new' && (
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Client Name</label>
                <input
                  type="text"
                  value={newClientName}
                  onChange={e => setNewClientName(e.target.value)}
                  placeholder="Enter client name to add to master"
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <p className="text-xs text-gray-400 mt-0.5">
                  This adds the client to the master list. Future check-ins for this client will work normally.
                </p>
              </div>
            )}

            {/* Map to existing client */}
            {resolveMode === 'existing' && (
              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700">Select Existing Client</label>
                {clientOptions.length === 0 ? (
                  <p className="text-sm text-gray-400 py-2">No clients in master yet</p>
                ) : (
                  <select
                    value={selectedClientId}
                    onChange={e => setSelectedClientId(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    {clientOptions.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                )}
                <p className="text-xs text-gray-400 mt-0.5">
                  Use this if the article entered a variation of an existing client name.
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setResolveModal(null)} className="flex-1">
                Cancel
              </Button>
              <Button
                onClick={confirmResolve}
                loading={!!working}
                disabled={resolveMode === 'existing' && !selectedClientId}
                className="flex-1"
              >
                <CheckCircle className="h-4 w-4" />
                Confirm
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
