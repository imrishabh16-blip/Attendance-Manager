'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

// A plain <Link href="/assignments"> always targets a bare, query-string-less
// path — it can't know the ?q=/&status=/&workType= the user had on the list
// page, so every trip through it resets those filters. router.back() instead
// replays the actual previous history entry, which already has that query
// string baked in (written by the list page's debounced router.replace()),
// so the filtered view comes back exactly as it was.
//
// Falls back to a plain /assignments replace when this tab has no prior
// history to go back to (e.g. the detail page was opened directly/bookmarked).
// replace (not push) avoids adding a redundant history entry in that case.
export function BackButton() {
  const router = useRouter()

  function handleBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
    } else {
      router.replace('/assignments')
    }
  }

  return (
    <button
      onClick={handleBack}
      className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-3"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to Assignments
    </button>
  )
}
