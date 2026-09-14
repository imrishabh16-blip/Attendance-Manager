export default function ClientWorkDurationLoading() {
  return (
    <div className="min-h-screen bg-brand-100">
      {/* Header */}
      <div className="bg-white border-b border-brand-200 px-4 sm:px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-3">
          <div className="h-5 w-48 bg-brand-100 rounded animate-pulse" />
          <div className="h-10 w-32 bg-brand-100 rounded-xl animate-pulse" />
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5">
        <div className="bg-white rounded-2xl border border-brand-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-brand-200">
            <div className="h-4 w-40 bg-brand-100 rounded animate-pulse" />
          </div>
          <div className="p-5 space-y-2">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="h-12 bg-brand-100 rounded-xl animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
