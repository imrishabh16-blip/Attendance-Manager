'use client'

import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { Input } from '@/components/ui/Input'
import { Spinner } from '@/components/ui/Spinner'

interface ClientRow    { id: string; name: string }
interface WorkTypeRow  { id: string; name: string }

interface Props {
  onSelect:            (client_name: string, work_type: string) => void
  onSelectUnallocated: () => void
}

export function ClientWorkSelector({ onSelect, onSelectUnallocated }: Props) {
  const supabase = getSupabaseBrowserClient()

  // React Query caches both datasets at the QueryClient level (app root).
  // When the modal closes, ClientWorkSelector unmounts but the cache survives.
  // On the next check-in (remount), useQuery returns cached data synchronously —
  // isLoading is already false, no spinner shown — and refetches silently in the
  // background only after the staleTime configured in QueryProvider has elapsed.
  const { data: workTypesData, isLoading: wtLoading } = useQuery({
    queryKey: ['work_types'],
    queryFn: async () => {
      const { data } = await supabase.from('work_types').select('id, name').order('name')
      return ((data ?? []) as WorkTypeRow[]).map(r => r.name)
    },
  })

  const { data: clientsData, isLoading: clientsLoading } = useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data } = await supabase.from('clients').select('id, name').order('name')
      return (data ?? []) as ClientRow[]
    },
  })

  const workTypes = workTypesData ?? []
  const clients   = clientsData   ?? []
  const loading   = wtLoading || clientsLoading

  // workType and query are local UI state — intentionally NOT cached.
  // They reset on every modal open, which is the correct behaviour.
  //
  // Lazy initialiser picks up the first work type from cache when data is
  // already available at mount time (warm cache). If cache is cold, workType
  // starts as '' and the effect below sets the default once data arrives.
  const [workType, setWorkType] = useState<string>(() => workTypes[0] ?? '')
  const [query,    setQuery]    = useState('')

  // Set the default work type once data first arrives (cold first-fetch path).
  // Functional update — `prev || workTypes[0]` — means this never overwrites
  // a selection the user has already made.
  useEffect(() => {
    if (workTypes.length > 0) {
      setWorkType(prev => prev || workTypes[0])
    }
  }, [workTypes])

  const filtered = query.trim()
    ? clients.filter(c => c.name.toLowerCase().includes(query.toLowerCase()))
    : clients

  return (
    <div className="flex flex-col gap-4">

      {/* Work Type */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Work Type
        </label>
        {loading ? (
          <div className="h-10 rounded-xl bg-brand-50 animate-pulse" />
        ) : workTypes.length === 0 ? (
          <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-xl">
            No work types configured — ask your admin to add some.
          </p>
        ) : (
          <select
            value={workType}
            onChange={e => setWorkType(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl border border-brand-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {workTypes.map(wt => <option key={wt} value={wt}>{wt}</option>)}
          </select>
        )}
      </div>

      {/* Client search */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Client
        </label>
        <Input
          placeholder="Search client name..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          autoFocus
        />
      </div>

      {/* Client list */}
      {loading ? (
        <div className="flex justify-center py-3"><Spinner /></div>
      ) : (
        <>
          {filtered.length > 0 && (
            <ul className="divide-y divide-brand-100 rounded-xl border border-brand-200 overflow-hidden max-h-36 overflow-y-auto">
              {filtered.map(c => (
                <li key={c.id}>
                  <button
                    onClick={() => onSelect(c.name, workType)}
                    className="w-full flex items-center px-4 py-3 text-left hover:bg-brand-50 transition-colors"
                  >
                    <span className="text-sm font-medium text-gray-900">{c.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {query.trim() !== '' && filtered.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-2">No clients matched</p>
          )}
          {clients.length === 0 && !query.trim() && (
            <p className="text-sm text-gray-400 text-center py-2">
              No clients in master list — ask your admin to add clients.
            </p>
          )}
        </>
      )}

      {/* Alternatives */}
      <div className="flex flex-col gap-2 pt-1 border-t border-brand-200">
        <button
          onClick={onSelectUnallocated}
          className="flex items-center gap-2 px-4 py-3 rounded-xl border border-dashed border-brand-200 text-sm text-gray-500 hover:border-brand-300 hover:text-gray-700 transition-colors"
        >
          <span className="text-xs font-semibold px-1.5 py-0.5 bg-brand-50 rounded text-brand-500">—</span>
          Unallocated (no client this session)
        </button>
      </div>
    </div>
  )
}
