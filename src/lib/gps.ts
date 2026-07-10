export interface GPSCoordinates {
  latitude: number
  longitude: number
  accuracy: number
  timestamp: number
}

export type GPSResult =
  | { ok: true; coords: GPSCoordinates }
  | { ok: false; error: 'denied' | 'unavailable' | 'timeout' | 'not_supported' }

const TIMEOUT_MS  = 15_000
const MAX_AGE_MS  = 30_000

export async function requestGPS(): Promise<GPSResult> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return { ok: false, error: 'not_supported' }
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const age = Date.now() - pos.timestamp
        if (age > MAX_AGE_MS) {
          // Force a fresh fix if the cached one is too old
          navigator.geolocation.getCurrentPosition(
            (fresh) => resolve({
              ok: true,
              coords: {
                latitude:  fresh.coords.latitude,
                longitude: fresh.coords.longitude,
                accuracy:  fresh.coords.accuracy,
                timestamp: fresh.timestamp,
              },
            }),
            () => resolve({
              ok: true,
              coords: {
                latitude:  pos.coords.latitude,
                longitude: pos.coords.longitude,
                accuracy:  pos.coords.accuracy,
                timestamp: pos.timestamp,
              },
            }),
            { enableHighAccuracy: true, timeout: TIMEOUT_MS, maximumAge: 0 }
          )
          return
        }
        resolve({
          ok: true,
          coords: {
            latitude:  pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy:  pos.coords.accuracy,
            timestamp: pos.timestamp,
          },
        })
      },
      (err) => {
        if (err.code === GeolocationPositionError.PERMISSION_DENIED) {
          resolve({ ok: false, error: 'denied' })
        } else if (err.code === GeolocationPositionError.TIMEOUT) {
          resolve({ ok: false, error: 'timeout' })
        } else {
          resolve({ ok: false, error: 'unavailable' })
        }
      },
      {
        enableHighAccuracy: true,
        timeout: TIMEOUT_MS,
        maximumAge: MAX_AGE_MS,
      }
    )
  })
}

export function buildMapsLink(lat: number, lng: number): string {
  return `https://maps.google.com/?q=${lat},${lng}`
}

// Server-side guard for check-in/check-out request bodies. The browser's
// requestGPS() above always produces finite coordinates within real-world
// bounds, so this never rejects a legitimate client-sent payload — it only
// catches malformed/forged/non-numeric values (strings, NaN, Infinity,
// out-of-range numbers) that a hand-crafted request could otherwise smuggle
// straight into attendance_records.
export function isValidCoordinate(latitude: unknown, longitude: unknown): boolean {
  return (
    typeof latitude === 'number' && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90 &&
    typeof longitude === 'number' && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180
  )
}

export function gpsErrorMessage(error: string): string {
  const messages: Record<string, string> = {
    denied:        'Location access was denied. Please enable location in your browser settings to check in.',
    unavailable:   'Location is currently unavailable. Please check your device settings and try again.',
    timeout:       'Location request timed out. Please move to an area with better signal and try again.',
    not_supported: 'Your browser does not support location services. Please use a modern mobile browser.',
  }
  return messages[error] ?? 'Unable to get your location. Please try again.'
}
