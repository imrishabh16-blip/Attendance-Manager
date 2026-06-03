'use client'

import { useState } from 'react'
import toast from 'react-hot-toast'
import { useGPS } from '@/hooks/useGPS'
import { useAttendanceSession } from '@/hooks/useAttendanceSession'
import { ClientWorkSelector } from '@/components/attendance/ClientWorkSelector'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Card, CardBody } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Spinner } from '@/components/ui/Spinner'
import { buildMapsLink } from '@/lib/gps'
import { formatTime, formatDuration } from '@/lib/utils'
import type { AttendanceRecord, WorkType } from '@/types/app'
import { MapPin, LogIn, LogOut, Calendar } from 'lucide-react'

interface Props {
  profile: { id: string; full_name: string; role: string }
}

type CheckInMode =
  | { kind: 'regular';     client_name: string; work_type: WorkType }
  | { kind: 'others';      others_client_name?: string }
  | { kind: 'unallocated' }

type Step =
  | 'idle'
  | 'gps_loading'
  | 'select'
  | 'others_form'
  | 'note_input'
  | 'submitting'

export default function AttendClient({ profile }: Props) {
  const { state: gpsState, acquire }                        = useGPS()
  const { todayRecords, openRecord, todayLeave, loading, refresh } = useAttendanceSession(profile.id)

  const [step, setStep]             = useState<Step>('idle')
  const [note, setNote]             = useState('')
  const [othersName, setOthersName] = useState('')
  const [checkInMode, setCheckInMode] = useState<CheckInMode | null>(null)
  const [gpsCoords, setGpsCoords]   = useState<{ latitude: number; longitude: number } | null>(null)

  // ── CHECK-IN FLOW ──────────────────────────────────────────────────────

  async function startCheckIn() {
    setCheckInMode(null)
    setStep('gps_loading')
    const coords = await acquire()
    if (!coords) {
      setStep('idle')
      toast.error(
        gpsState.status === 'error'
          ? (gpsState as { message: string }).message
          : 'GPS unavailable'
      )
      return
    }
    setGpsCoords(coords)
    setStep('select')
  }

  function onClientSelected(client_name: string, work_type: WorkType) {
    setCheckInMode({ kind: 'regular', client_name, work_type })
    setStep('note_input')
  }

  function onSelectOthers() {
    setStep('others_form')
  }

  function onSelectUnallocated() {
    setCheckInMode({ kind: 'unallocated' })
    setStep('note_input')
  }

  async function submitCheckIn() {
    if (!gpsCoords || !checkInMode) return
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
      }
    } else if (checkInMode.kind === 'others') {
      body = {
        attendance_type:    'others',
        others_client_name: checkInMode.others_client_name || null,
        latitude:           gpsCoords.latitude,
        longitude:          gpsCoords.longitude,
        note:               note || null,
      }
    } else {
      body = {
        attendance_type: 'unallocated',
        latitude:        gpsCoords.latitude,
        longitude:       gpsCoords.longitude,
        note:            note || null,
      }
    }

    const res = await fetch('/api/attendance/checkin', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    const json = await res.json()
    if (!res.ok) { toast.error(json.error); setStep('idle'); return }

    toast.success('Checked in successfully')
    setStep('idle')
    setNote('')
    setOthersName('')
    setCheckInMode(null)
    await refresh()
  }

  // ── CHECK-OUT FLOW ─────────────────────────────────────────────────────

  async function handleCheckOut() {
    if (!openRecord) return
    setStep('gps_loading')
    const coords = await acquire()
    if (!coords) {
      setStep('idle')
      toast.error('GPS required for checkout')
      return
    }
    setGpsCoords(coords)
    setStep('note_input')
  }

  async function submitCheckOut() {
    if (!gpsCoords || !openRecord) return
    setStep('submitting')

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
    const json = await res.json()
    if (!res.ok) { toast.error(json.error); setStep('idle'); return }

    toast.success('Checked out')
    setStep('idle')
    setNote('')
    await refresh()
  }

  // ── LEAVE ──────────────────────────────────────────────────────────────

  async function toggleLeave() {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
    if (todayLeave) {
      const res  = await fetch('/api/leave', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ leave_date: today }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) { toast.success('Leave cancelled'); refresh() }
      else        { toast.error(json.error ?? 'Could not cancel leave') }
    } else {
      const res  = await fetch('/api/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ leave_date: today }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) { toast.success('Leave marked'); refresh() }
      else        { toast.error(json.error ?? 'Could not mark leave') }
    }
  }

  // ── RENDER ─────────────────────────────────────────────────────────────

  // true when the note_input modal belongs to the checkout path
  const isCheckoutFlow = step === 'note_input' && !!openRecord && !!gpsCoords

  return (
    <div className="min-h-screen bg-brand-100">
      {/* Header */}
      <div className="bg-white border-b border-brand-200 px-4 py-4">
        <div className="max-w-md mx-auto flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400">
              {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
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
            {/* Primary action */}
            {step === 'idle' && (
              openRecord ? (
                <Button onClick={handleCheckOut} size="lg" variant="danger" className="w-full">
                  <LogOut className="h-5 w-5" /> Check Out
                </Button>
              ) : (
                <Button onClick={startCheckIn} size="lg" className="w-full" disabled={!!todayLeave}>
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
                onSelectOthers={onSelectOthers}
                onSelectUnallocated={onSelectUnallocated}
              />
            </Modal>

            {/* Others client name */}
            <Modal
              open={step === 'others_form'}
              onClose={() => setStep('idle')}
              title="Others / Client Not In System"
            >
              <div className="flex flex-col gap-4">
                <p className="text-sm text-gray-500">
                  Your attendance will be recorded and flagged for admin review.
                </p>
                <input
                  placeholder="Client name (optional)"
                  value={othersName}
                  onChange={e => setOthersName(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <Button
                  onClick={() => {
                    setCheckInMode({ kind: 'others', others_client_name: othersName || undefined })
                    setStep('note_input')
                  }}
                  className="w-full"
                >
                  Continue
                </Button>
              </div>
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

            {/* Leave toggle */}
            {!openRecord && (
              <button
                onClick={toggleLeave}
                className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-medium transition-colors ${
                  todayLeave
                    ? 'border-amber-300 bg-amber-50 text-amber-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                }`}
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
  if (mode.kind === 'others') {
    return (
      <div className="bg-amber-50 rounded-xl px-4 py-3">
        <p className="text-sm font-medium text-gray-900">
          {mode.others_client_name || 'Others'}
        </p>
        <p className="text-xs text-amber-600 mt-0.5">Flagged for admin review</p>
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

function StatusBadge({ openRecord, onLeave }: { openRecord: unknown; onLeave: boolean }) {
  if (openRecord) return <Badge variant="success" className="text-xs">Checked In</Badge>
  if (onLeave)    return <Badge variant="warning" className="text-xs">On Leave</Badge>
  return                 <Badge className="text-xs">Free</Badge>
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
