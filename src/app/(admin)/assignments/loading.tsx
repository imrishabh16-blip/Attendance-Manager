export default function AssignmentsLoading() {
  return (
    <div className="min-h-screen bg-brand-100">
      {/* Header */}
      <div className="bg-white border-b border-brand-200 px-4 sm:px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="h-5 w-32 bg-brand-100 rounded animate-pulse" />
          <div className="h-8 w-32 bg-brand-100 rounded-xl animate-pulse" />
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-5 space-y-4">
        {/* Tab toggle */}
        <div className="flex gap-1 bg-brand-200 p-1 rounded-xl w-fit animate-pulse">
          <div className="h-7 w-28 bg-white rounded-lg opacity-80" />
          <div className="h-7 w-20 bg-brand-100 rounded-lg opacity-50" />
          <div className="h-7 w-24 bg-brand-100 rounded-lg opacity-50" />
        </div>

        {/* Search + status filter row */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="h-10 flex-1 bg-white rounded-xl border border-brand-200 animate-pulse" />
          <div className="flex gap-2">
            {[0, 1, 2].map(i => (
              <div key={i} className="h-10 w-20 bg-white rounded-xl border border-brand-200 animate-pulse" />
            ))}
          </div>
        </div>

        {/* Work type chip row */}
        <div className="flex gap-2 pb-1">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="h-7 w-20 flex-shrink-0 bg-white rounded-full border border-brand-200 animate-pulse" />
          ))}
        </div>

        {/* Assignment card skeletons */}
        <div className="grid gap-3">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="bg-white rounded-2xl border border-brand-200 shadow-sm px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-40 bg-brand-100 rounded animate-pulse" />
                  <div className="h-5 w-24 bg-brand-100 rounded-full animate-pulse" />
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <div className="h-7 w-10 bg-brand-100 rounded-lg animate-pulse" />
                  <div className="h-7 w-7 bg-brand-100 rounded-lg animate-pulse" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
