'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import type { Assignment } from '@/types/app'

interface CycleStartPromptProps {
  assignment: Assignment
  onConfirm: (notes?: string) => Promise<void>
  onCancel: () => void
  loading: boolean
}

export function CycleStartPrompt({ assignment, onConfirm, onCancel, loading }: CycleStartPromptProps) {
  const [notes, setNotes] = useState('')

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <p className="text-sm font-medium text-amber-800">No active work cycle</p>
        <p className="text-sm text-amber-700 mt-1">
          <span className="font-semibold">{assignment.client_name}</span> — {assignment.work_type} has no active cycle.
          Do you want to start a new work cycle?
        </p>
      </div>

      <textarea
        placeholder="Optional notes for this cycle..."
        value={notes}
        onChange={e => setNotes(e.target.value)}
        rows={2}
        className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-500"
      />

      <div className="flex gap-3">
        <Button variant="secondary" onClick={onCancel} className="flex-1" disabled={loading}>
          Cancel
        </Button>
        <Button onClick={() => onConfirm(notes || undefined)} loading={loading} className="flex-1">
          Start Cycle
        </Button>
      </div>
    </div>
  )
}
