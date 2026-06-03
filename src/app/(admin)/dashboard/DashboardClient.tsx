'use client'

import { useRealtimeDashboard } from '@/hooks/useRealtimeDashboard'
import { MetricCard } from '@/components/dashboard/MetricCard'
import { LiveActivityTable } from '@/components/dashboard/LiveActivityTable'
import { ArticleStatusGroups } from '@/components/dashboard/ArticleStatusGroups'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { RefreshCw, UserCheck, UserX, Clock, Flag } from 'lucide-react'

interface Props {
  profile: { id: string; full_name: string; role: string }
}

export default function DashboardClient({ profile: _ }: Props) {
  const { summary, liveActivity, onLeaveArticles, loading, refresh } = useRealtimeDashboard()

  const s = summary

  return (
    <div className="min-h-screen bg-brand-100">
      {/* Header */}
      <div className="bg-white border-b border-brand-200 px-4 sm:px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Dashboard</h1>
            <p className="text-xs text-gray-400">
              {new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-gray-400 hidden sm:block">
              Realtime
              <span className="inline-block w-1.5 h-1.5 bg-green-500 rounded-full ml-1.5 animate-pulse" />
            </span>
            <button onClick={refresh} className="p-3 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {loading ? (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="bg-white rounded-2xl border border-brand-200 shadow-sm p-4 flex flex-col gap-3 animate-pulse">
                  <div className="w-10 h-10 rounded-xl bg-brand-100" />
                  <div className="space-y-1.5">
                    <div className="h-7 w-10 bg-brand-100 rounded" />
                    <div className="h-3 w-28 bg-gray-100 rounded" />
                  </div>
                </div>
              ))}
            </div>
            <div className="bg-white rounded-2xl border border-brand-200 shadow-sm h-40 animate-pulse" />
            <div className="bg-white rounded-2xl border border-brand-200 shadow-sm h-32 animate-pulse" />
          </>
        ) : (
          <>
            {/* Metric strip — 4 cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <MetricCard
                label="Checked In Today"
                value={s?.active_articles_today ?? 0}
                icon={UserCheck}
                color="green"
              />
              <MetricCard
                label="On Leave"
                value={s?.on_leave_today ?? 0}
                icon={UserX}
                color="amber"
              />
              <MetricCard
                label="Open Check-ins"
                value={s?.open_checkins ?? 0}
                icon={Clock}
                color="green"
              />
              <MetricCard
                label="Flagged Records"
                value={s?.flagged_attendance ?? 0}
                icon={Flag}
                color="red"
                alert={(s?.flagged_attendance ?? 0) > 0}
                href="/flagged"
              />
            </div>

            {/* Live activity */}
            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                  <span className="inline-block w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                  Currently Checked In ({liveActivity.length})
                </h2>
              </CardHeader>
              <CardBody className="p-0">
                <LiveActivityTable rows={liveActivity} />
              </CardBody>
            </Card>

            {/* Article status groups */}
            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-gray-900">Article Status</h2>
              </CardHeader>
              <CardBody className="p-0">
                <ArticleStatusGroups liveActivity={liveActivity} onLeaveArticles={onLeaveArticles} />
              </CardBody>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}
