import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'

interface MetricCardProps {
  label: string
  value: number | string
  icon:  LucideIcon
  color?: 'blue' | 'green' | 'amber' | 'red' | 'purple' | 'gray'
  alert?: boolean
  href?:  string
  onClick?: () => void
}

const colors = {
  blue:   { bg: 'bg-blue-50',   icon: 'text-blue-600',   value: 'text-blue-700' },
  green:  { bg: 'bg-green-50',  icon: 'text-green-600',  value: 'text-green-700' },
  amber:  { bg: 'bg-amber-50',  icon: 'text-amber-600',  value: 'text-amber-700' },
  red:    { bg: 'bg-red-50',    icon: 'text-red-600',    value: 'text-red-700' },
  purple: { bg: 'bg-purple-50', icon: 'text-purple-600', value: 'text-purple-700' },
  gray:   { bg: 'bg-gray-100',  icon: 'text-gray-500',   value: 'text-gray-700' },
}

export function MetricCard({ label, value, icon: Icon, color = 'blue', alert, href, onClick }: MetricCardProps) {
  const c = colors[color]
  const card = (
    <div className={cn(
      'bg-white rounded-2xl border border-brand-200 shadow-sm p-4 flex flex-col gap-3',
      alert && 'ring-2 ring-red-300',
      (href || onClick) && 'cursor-pointer hover:shadow-md transition-shadow'
    )}>
      <div className={cn('inline-flex items-center justify-center w-10 h-10 rounded-xl', c.bg)}>
        <Icon className={cn('h-5 w-5', c.icon)} />
      </div>
      <div>
        <p className={cn('text-2xl font-bold', c.value)}>{value}</p>
        <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      </div>
    </div>
  )

  if (href)    return <Link href={href}>{card}</Link>
  if (onClick) return <button onClick={onClick} className="w-full text-left">{card}</button>
  return card
}
