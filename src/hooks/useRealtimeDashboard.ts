'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type { DashboardSummary, LiveActivityRow, OnLeaveArticleRow } from '@/types/app'

export interface DashboardInitialData {
  summary:         DashboardSummary | null
  liveActivity:    LiveActivityRow[]
  onLeaveArticles: OnLeaveArticleRow[]
  awolArticles:    OnLeaveArticleRow[]
}

export function useRealtimeDashboard(initialData?: DashboardInitialData) {
  const supabase = getSupabaseBrowserClient()

  const [summary, setSummary]         = useState<DashboardSummary | null>(initialData?.summary ?? null)
  const [liveActivity, setLive]       = useState<LiveActivityRow[]>(initialData?.liveActivity ?? [])
  const [onLeaveArticles, setOnLeave] = useState<OnLeaveArticleRow[]>(initialData?.onLeaveArticles ?? [])
  const [awolArticles, setAwol]       = useState<OnLeaveArticleRow[]>(initialData?.awolArticles ?? [])
  const [loading, setLoading]         = useState(!initialData)
  const timerRef                      = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Captured once so the mount effect below can skip its initial refresh()
  // without needing `initialData` — a prop that never changes post-mount —
  // in its dependency array.
  const hasInitialData                = useRef(!!initialData)

  const refresh = useCallback(async () => {
    const [summaryRes, liveRes, onLeaveRes, awolRes] = await Promise.all([
      supabase.rpc('get_dashboard_summary'),
      supabase.rpc('get_live_activity'),
      supabase.rpc('get_on_leave_articles'),
      supabase.rpc('get_awol_articles'),
    ])

    if (summaryRes.data)  setSummary(summaryRes.data as DashboardSummary)
    if (liveRes.data)     setLive(liveRes.data as LiveActivityRow[])
    if (onLeaveRes.data)  setOnLeave(onLeaveRes.data as OnLeaveArticleRow[])
    if (awolRes.data)     setAwol(awolRes.data as OnLeaveArticleRow[])
    setLoading(false)
  }, [supabase])

  // Coalesce rapid realtime events (e.g. bulk operations) into a single
  // refresh. Prevents parallel RPC calls on mobile when several rows
  // change at once. Manual refresh() calls bypass the debounce.
  const handleChange = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(refresh, 300)
  }, [refresh])

  useEffect(() => {
    // Server already fetched this for initial render — only fetch here if
    // that didn't happen, so mount never duplicates the same 4 RPCs.
    if (!hasInitialData.current) refresh()

    const channel = supabase
      .channel('dashboard-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_records' }, handleChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' },           handleChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_records' },      handleChange)
      .subscribe()

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      supabase.removeChannel(channel)
    }
  }, [refresh, handleChange, supabase])

  return { summary, liveActivity, onLeaveArticles, awolArticles, loading, refresh }
}
