'use client'

import { useState, useCallback } from 'react'
import { requestGPS, gpsErrorMessage, type GPSCoordinates } from '@/lib/gps'

type GPSState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; coords: GPSCoordinates }
  | { status: 'error'; message: string }

export function useGPS() {
  const [state, setState] = useState<GPSState>({ status: 'idle' })

  const acquire = useCallback(async (): Promise<GPSCoordinates | null> => {
    setState({ status: 'loading' })
    const result = await requestGPS()
    if (result.ok) {
      setState({ status: 'success', coords: result.coords })
      return result.coords
    } else {
      setState({ status: 'error', message: gpsErrorMessage(result.error) })
      return null
    }
  }, [])

  const reset = useCallback(() => setState({ status: 'idle' }), [])

  return { state, acquire, reset }
}
