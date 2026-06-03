'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { workTypeBadgeColor, cn } from '@/lib/utils'
import toast from 'react-hot-toast'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { Plus, Search, Archive, Trash2 } from 'lucide-react'
import type { Assignment, Client, UserRole } from '@/types/app'
import { useRouter } from 'next/navigation'

interface WorkTypeRow { id: string; name: string }

interface Props {
  assignments: Assignment[]
  clients:     Client[]
  workTypes:   WorkTypeRow[]
  role:        UserRole
}

type Tab = 'assignments' | 'clients' | 'work_types'

export default function AssignmentsClient({
  assignments: initial,
  clients: initialClients,
  workTypes: initialWorkTypes,
  role: _role,
}: Props) {
  const supabase = getSupabaseBrowserClient()
  const router   = useRouter()

  // ── Tab ───────────────────────────────────────────────────────────────
  const [tab, setTab] = useState<Tab>('assignments')

  // ── Assignments ───────────────────────────────────────────────────────
  const [assignments, setAssignments] = useState(initial)
  const [query, setQuery]             = useState('')
  const [statusFilter, setStatus]     = useState<'all' | 'active' | 'archived'>('active')
  const [wtFilter, setWtFilter]       = useState<string>('all')
  const [showCreate, setShowCreate]   = useState(false)
  const [saving, setSaving]           = useState(false)
  const [form, setForm] = useState({ client_name: '', work_type: '', notes: '' })

  const filtered = assignments.filter(a => {
    const matchStatus = statusFilter === 'all' || a.status === statusFilter
    const matchQuery  = !query || a.client_name.toLowerCase().includes(query.toLowerCase())
    const matchWt     = wtFilter === 'all' || a.work_type === wtFilter
    return matchStatus && matchQuery && matchWt
  })

  async function createAssignment() {
    if (!form.client_name.trim()) { toast.error('Client name required'); return }
    if (!form.work_type)          { toast.error('Work type required'); return }
    setSaving(true)
    const { data: profile } = await supabase.from('profiles').select('id').single()
    const { data, error } = await supabase
      .from('assignments')
      .insert({ client_name: form.client_name.trim(), work_type: form.work_type, notes: form.notes.trim() || null, created_by: profile?.id })
      .select().single()
    if (error) { toast.error(error.message); setSaving(false); return }
    setAssignments(prev => [...prev, data as Assignment])
    toast.success('Assignment created')
    setShowCreate(false)
    setForm({ client_name: '', work_type: '', notes: '' })
    setSaving(false)
  }

  async function toggleArchive(a: Assignment) {
    const newStatus = a.status === 'active' ? 'archived' : 'active'
    const { error } = await supabase.from('assignments').update({ status: newStatus }).eq('id', a.id)
    if (error) { toast.error(error.message); return }
    setAssignments(prev => prev.map(x => x.id === a.id ? { ...x, status: newStatus } : x))
    toast.success(newStatus === 'archived' ? 'Assignment archived' : 'Assignment reactivated')
  }

  // ── Clients ───────────────────────────────────────────────────────────
  const [clients, setClients]           = useState(initialClients)
  const [clientQuery, setClientQuery]   = useState('')
  const [showAddClient, setAddClient]   = useState(false)
  const [newClientName, setNewClientName] = useState('')
  const [savingClient, setSavingClient] = useState(false)

  const filteredClients = clientQuery.trim()
    ? clients.filter(c => c.name.toLowerCase().includes(clientQuery.toLowerCase()))
    : clients

  async function addClient() {
    if (!newClientName.trim()) { toast.error('Client name required'); return }
    setSavingClient(true)
    const { data, error } = await supabase.from('clients').insert({ name: newClientName.trim() }).select().single()
    if (error) { toast.error(error.message); setSavingClient(false); return }
    setClients(prev => [...prev, data as Client].sort((a, b) => a.name.localeCompare(b.name)))
    toast.success('Client added')
    setAddClient(false)
    setNewClientName('')
    setSavingClient(false)
  }

  async function removeClient(id: string) {
    const { error } = await supabase.from('clients').delete().eq('id', id)
    if (error) { toast.error(error.message); return }
    setClients(prev => prev.filter(c => c.id !== id))
    toast.success('Client removed')
  }

  // ── Work Types ────────────────────────────────────────────────────────
  const [workTypes, setWorkTypes]       = useState(initialWorkTypes)
  const [wtQuery, setWtQuery]           = useState('')
  const [showAddWt, setAddWt]           = useState(false)
  const [newWtName, setNewWtName]       = useState('')
  const [savingWt, setSavingWt]         = useState(false)

  const filteredWorkTypes = wtQuery.trim()
    ? workTypes.filter(w => w.name.toLowerCase().includes(wtQuery.toLowerCase()))
    : workTypes

  async function addWorkType() {
    if (!newWtName.trim()) { toast.error('Work type name required'); return }
    setSavingWt(true)
    const { data, error } = await supabase.from('work_types').insert({ name: newWtName.trim() }).select().single()
    if (error) { toast.error(error.message); setSavingWt(false); return }
    setWorkTypes(prev => [...prev, data as WorkTypeRow].sort((a, b) => a.name.localeCompare(b.name)))
    toast.success('Work type added')
    setAddWt(false)
    setNewWtName('')
    setSavingWt(false)
  }

  async function removeWorkType(id: string) {
    const { error } = await supabase.from('work_types').delete().eq('id', id)
    if (error) { toast.error(error.message); return }
    setWorkTypes(prev => prev.filter(w => w.id !== id))
    toast.success('Work type removed')
  }

  // ── Render ─────────────────────────────────────────────────────────────
  const tabLabels: Record<Tab, string> = {
    assignments: 'Assignments',
    clients:     'Clients',
    work_types:  'Work Types',
  }

  return (
    <div className="min-h-screen bg-brand-100">
      {/* Header */}
      <div className="bg-white border-b border-brand-200 px-4 sm:px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">Assignments</h1>
          {tab === 'assignments' && (
            <Button onClick={() => setShowCreate(true)} size="sm">
              <Plus className="h-4 w-4" /> New Assignment
            </Button>
          )}
          {tab === 'clients' && (
            <Button onClick={() => setAddClient(true)} size="sm">
              <Plus className="h-4 w-4" /> Add Client
            </Button>
          )}
          {tab === 'work_types' && (
            <Button onClick={() => setAddWt(true)} size="sm">
              <Plus className="h-4 w-4" /> Add Work Type
            </Button>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5 space-y-4">
        {/* Tab toggle */}
        <div className="flex gap-1 bg-brand-100 p-1 rounded-xl w-fit">
          {(['assignments', 'clients', 'work_types'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-4 py-1.5 rounded-lg text-sm font-medium transition-colors',
                tab === t
                  ? 'bg-white text-brand-700 shadow-sm'
                  : 'text-brand-600 hover:text-brand-800'
              )}
            >
              {tabLabels[t]}
            </button>
          ))}
        </div>

        {/* ── ASSIGNMENTS TAB ── */}
        {tab === 'assignments' && (
          <>
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  placeholder="Search client name..."
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-brand-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
                />
              </div>
              <div className="flex gap-2">
                {(['active', 'archived', 'all'] as const).map(s => (
                  <button key={s} onClick={() => setStatus(s)}
                    className={cn(
                      'px-4 py-2.5 rounded-xl text-sm font-medium transition-colors',
                      statusFilter === s
                        ? 'bg-brand-600 text-white'
                        : 'bg-white border border-brand-200 text-brand-700 hover:bg-brand-50'
                    )}
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Work type filter chips — horizontally scrollable on mobile */}
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide scroll-smooth-x">
              <button
                onClick={() => setWtFilter('all')}
                className={cn(
                  'flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors',
                  wtFilter === 'all'
                    ? 'bg-brand-600 text-white'
                    : 'bg-white border border-brand-200 text-gray-600 hover:bg-brand-50'
                )}
              >
                All Types
              </button>
              {workTypes.map(wt => (
                <button
                  key={wt.id}
                  onClick={() => setWtFilter(wt.name)}
                  className={cn(
                    'flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border',
                    wtFilter === wt.name
                      ? cn(workTypeBadgeColor(wt.name), 'border-transparent ring-2 ring-offset-1 ring-brand-300')
                      : 'bg-white border-brand-200 text-gray-600 hover:bg-brand-50'
                  )}
                >
                  {wt.name}
                </button>
              ))}
            </div>

            <div className="grid gap-3">
              {filtered.length === 0 && (
                <div className="text-center py-12 text-sm text-gray-400">No assignments found</div>
              )}
              {filtered.map(a => (
                <Card key={a.id}>
                  <div className="px-5 py-4 flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-gray-900">{a.client_name}</span>
                        {a.status === 'archived' && (
                          <Badge variant="warning" className="text-xs">Archived</Badge>
                        )}
                      </div>
                      <span className={cn('inline-block text-xs font-medium px-2 py-0.5 rounded-full mt-1', workTypeBadgeColor(a.work_type))}>
                        {a.work_type}
                      </span>
                      {a.notes && <p className="text-xs text-gray-400 mt-1 truncate">{a.notes}</p>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button onClick={() => router.push(`/assignments/${a.id}`)}
                        className="text-xs text-brand-600 hover:text-brand-700 font-medium">
                        View
                      </button>
                      <button onClick={() => toggleArchive(a)}
                        className="text-xs text-gray-400 hover:text-gray-600"
                        title={a.status === 'active' ? 'Archive' : 'Reactivate'}>
                        <Archive className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}

        {/* ── CLIENTS TAB ── */}
        {tab === 'clients' && (
          <>
            <p className="text-xs text-brand-600 bg-white border border-brand-200 rounded-xl px-4 py-2.5">
              Articles see this list when checking in. Add all your office clients here.
            </p>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input placeholder="Search clients..."
                value={clientQuery} onChange={e => setClientQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-brand-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
              />
            </div>
            <div className="grid gap-2">
              {filteredClients.length === 0 && (
                <div className="text-center py-12 text-sm text-gray-400">
                  {clients.length === 0 ? 'No clients yet — add your first client above.' : 'No clients match your search.'}
                </div>
              )}
              {filteredClients.map(c => (
                <Card key={c.id}>
                  <div className="px-5 py-3.5 flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-gray-900">{c.name}</span>
                    <button onClick={() => removeClient(c.id)}
                      className="text-gray-300 hover:text-red-500 transition-colors flex-shrink-0" title="Remove">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}

        {/* ── WORK TYPES TAB ── */}
        {tab === 'work_types' && (
          <>
            <p className="text-xs text-brand-600 bg-white border border-brand-200 rounded-xl px-4 py-2.5">
              Articles select a work type when checking in. These appear in the work type dropdown.
            </p>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input placeholder="Search work types..."
                value={wtQuery} onChange={e => setWtQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-brand-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white"
              />
            </div>
            <div className="grid gap-2">
              {filteredWorkTypes.length === 0 && (
                <div className="text-center py-12 text-sm text-gray-400">
                  {workTypes.length === 0 ? 'No work types yet — add your first work type above.' : 'No work types match your search.'}
                </div>
              )}
              {filteredWorkTypes.map(w => (
                <Card key={w.id}>
                  <div className="px-5 py-3.5 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', workTypeBadgeColor(w.name))}>
                        {w.name}
                      </span>
                    </div>
                    <button onClick={() => removeWorkType(w.id)}
                      className="text-gray-300 hover:text-red-500 transition-colors flex-shrink-0" title="Remove">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Create Assignment modal */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Assignment">
        <div className="flex flex-col gap-4">
          <Input label="Client Name" placeholder="e.g. ABC Pvt Ltd"
            value={form.client_name} onChange={e => setForm(f => ({ ...f, client_name: e.target.value }))} />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Work Type</label>
            <select value={form.work_type} onChange={e => setForm(f => ({ ...f, work_type: e.target.value }))}
              className="w-full px-3 py-2.5 rounded-xl border border-brand-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 bg-white">
              <option value="">— Select work type —</option>
              {workTypes.map(wt => <option key={wt.id} value={wt.name}>{wt.name}</option>)}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Notes (optional)</label>
            <textarea placeholder="Any notes..." value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2}
              className="w-full px-3 py-2.5 rounded-xl border border-brand-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-500" />
          </div>
          <Button onClick={createAssignment} loading={saving} className="w-full">Create Assignment</Button>
        </div>
      </Modal>

      {/* Add Client modal */}
      <Modal open={showAddClient} onClose={() => setAddClient(false)} title="Add Client">
        <div className="flex flex-col gap-4">
          <Input label="Client Name" placeholder="e.g. ABC Pvt Ltd"
            value={newClientName} onChange={e => setNewClientName(e.target.value)} autoFocus />
          <Button onClick={addClient} loading={savingClient} className="w-full">Add Client</Button>
        </div>
      </Modal>

      {/* Add Work Type modal */}
      <Modal open={showAddWt} onClose={() => setAddWt(false)} title="Add Work Type">
        <div className="flex flex-col gap-4">
          <Input label="Work Type Name" placeholder="e.g. Statutory Audit"
            value={newWtName} onChange={e => setNewWtName(e.target.value)} autoFocus />
          <Button onClick={addWorkType} loading={savingWt} className="w-full">Add Work Type</Button>
        </div>
      </Modal>
    </div>
  )
}
