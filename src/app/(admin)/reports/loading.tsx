export default function ReportsLoading() {
  return (
    <div className="min-h-screen bg-brand-100">
      {/* Header */}
      <div className="bg-white border-b border-brand-200 px-4 sm:px-6 py-4">
        <div className="max-w-3xl mx-auto">
          <div className="h-5 w-36 bg-brand-100 rounded animate-pulse" />
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-5 space-y-4">
        {/* Attendance Report card */}
        <div className="bg-white rounded-2xl border border-brand-200 shadow-sm overflow-hidden">
          {/* Card header */}
          <div className="px-5 py-4 border-b border-brand-200">
            <div className="h-4 w-40 bg-brand-100 rounded animate-pulse" />
          </div>
          {/* Card body */}
          <div className="px-5 py-4 space-y-4">
            {/* Date range row */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="h-3 w-8 bg-brand-100 rounded animate-pulse" />
                <div className="h-10 bg-brand-100 rounded-xl animate-pulse" />
              </div>
              <div className="space-y-1">
                <div className="h-3 w-4 bg-brand-100 rounded animate-pulse" />
                <div className="h-10 bg-brand-100 rounded-xl animate-pulse" />
              </div>
            </div>
            {/* Article selector */}
            <div className="h-10 bg-brand-100 rounded-xl animate-pulse" />
            {/* Export button */}
            <div className="h-10 w-52 bg-brand-100 rounded-xl animate-pulse" />
          </div>
        </div>

        {/* Assignment Activity card */}
        <div className="bg-white rounded-2xl border border-brand-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-brand-200">
            <div className="h-4 w-52 bg-brand-100 rounded animate-pulse" />
          </div>
          <div className="px-5 py-4 space-y-4">
            <div className="h-3.5 w-full bg-brand-100 rounded animate-pulse" />
            <div className="h-3.5 w-3/4 bg-brand-100 rounded animate-pulse" />
            <div className="h-10 w-56 bg-brand-100 rounded-xl animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  )
}
