'use client'

import { useState, useEffect, useCallback } from 'react'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import type { AttendanceRecord, LeaveRecord } from '@/types/app'

export function useAttendanceSession(userId: string) {
  const supabase = getSupabaseBrowserClient()

  const [todayRecords, setTodayRecords] = useState<AttendanceRecord[]>([])
  const [openRecord, setOpenRecord] = useState<AttendanceRecord | null>(null)
  const [todayLeave, setTodayLeave] = useState<LeaveRecord | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    // Compute fresh IST date on every load call — computing it at hook
    // init means a page open across midnight would query the wrong date.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
    const [{ data: records, error: recordsError }, { data: leave }] = await Promise.all([
      supabase
        .from('attendance_records')
        .select('*, assignments(client_name, work_type)')
        .eq('article_id', userId)
        .eq('attendance_date', today)
        .order('checked_in_at', { ascending: true }),
      supabase
        .from('leave_records')
        .select('*')
        .eq('article_id', userId)
        .eq('leave_date', today)
        .maybeSingle(),
    ])

    const recs = (records ?? []) as AttendanceRecord[]
    const open = recs.find(r => r.checked_in_at && !r.checked_out_at) ?? null
    setTodayRecords(recs)
    setOpenRecord(open)
    setTodayLeave(leave)
    setLoading(false)

    // Surface query errors so callers (e.g. post-network-failure verification)
    // can distinguish "no record" from "couldn't reach the database".
    if (recordsError) throw recordsError
    return open
  }, [supabase, userId])

  useEffect(() => {
    // Mount load tolerates errors — the empty state set above is sufficient.
    load().catch(() => {})
  }, [load])

  return { todayRecords, openRecord, todayLeave, loading, refresh: load }
}
