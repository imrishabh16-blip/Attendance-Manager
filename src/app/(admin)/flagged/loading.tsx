export default function FlaggedLoading() {
  return (
    <div className="min-h-screen bg-brand-100">
      {/* Header */}
      <div className="bg-white border-b border-brand-200 px-4 sm:px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="space-y-1.5">
            <div className="h-5 w-36 bg-brand-100 rounded animate-pulse" />
            <div className="h-3 w-72 bg-brand-100 rounded animate-pulse" />
          </div>
          {/* Pending count badge */}
          <div className="h-6 w-20 bg-brand-100 rounded-full animate-pulse" />
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-5 space-y-4">
        {/* Tab bar — Pending / Resolved */}
        <div className="flex gap-2 border-b border-gray-200 pb-1">
          {[0, 1].map(i => (
            <div key={i} className="h-8 w-24 bg-brand-100 rounded-t-lg animate-pulse" />
          ))}
        </div>

        {/* Flagged record card skeletons — wider layout with date grid + action buttons */}
        <div className="grid gap-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="bg-white rounded-2xl border border-brand-200 shadow-sm px-5 py-4 space-y-3">
              {/* Name + type badge + status badge */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-28 bg-brand-100 rounded animate-pulse" />
                  <div className="h-5 w-16 bg-brand-100 rounded-full animate-pulse" />
                </div>
                <div className="h-5 w-16 bg-brand-100 rounded-full animate-pulse flex-shrink-0" />
              </div>
              {/* Date / time grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[0, 1, 2].map(j => (
                  <div key={j} className="space-y-1">
                    <div className="h-3 w-12 bg-brand-100 rounded animate-pulse" />
                    <div className="h-3.5 w-20 bg-brand-100 rounded animate-pulse" />
                  </div>
                ))}
              </div>
              {/* Action buttons */}
              <div className="flex flex-wrap gap-2 pt-1">
                <div className="h-8 w-36 bg-brand-100 rounded-xl animate-pulse" />
                <div className="h-8 w-32 bg-brand-100 rounded-xl animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
