'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { workTypeBadgeColor, cn } from '@/lib/utils'
import toast from 'react-hot-toast'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { Plus, Search, Archive, Trash2, Upload, FileDown, CheckCircle2, AlertCircle } from 'lucide-react'
import type { Assignment, Client, UserRole } from '@/types/app'
import { useRouter } from 'next/navigation'

interface WorkTypeRow { id: string; name: string }

interface Props {
  assignments: Assignment[]
  clients:     Client[]
  workTypes:   WorkTypeRow[]
  role:        UserRole
}

type Tab        = 'assignments' | 'clients' | 'work_types'
type ImportStep = 'upload' | 'preview' | 'importing' | 'done'

interface ImportResults {
  imported: number
  skipped:  number
  errors:   number
}

export default function AssignmentsClient({
  assignments: initial,
  clients: initialClients,
  workTypes: initialWorkTypes,
  role: _role,
}: Props) {
  const supabase      = getSupabaseBrowserClient()
  const router        = useRouter()
  const queryClient   = useQueryClient()

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

  // ── Import ────────────────────────────────────────────────────────────
  const [showImport, setShowImport]       = useState(false)
  const [importStep, setImportStep]       = useState<ImportStep>('upload')
  const [importFile, setImportFile]       = useState<File | null>(null)
  const [parsedNames, setParsedNames]     = useState<string[]>([])
  const [importParsing, setImportParsing] = useState(false)
  const [importError, setImportError]     = useState<string | null>(null)
  const [importResults, setImportResults] = useState<ImportResults | null>(null)

  function openImport() {
    setImportStep('upload')
    setImportFile(null)
    setParsedNames([])
    setImportParsing(false)
    setImportError(null)
    setImportResults(null)
    setShowImport(true)
  }

  function closeImport() {
    setShowImport(false)
  }

  async function parseImportFile() {
    if (!importFile) return
    setImportParsing(true)
    setImportError(null)

    const fd = new FormData()
    fd.append('file', importFile)

    try {
      const res  = await fetch('/api/clients/import', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) {
        setImportError(json.error ?? 'Failed to parse file.')
        setImportParsing(false)
        return
      }
      setParsedNames(json.names as string[])
      setImportStep('preview')
    } catch {
      setImportError('Network error — please try again.')
    }
    setImportParsing(false)
  }

  async function runImport(toAdd: string[], skippedCount: number) {
    setImportStep('importing')

    // Parallel inserts through the browser Supabase client — RLS applies normally.
    const insertResults = await Promise.all(
      toAdd.map(async (name) => {
        const { error } = await supabase
          .from('clients')
          .insert({ name })
          .select('id')
          .single()
        return { name, ok: !error }
      })
    )

    const imported = insertResults.filter(r => r.ok).length
    const errors   = insertResults.filter(r => !r.ok).length

    // Refresh the local clients list and the React Query cache used by
    // ClientWorkSelector so article users see new clients on their next check-in.
    const { data: fresh } = await supabase
      .from('clients')
      .select('id, name')
      .order('name')
    if (fresh) setClients(fresh as Client[])
    queryClient.invalidateQueries({ queryKey: ['clients'] })

    setImportResults({ imported, skipped: skippedCount, errors })
    setImportStep('done')
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

  // Computed inside render so it's always fresh when the preview step is visible
  const existingLower = new Set(clients.map(c => c.name.toLowerCase()))
  const toAdd         = parsedNames.filter(n => !existingLower.has(n.toLowerCase()))
  const alreadyExist  = parsedNames.filter(n =>  existingLower.has(n.toLowerCase()))

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
            <div className="flex items-center gap-2">
              <Button onClick={openImport} size="sm" variant="secondary">
                <Upload className="h-4 w-4" /> Import
              </Button>
              <Button onClick={() => setAddClient(true)} size="sm">
                <Plus className="h-4 w-4" /> Add Client
              </Button>
            </div>
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
                      'px-4 py-2.5 rounded-xl text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1',
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
                        className="text-xs text-brand-600 hover:text-brand-700 font-medium px-2 py-1.5 rounded-lg hover:bg-brand-50">
                        View
                      </button>
                      <button onClick={() => toggleArchive(a)}
                        className="text-xs text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-50"
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

      {/* ── Create Assignment modal ── */}
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

      {/* ── Add Client modal ── */}
      <Modal open={showAddClient} onClose={() => setAddClient(false)} title="Add Client">
        <div className="flex flex-col gap-4">
          <Input label="Client Name" placeholder="e.g. ABC Pvt Ltd"
            value={newClientName} onChange={e => setNewClientName(e.target.value)} autoFocus />
          <Button onClick={addClient} loading={savingClient} className="w-full">Add Client</Button>
        </div>
      </Modal>

      {/* ── Add Work Type modal ── */}
      <Modal open={showAddWt} onClose={() => setAddWt(false)} title="Add Work Type">
        <div className="flex flex-col gap-4">
          <Input label="Work Type Name" placeholder="e.g. Statutory Audit"
            value={newWtName} onChange={e => setNewWtName(e.target.value)} autoFocus />
          <Button onClick={addWorkType} loading={savingWt} className="w-full">Add Work Type</Button>
        </div>
      </Modal>

      {/* ── Import Clients modal ── */}
      <Modal
        open={showImport}
        onClose={importStep === 'importing' ? () => {} : closeImport}
        title="Import Clients"
      >
        {/* ── Step 1: Upload ── */}
        {importStep === 'upload' && (
          <div className="flex flex-col gap-5">
            {/* Template download */}
            <div className="bg-brand-50 rounded-xl px-4 py-3 flex items-start gap-3">
              <FileDown className="h-4 w-4 text-brand-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800">Download template first</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Fill column A with one client name per row, starting from row 2.
                </p>
                <a
                  href="/api/clients/import"
                  download="client_import_template.xlsx"
                  className="inline-flex items-center gap-1.5 mt-2 text-xs font-medium text-brand-600 hover:text-brand-700"
                >
                  <FileDown className="h-3.5 w-3.5" />
                  client_import_template.xlsx
                </a>
              </div>
            </div>

            {/* File picker */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-gray-700">
                Select file <span className="text-gray-400 font-normal">(.xlsx or .csv)</span>
              </label>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={e => {
                  setImportFile(e.target.files?.[0] ?? null)
                  setImportError(null)
                }}
                className="block w-full text-sm text-gray-600
                  file:mr-3 file:py-2 file:px-4
                  file:rounded-lg file:border-0
                  file:text-sm file:font-medium
                  file:bg-brand-50 file:text-brand-700
                  hover:file:bg-brand-100
                  cursor-pointer"
              />
              {importFile && (
                <p className="text-xs text-gray-500">
                  Selected: <span className="font-medium text-gray-700">{importFile.name}</span>
                  {' '}({(importFile.size / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>

            {importError && (
              <p className="text-sm text-red-600 bg-red-50 px-3 py-2.5 rounded-xl flex items-start gap-2">
                <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                {importError}
              </p>
            )}

            <Button
              onClick={parseImportFile}
              loading={importParsing}
              disabled={!importFile}
              className="w-full"
            >
              Preview Import
            </Button>
          </div>
        )}

        {/* ── Step 2: Preview ── */}
        {importStep === 'preview' && (
          <div className="flex flex-col gap-4">
            {/* Summary chips */}
            <div className="flex gap-3 flex-wrap">
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-green-50 text-green-700 text-sm font-medium">
                <CheckCircle2 className="h-4 w-4" />
                {toAdd.length} new
              </div>
              {alreadyExist.length > 0 && (
                <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-100 text-gray-500 text-sm font-medium">
                  {alreadyExist.length} already exist
                </div>
              )}
            </div>

            {toAdd.length === 0 ? (
              <div className="text-center py-6">
                <p className="text-sm font-medium text-gray-700">Nothing to import</p>
                <p className="text-xs text-gray-400 mt-1">
                  All {parsedNames.length} client{parsedNames.length !== 1 ? 's' : ''} in the file already exist.
                </p>
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-1">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-1">
                    Will be imported
                  </p>
                  <ul className="max-h-48 overflow-y-auto divide-y divide-brand-100 rounded-xl border border-brand-200 bg-white">
                    {toAdd.map(name => (
                      <li key={name} className="px-4 py-2.5 text-sm text-gray-800">
                        {name}
                      </li>
                    ))}
                  </ul>
                </div>

                {alreadyExist.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-1">
                      Already exist — will be skipped
                    </p>
                    <ul className="max-h-24 overflow-y-auto divide-y divide-gray-100 rounded-xl border border-gray-200 bg-gray-50">
                      {alreadyExist.map(name => (
                        <li key={name} className="px-4 py-2 text-sm text-gray-400 line-through">
                          {name}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}

            <div className="flex gap-3">
              <Button
                variant="secondary"
                onClick={() => setImportStep('upload')}
                className="flex-1"
              >
                Back
              </Button>
              <Button
                onClick={() => runImport(toAdd, alreadyExist.length)}
                disabled={toAdd.length === 0}
                className="flex-1"
              >
                Import {toAdd.length > 0 ? `${toAdd.length} ` : ''}Client{toAdd.length !== 1 ? 's' : ''}
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 3: Importing ── */}
        {importStep === 'importing' && (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="w-10 h-10 rounded-full border-4 border-brand-200 border-t-brand-600 animate-spin" />
            <p className="text-sm font-medium text-gray-700">Importing clients…</p>
            <p className="text-xs text-gray-400">Please don't close this window.</p>
          </div>
        )}

        {/* ── Step 4: Done ── */}
        {importStep === 'done' && importResults && (
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-3">
              <ResultRow
                icon={<CheckCircle2 className="h-5 w-5 text-green-600" />}
                label="Imported"
                count={importResults.imported}
                color="text-green-700"
              />
              <ResultRow
                icon={<div className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-xs font-bold">–</div>}
                label="Already existed (skipped)"
                count={importResults.skipped}
                color="text-gray-500"
              />
              {importResults.errors > 0 && (
                <ResultRow
                  icon={<AlertCircle className="h-5 w-5 text-red-500" />}
                  label="Failed to import"
                  count={importResults.errors}
                  color="text-red-600"
                />
              )}
            </div>

            {importResults.errors > 0 && (
              <p className="text-xs text-gray-400 bg-gray-50 px-3 py-2 rounded-xl">
                Some clients could not be imported. This may indicate a duplicate that was
                added by another admin during the import, or a database constraint. You can
                add them individually using "Add Client."
              </p>
            )}

            <Button onClick={closeImport} className="w-full">Done</Button>
          </div>
        )}
      </Modal>
    </div>
  )
}

// ── Small helper for the results step ─────────────────────────────────────────
function ResultRow({
  icon, label, count, color,
}: {
  icon: React.ReactNode
  label: string
  count: number
  color: string
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 bg-white rounded-xl border border-brand-200">
      {icon}
      <span className="flex-1 text-sm text-gray-700">{label}</span>
      <span className={`text-lg font-bold ${color}`}>{count}</span>
    </div>
  )
}
