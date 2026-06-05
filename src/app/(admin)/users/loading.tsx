export default function UsersLoading() {
  return (
    <div className="min-h-screen bg-brand-100">
      {/* Header */}
      <div className="bg-white border-b border-brand-200 px-4 sm:px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <div className="h-5 w-40 bg-brand-100 rounded animate-pulse" />
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-5 space-y-4">
        {/* Tab bar — Pending / Active / Deactivated */}
        <div className="flex gap-2 border-b border-gray-200 pb-1">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-8 w-24 bg-brand-100 rounded-t-lg animate-pulse" />
          ))}
        </div>

        {/* User card skeletons */}
        <div className="grid gap-3">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-2xl border border-brand-200 shadow-sm px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 space-y-1.5">
                  {/* Name + role badge */}
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-32 bg-brand-100 rounded animate-pulse" />
                    <div className="h-5 w-16 bg-brand-100 rounded-full animate-pulse" />
                  </div>
                  {/* Email */}
                  <div className="h-3 w-44 bg-brand-100 rounded animate-pulse" />
                </div>
                {/* Action button */}
                <div className="h-8 w-8 bg-brand-100 rounded-lg animate-pulse flex-shrink-0" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
