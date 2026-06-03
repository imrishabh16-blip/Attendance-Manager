'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import toast from 'react-hot-toast'
import type { InactivityAlert } from '@/types/app'

interface Props {
  alerts: InactivityAlert[]
  onDismissed: () => void
}

export function InactivityAlerts({ alerts, onDismissed }: Props) {
  const [dismissing, setDismissing] = useState<string | null>(null)
  const supabase = getSupabaseBrowserClient()

  async function dismiss(alertId: string) {
    setDismissing(alertId)
    const { error } = await supabase
      .from('inactivity_alerts')
      .update({ dismissed: true, dismissed_at: new Date().toISOString() })
      .eq('id', alertId)

    if (error) { toast.error('Failed to dismiss'); }
    else        { toast.success('Alert dismissed'); onDismissed() }
    setDismissing(null)
  }

  if (alerts.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {alerts.map(a => (
        <div
          key={a.id}
          className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3"
        >
          <div className="flex items-center gap-3 min-w-0">
            <Badge variant="warning">{a.days_inactive}d</Badge>
            <div className="min-w-0">
              <p className="text-sm font-medium text-amber-900 truncate">
                Inactive for {a.days_inactive} days
              </p>
              <p className="text-xs text-amber-700">
                Last activity: {a.last_activity_date ?? 'No activity recorded'}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            loading={dismissing === a.id}
            onClick={() => dismiss(a.id)}
            className="text-amber-700 hover:bg-amber-100 flex-shrink-0"
          >
            Dismiss
          </Button>
        </div>
      ))}
    </div>
  )
}
