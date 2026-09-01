'use client'

import { useState } from 'react'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import toast from 'react-hot-toast'
import { Plus, X } from 'lucide-react'
import type { UserRole } from '@/types/app'

interface ManagerRow {
  id:        string
  full_name: string
  role:      UserRole
}

interface Props {
  articleId:       string
  initialManagers: ManagerRow[]
  candidates:      ManagerRow[]
}

export default function ReportingManagersCard({ articleId, initialManagers, candidates }: Props) {
  const [managers, setManagers]     = useState(initialManagers)
  const [showAdd, setShowAdd]       = useState(false)
  const [selected, setSelected]     = useState('')
  const [saving, setSaving]         = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  const availableCandidates = candidates.filter(c => !managers.some(m => m.id === c.id))

  async function addManager() {
    if (!selected) { toast.error('Select a reporting manager'); return }
    setSaving(true)
    const res = await fetch('/api/reporting-managers', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ article_id: articleId, reporting_manager_id: selected }),
    })
    const json = await res.json()
    if (!res.ok) { toast.error(json.error); setSaving(false); return }

    const added = candidates.find(c => c.id === selected)
    if (added) setManagers(prev => [...prev, added])
    toast.success('Reporting manager added')
    setSelected('')
    setSaving(false)
    setShowAdd(false)
  }

  async function removeManager(managerId: string) {
    setRemovingId(managerId)
    const res = await fetch('/api/reporting-managers', {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ article_id: articleId, reporting_manager_id: managerId }),
    })
    if (!res.ok) {
      const json = await res.json()
      toast.error(json.error)
      setRemovingId(null)
      return
    }
    setManagers(prev => prev.filter(m => m.id !== managerId))
    toast.success('Reporting manager removed')
    setRemovingId(null)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-900">Reporting Managers</h2>
          <Button size="sm" variant="ghost" onClick={() => setShowAdd(true)}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
      </CardHeader>
      <CardBody className="p-0">
        {managers.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No reporting managers assigned.</p>
        ) : (
          <ul className="divide-y divide-brand-100">
            {managers.map(m => (
              <li key={m.id} className="px-5 py-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-sm font-medium text-gray-900 truncate">{m.full_name}</span>
                  <Badge className="text-xs capitalize">{m.role}</Badge>
                </div>
                <button
                  onClick={() => removeManager(m.id)}
                  disabled={removingId === m.id}
                  className="text-gray-300 hover:text-red-500 transition-colors disabled:opacity-50 flex-shrink-0"
                  title="Remove reporting manager"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>

      {/* ── Add Reporting Manager modal ── */}
      <Modal open={showAdd} onClose={() => { setShowAdd(false); setSelected('') }} title="Add Reporting Manager">
        <div className="flex flex-col gap-4">
          {availableCandidates.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No more candidates available.</p>
          ) : (
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">Reporting Manager</label>
              <select
                value={selected}
                onChange={e => setSelected(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                <option value="">— Select —</option>
                {availableCandidates.map(c => (
                  <option key={c.id} value={c.id}>{c.full_name} ({c.role})</option>
                ))}
              </select>
            </div>
          )}
          <Button
            onClick={addManager}
            loading={saving}
            disabled={availableCandidates.length === 0}
            className="w-full"
          >
            Add
          </Button>
        </div>
      </Modal>
    </Card>
  )
}
