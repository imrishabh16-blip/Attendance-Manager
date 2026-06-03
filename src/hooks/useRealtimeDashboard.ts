'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type { DashboardSummary, LiveActivityRow, OnLeaveArticleRow } from '@/types/app'

export function useRealtimeDashboard() {
  const supabase = getSupabaseBrowserClient()

  const [summary, setSummary]         = useState<DashboardSummary | null>(null)
  const [liveActivity, setLive]       = useState<LiveActivityRow[]>([])
  const [onLeaveArticles, setOnLeave] = useState<OnLeaveArticleRow[]>([])
  const [loading, setLoading]         = useState(true)
  const timerRef                      = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    const [summaryRes, liveRes, onLeaveRes] = await Promise.all([
      supabase.rpc('get_dashboard_summary'),
      supabase.rpc('get_live_activity'),
      supabase.rpc('get_on_leave_articles'),
    ])

    if (summaryRes.data)  setSummary(summaryRes.data as DashboardSummary)
    if (liveRes.data)     setLive(liveRes.data as LiveActivityRow[])
    if (onLeaveRes.data)  setOnLeave(onLeaveRes.data as OnLeaveArticleRow[])
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
    refresh()

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

  return { summary, liveActivity, onLeaveArticles, loading, refresh }
}
