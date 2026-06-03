'use client'

import { useState, useCallback, useRef } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { workTypeBadgeColor, cn } from '@/lib/utils'
import type { Assignment } from '@/types/app'

interface AssignmentSearchProps {
  onSelect: (assignment: Assignment) => void
  onSelectOthers: () => void
}

export function AssignmentSearch({ onSelect, onSelectOthers }: AssignmentSearchProps) {
  const supabase = getSupabaseBrowserClient()
  const [query, setQuery]     = useState('')
  const [results, setResults] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const search = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!q.trim()) { setResults([]); return }

    debounceRef.current = setTimeout(async () => {
      setLoading(true)
      const { data } = await supabase
        .from('assignments')
        .select('*')
        .eq('status', 'active')
        .ilike('client_name', `%${q}%`)
        .order('client_name')
        .limit(20)
      setResults((data ?? []) as Assignment[])
      setLoading(false)
    }, 300)
  }, [supabase])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value)
    search(e.target.value)
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        placeholder="Search client name..."
        value={query}
        onChange={handleChange}
        autoFocus
        className="text-base"
      />

      {loading && (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      )}

      {!loading && results.length > 0 && (
        <ul className="divide-y divide-gray-50 rounded-xl border border-gray-100 overflow-hidden">
          {results.map(a => (
            <li key={a.id}>
              <button
                onClick={() => onSelect(a)}
                className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-gray-50 transition-colors"
              >
                <span className="font-medium text-gray-900 text-sm">{a.client_name}</span>
                <span className={cn(
                  'text-xs font-medium px-2 py-0.5 rounded-full',
                  workTypeBadgeColor(a.work_type)
                )}>
                  {a.work_type}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!loading && query.trim() && results.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-4">No assignments found</p>
      )}

      {/* Always show Others option */}
      <button
        onClick={onSelectOthers}
        className="flex items-center gap-2 px-4 py-3.5 rounded-xl border border-dashed border-gray-300 text-sm text-gray-500 hover:border-gray-400 hover:text-gray-700 transition-colors"
      >
        <Badge variant="warning" className="text-xs">?</Badge>
        Others / Client Not In System
      </button>
    </div>
  )
}
