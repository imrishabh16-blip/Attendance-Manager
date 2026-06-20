'use client'

import { useState, useCallback } from 'react'
import { requestGPS, gpsErrorMessage, type GPSCoordinates } from '@/lib/gps'

type GPSState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; coords: GPSCoordinates }
  | { status: 'error'; message: string }

export type AcquireResult =
  | { success: true;  coords: GPSCoordinates }
  | { success: false; errorCode: 'denied' | 'unavailable' | 'timeout' | 'not_supported'; errorMessage: string }

export function useGPS() {
  const [state, setState] = useState<GPSState>({ status: 'idle' })

  const acquire = useCallback(async (): Promise<AcquireResult> => {
    setState({ status: 'loading' })
    const result = await requestGPS()
    if (result.ok) {
      setState({ status: 'success', coords: result.coords })
      return { success: true, coords: result.coords }
    } else {
      const errorMessage = gpsErrorMessage(result.error)
      setState({ status: 'error', message: errorMessage })
      return { success: false, errorCode: result.error, errorMessage }
    }
  }, [])

  const reset = useCallback(() => setState({ status: 'idle' }), [])

  return { state, acquire, reset }
}
