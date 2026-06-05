// Shown by Next.js while DashboardPage (server component) runs its auth check.
// Matches the skeleton DashboardClient shows while RPCs complete, so the two
// phases appear as one seamless loading state.
export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-brand-100">
      {/* Header */}
      <div className="bg-white border-b border-brand-200 px-4 sm:px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="space-y-1.5">
            <div className="h-5 w-28 bg-brand-100 rounded animate-pulse" />
            <div className="h-3 w-44 bg-brand-100 rounded animate-pulse" />
          </div>
          <div className="w-9 h-9 rounded-lg bg-brand-100 animate-pulse" />
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Metric cards — 2 cols mobile / 4 cols desktop */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-2xl border border-brand-200 shadow-sm p-4 flex flex-col gap-3 animate-pulse">
              <div className="w-10 h-10 rounded-xl bg-brand-100" />
              <div className="space-y-1.5">
                <div className="h-7 w-10 bg-brand-100 rounded" />
                <div className="h-3 w-28 bg-brand-100 rounded" />
              </div>
            </div>
          ))}
        </div>

        {/* Live activity card */}
        <div className="bg-white rounded-2xl border border-brand-200 shadow-sm animate-pulse h-40" />

        {/* Article status card */}
        <div className="bg-white rounded-2xl border border-brand-200 shadow-sm animate-pulse h-32" />
      </div>
    </div>
  )
}
