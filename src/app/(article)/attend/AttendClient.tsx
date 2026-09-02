'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { useGPS } from '@/hooks/useGPS'
import { useAttendanceSession } from '@/hooks/useAttendanceSession'
import { ClientWorkSelector } from '@/components/attendance/ClientWorkSelector'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { buildMapsLink } from '@/lib/gps'
import { cn, formatTime, formatDuration } from '@/lib/utils'
import type { AttendanceRecord, WorkType } from '@/types/app'
import { MapPin, LogIn, LogOut, Calendar, AlertCircle } from 'lucide-react'

interface Props {
  profile: { id: string; full_name: string; role: string }
}

type CheckInMode =
  | { kind: 'regular';     client_name: string; work_type: WorkType }
  | { kind: 'unallocated' }

type Step =
  | 'idle'
  | 'gps_loading'
  | 'select'
  | 'note_input'
  | 'submitting'


function getFirstName(full: string): string {
  return full.split(' ')[0] || full
}

function getGreeting(): { text: string; sub: string } {
  const hour = parseInt(
    new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', hour12: false }),
    10
  )
  if (hour >= 5  && hour < 12) return { text: 'Good Morning',   sub: 'Ready to check in?' }
  if (hour >= 12 && hour < 17) return { text: 'Good Afternoon', sub: "Hope you're having a productive day." }
  if (hour >= 17 && hour < 21) return { text: 'Good Evening',   sub: "Hope you're having a productive day." }
  return                               { text: 'Hey',            sub: "Hope you're having a productive day." }
}

export default function AttendClient({ profile }: Props) {
  const supabase                                                          = getSupabaseBrowserClient()
  const { acquire }                                                       = useGPS()
  const { todayRecords, openRecord, todayLeave, loading, refresh }       = useAttendanceSession(profile.id)

  const [step, setStep]               = useState<Step>('idle')
  const [note, setNote]               = useState('')
  const [checkInMode, setCheckInMode] = useState<CheckInMode | null>(null)
  const [gpsCoords, setGpsCoords]     = useState<{ latitude: number; longitude: number } | null>(null)
  const [leaveLoading, setLeaveLoading] = useState(false)
  const [reportingManagerId, setReportingManagerId] = useState('')

  // Reporting Manager is not role-restricted beyond excluding Article/Intern
  // (see get_reporting_manager_candidates, migrations 00025/00026). Cached
  // via React Query the same way ClientWorkSelector caches clients/work_types,
  // so reopening the check-in flow doesn't re-fetch.
  //
  // Only enabled for a regular check-in — Reporting Manager is optional for
  // unallocated ones and the selector is hidden entirely there, so fetching
  // candidates for it would be a wasted request and, worse, could block an
  // unallocated check-in behind a loading/error state it doesn't need.
  //
  // Unlike ClientWorkSelector's queries, this one intentionally lets errors
  // surface (isError) instead of swallowing them into an empty array —
  // Reporting Manager is mandatory for regular check-ins, so a failed fetch
  // must block those with a visible, retryable message rather than silently
  // rendering as "no managers configured" or leaving Confirm disabled with
  // no explanation.
  const {
    data:      managerCandidates,
    isLoading: managersLoading,
    isError:   managersError,
    refetch:   refetchManagers,
  } = useQuery({
    queryKey: ['reporting_manager_candidates'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_reporting_manager_candidates')
      if (error) throw error
      return (data ?? []) as { id: string; full_name: string }[]
    },
    enabled: checkInMode?.kind === 'regular',
  })

  // True whenever any operation is in flight
  const busy = step !== 'idle' || leaveLoading

  async function toggleLeave() {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
    setLeaveLoading(true)
    try {
      const res = await fetch('/api/leave', {
        method:  todayLeave ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ leave_date: today }),
      })
      let json: Record<string, unknown> = {}
      try { json = await res.json() } catch { /* non-JSON body */ }
      if (!res.ok) {
        toast.error(typeof json.error === 'string' ? json.error : 'Could not update leave status')
        return
      }
      toast.success(todayLeave ? 'Leave cancelled' : 'Leave marked')
      refresh()
    } catch {
      toast.error('Network error. Check your connection and try again.')
    } finally {
      setLeaveLoading(false)
    }
  }

  // ── CHECK-IN FLOW ──────────────────────────────────────────────────────

  async function startCheckIn() {
    setCheckInMode(null)
    setReportingManagerId('')
    setStep('gps_loading')
    const result = await acquire()
    if (!result.success) {
      setStep('idle')
      toast.error(result.errorMessage)
      return
    }
    setGpsCoords(result.coords)
    setStep('select')
  }

  function onClientSelected(client_name: string, work_type: WorkType) {
    setCheckInMode({ kind: 'regular', client_name, work_type })
    setStep('note_input')
  }

  function onSelectUnallocated() {
    setCheckInMode({ kind: 'unallocated' })
    setStep('note_input')
  }

  async function submitCheckIn() {
    if (!gpsCoords || !checkInMode) return
    if (checkInMode.kind === 'regular' && !reportingManagerId) {
      toast.error('Select a Reporting Manager')
      return
    }
    setStep('submitting')

    let body: Record<string, unknown>

    if (checkInMode.kind === 'regular') {
      body = {
        attendance_type: 'regular',
        client_name:     checkInMode.client_name,
        work_type:       checkInMode.work_type,
        latitude:        gpsCoords.latitude,
        longitude:       gpsCoords.longitude,
        note:            note || null,
        reporting_manager_id: reportingManagerId,
      }
    } else {
      body = {
        attendance_type: 'unallocated',
        latitude:        gpsCoords.latitude,
        longitude:       gpsCoords.longitude,
        note:            note || null,
        // Reporting Manager is optional for unallocated check-ins and the
        // selector is hidden entirely, so this is always explicitly null,
        // never whatever stale value reportingManagerId might hold.
        reporting_manager_id: null,
      }
    }

    const onCheckInSuccess = () => {
      toast.success('Checked in successfully')
      setNote('')
      setCheckInMode(null)
      setReportingManagerId('')
    }

    try {
      const res = await fetch('/api/attendance/checkin', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      let json: Record<string, unknown> = {}
      try { json = await res.json() } catch { /* non-JSON body */ }
      if (!res.ok) {
        toast.error(typeof json.error === 'string' ? json.error : 'Check-in failed. Please try again.')
        return
      }
      onCheckInSuccess()
      // UI refresh only — the write already succeeded, so a failure here must
      // not be reported as a check-in failure.
      try { await refresh() } catch { /* stale UI until next load; record is saved */ }
    } catch {
      // The POST failed before a response arrived. The record may still have been
      // written — verify via the existing session query before reporting failure.
      try {
        const open = await refresh()
        if (open) {
          onCheckInSuccess()
        } else {
          toast.error('Network error. Check your connection and try again.')
        }
      } catch {
        toast.error("Couldn't verify whether your attendance was recorded. Please check your status or try again.")
      }
    } finally {
      setStep('idle')
    }
  }

  // ── CHECK-OUT FLOW ─────────────────────────────────────────────────────

  async function handleCheckOut() {
    if (!openRecord) return
    setStep('gps_loading')
    const result = await acquire()
    if (!result.success) {
      setStep('idle')
      toast.error(result.errorMessage)
      return
    }
    setGpsCoords(result.coords)
    setStep('note_input')
  }

  async function submitCheckOut() {
    if (!gpsCoords || !openRecord) return
    setStep('submitting')

    try {
      const res = await fetch('/api/attendance/checkout', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          record_id: openRecord.id,
          latitude:  gpsCoords.latitude,
          longitude: gpsCoords.longitude,
          note:      note || undefined,
        }),
      })
      let json: Record<string, unknown> = {}
      try { json = await res.json() } catch { /* non-JSON body */ }
      if (!res.ok) {
        toast.error(typeof json.error === 'string' ? json.error : 'Check-out failed. Please try again.')
        return
      }
      toast.success('Checked out')
      setNote('')
      await refresh()
    } catch {
      toast.error('Network error. Check your connection and try again.')
    } finally {
      setStep('idle')
    }
  }

  // ── RENDER ─────────────────────────────────────────────────────────────

  const firstName = getFirstName(profile.full_name)
  const { text: greetingText, sub: greetingSub } = getGreeting()

  // true when the note_input modal belongs to the checkout path
  const isCheckoutFlow = step === 'note_input' && !!openRecord && !!gpsCoords

  return (
    <div className="min-h-screen bg-brand-100">
      {/* Header */}
      <div className="bg-white border-b border-brand-200 px-4 py-4">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400">
              {new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <h1 className="text-base font-semibold text-gray-900">{profile.full_name}</h1>
          </div>
          <StatusBadge openRecord={openRecord} onLeave={!!todayLeave} />
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 py-5 flex flex-col gap-4">
        {loading ? (
          <div className="flex justify-center py-12"><Spinner /></div>
        ) : (
          <>
            {/* Greeting */}
            <div>
              <p className="text-xl font-semibold text-gray-900">
                {greetingText}, {firstName} 👋
              </p>
              <p className="text-sm text-gray-500 mt-1">{greetingSub}</p>
            </div>

            {/* Primary action */}
            {step === 'idle' && (
              openRecord ? (
                <Button onClick={handleCheckOut} size="lg" variant="danger" className="w-full" disabled={leaveLoading}>
                  <LogOut className="h-5 w-5" /> Check Out
                </Button>
              ) : (
                <Button onClick={startCheckIn} size="lg" className="w-full" disabled={!!todayLeave || leaveLoading}>
                  <LogIn className="h-5 w-5" /> Check In
                </Button>
              )
            )}

            {step === 'gps_loading' && (
              <div className="flex flex-col items-center gap-3 py-6">
                <Spinner className="h-8 w-8" />
                <p className="text-sm text-gray-500">Getting your location...</p>
              </div>
            )}

            {/* Client + work-type selector */}
            <Modal
              open={step === 'select'}
              onClose={() => setStep('idle')}
              title="Select Assignment"
            >
              <ClientWorkSelector
                onSelect={onClientSelected}
                onSelectUnallocated={onSelectUnallocated}
              />
            </Modal>

            {/* Note input — shared by check-in and check-out */}
            <Modal
              open={step === 'note_input'}
              onClose={() => setStep('idle')}
              title={isCheckoutFlow ? 'Check Out' : 'Check In'}
            >
              <div className="flex flex-col gap-4">
                {/* Context summary (check-in only) */}
                {!isCheckoutFlow && checkInMode && (
                  <CheckInSummary mode={checkInMode} />
                )}

                {/* Reporting Manager — mandatory for regular check-ins only;
                    hidden entirely for unallocated ones, which may genuinely
                    have nobody to report to (see checkin/route.ts). Loading/
                    error/empty are distinguished explicitly so a failed fetch
                    never looks like "no managers" or a silently-stuck field. */}
                {!isCheckoutFlow && checkInMode?.kind === 'regular' && (
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Reporting Manager
                    </label>

                    {managersLoading ? (
                      <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-gray-200 bg-brand-50">
                        <Spinner className="h-4 w-4" />
                        <span className="text-sm text-gray-500">Loading Reporting Managers…</span>
                      </div>
                    ) : managersError ? (
                      <div className="flex flex-col gap-2">
                        <p className="text-sm text-red-600 bg-red-50 px-3 py-2.5 rounded-xl flex items-start gap-2">
                          <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                          Unable to load Reporting Managers. Please try again or contact an administrator.
                        </p>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => refetchManagers()}
                          className="self-start"
                        >
                          Retry
                        </Button>
                      </div>
                    ) : (managerCandidates ?? []).length === 0 ? (
                      <p className="text-xs text-amber-600 bg-amber-50 px-3 py-2 rounded-xl">
                        No eligible Reporting Managers are currently available.
                      </p>
                    ) : (
                      <select
                        value={reportingManagerId}
                        onChange={e => setReportingManagerId(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
                      >
                        <option value="">— Select who you're reporting to —</option>
                        {(managerCandidates ?? []).map(m => (
                          <option key={m.id} value={m.id}>{m.full_name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                <textarea
                  placeholder="Add a note (optional)"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <Button
                  onClick={isCheckoutFlow ? submitCheckOut : submitCheckIn}
                  loading={step === 'submitting'}
                  disabled={
                    !isCheckoutFlow &&
                    checkInMode?.kind === 'regular' &&
                    (managersLoading || managersError || !reportingManagerId)
                  }
                  className="w-full"
                  size="lg"
                >
                  {isCheckoutFlow ? (
                    <><LogOut className="h-4 w-4" /> Confirm Check Out</>
                  ) : (
                    <><LogIn className="h-4 w-4" /> Confirm Check In</>
                  )}
                </Button>
              </div>
            </Modal>

            {/* Leave */}
            {!openRecord && (
              <button
                onClick={toggleLeave}
                disabled={busy}
                className={cn(
                  'flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium transition-colors',
                  todayLeave
                    ? 'border-amber-300 bg-amber-50 text-amber-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300',
                  busy && 'opacity-50 cursor-not-allowed'
                )}
              >
                <Calendar className="h-4 w-4" />
                {todayLeave ? 'On Leave Today — Cancel' : 'Mark Today as Leave'}
              </button>
            )}

            {/* Today's log */}
            {todayRecords.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-1">
                  Today&apos;s Log
                </p>
                {todayRecords.map(rec => (
                  <AttendanceLogCard key={rec.id} record={rec} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────

function CheckInSummary({ mode }: { mode: CheckInMode }) {
  if (mode.kind === 'regular') {
    return (
      <div className="bg-brand-50 rounded-xl px-4 py-3">
        <p className="text-sm font-medium text-gray-900">{mode.client_name}</p>
        <p className="text-xs text-brand-600 mt-0.5">{mode.work_type}</p>
      </div>
    )
  }
  return (
    <div className="bg-gray-50 rounded-xl px-4 py-3">
      <p className="text-sm font-medium text-gray-500">Unallocated</p>
      <p className="text-xs text-gray-400 mt-0.5">No client for this session</p>
    </div>
  )
}

function StatusBadge({
  openRecord,
  onLeave,
}: {
  openRecord: unknown
  onLeave: boolean
}) {
  if (openRecord) return <Badge variant="success" className="text-xs">Checked In</Badge>
  if (onLeave)   return <Badge variant="warning" className="text-xs">On Leave</Badge>
  return <Badge className="text-xs">Free</Badge>
}

function AttendanceLogCard({ record }: { record: AttendanceRecord }) {
  const assignment = (
    record as unknown as { assignments?: { client_name: string; work_type: string } }
  ).assignments

  let displayName: string
  let displaySub:  string | null = null

  if (record.attendance_type === 'unallocated') {
    displayName = 'Unallocated'
  } else if (assignment?.client_name) {
    displayName = assignment.client_name
    displaySub  = assignment.work_type
  } else {
    displayName = record.others_client_name ?? 'Others'
    displaySub  = 'Others'
  }

  const durationMins =
    record.checked_in_at && record.checked_out_at
      ? Math.round(
          (new Date(record.checked_out_at).getTime() - new Date(record.checked_in_at).getTime()) /
          60_000
        )
      : null

  return (
    <Card>
      <CardBody className="py-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{displayName}</p>
            {displaySub && (
              <p className="text-xs text-gray-400 truncate">{displaySub}</p>
            )}
            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
              <span className="text-xs text-gray-500">
                {record.checked_in_at ? formatTime(record.checked_in_at) : '—'}
                {' → '}
                {record.checked_out_at ? formatTime(record.checked_out_at) : (
                  <span className="text-green-600 font-medium">Active</span>
                )}
              </span>
              {durationMins !== null && (
                <span className="text-xs font-medium text-brand-600">
                  {formatDuration(durationMins)}
                </span>
              )}
            </div>
            {record.note && (
              <p className="text-xs text-gray-400 mt-1 truncate">{record.note}</p>
            )}
          </div>
          {record.checked_in_lat && (
            <a
              href={buildMapsLink(record.checked_in_lat, record.checked_in_lng!)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-500 hover:text-brand-700 flex-shrink-0"
            >
              <MapPin className="h-4 w-4" />
            </a>
          )}
        </div>
      </CardBody>
    </Card>
  )
}
