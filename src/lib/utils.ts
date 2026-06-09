import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow } from 'date-fns'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   true,
  })
}

export function formatDate(iso: string): string {
  return format(new Date(iso), 'dd MMM yyyy')
}

export function formatDateTime(iso: string): string {
  return format(new Date(iso), 'dd MMM yyyy, hh:mm a')
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

export function formatHours(hours: number): string {
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

export function relativeTime(iso: string): string {
  return formatDistanceToNow(new Date(iso), { addSuffix: true })
}

/**
 * Returns today's date as YYYY-MM-DD in India Standard Time (UTC+5:30).
 * Using toISOString().split('T')[0] returns a UTC date, which is wrong for
 * India — at 12:01 AM IST, UTC is still the previous day (6:31 PM UTC).
 * 'en-CA' locale is used because it produces the YYYY-MM-DD format PostgreSQL expects.
 */
export function todayIST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}

/** @deprecated Use todayIST() — this alias exists for backward compatibility. */
export function todayISO(): string {
  return todayIST()
}

export function workTypeBadgeColor(wt: string): string {
  const map: Record<string, string> = {
    'Internal Audit':           'bg-purple-100 text-purple-700',
    'Statutory Audit':          'bg-blue-100 text-blue-700',
    'Tax Audit':                'bg-orange-100 text-orange-700',
    'GST Compliance':           'bg-green-100 text-green-700',
    'GST Litigation':           'bg-red-100 text-red-700',
    'Income Tax Compliance':    'bg-teal-100 text-teal-700',
    'Income Tax Litigation':    'bg-rose-100 text-rose-700',
    'Others':                   'bg-gray-100 text-gray-700',
  }
  return map[wt] ?? 'bg-gray-100 text-gray-700'
}
