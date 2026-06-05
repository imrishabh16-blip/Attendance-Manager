export default function ArticlesLoading() {
  return (
    <div className="min-h-screen bg-brand-100">
      {/* Header */}
      <div className="bg-white border-b border-brand-200 px-4 sm:px-6 py-4">
        <div className="max-w-4xl mx-auto space-y-1.5">
          <div className="h-5 w-20 bg-brand-100 rounded animate-pulse" />
          <div className="h-3 w-28 bg-brand-100 rounded animate-pulse" />
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-5">
        <div className="grid gap-3">
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div key={i} className="bg-white rounded-2xl border border-brand-200 shadow-sm px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                {/* Name + email */}
                <div className="min-w-0 space-y-1.5">
                  <div className="h-4 w-36 bg-brand-100 rounded animate-pulse" />
                  <div className="h-3 w-48 bg-brand-100 rounded animate-pulse" />
                </div>
                {/* Status badge + link */}
                <div className="flex items-center gap-3 flex-shrink-0">
                  <div className="h-5 w-14 bg-brand-100 rounded-full animate-pulse" />
                  <div className="h-4 w-10 bg-brand-100 rounded animate-pulse" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
