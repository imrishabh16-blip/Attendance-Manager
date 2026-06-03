'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { Spinner } from '@/components/ui/Spinner'

export default function AwaitingPage() {
  const router = useRouter()
  const supabase = getSupabaseBrowserClient()

  useEffect(() => {
    // Poll own profile status every 8 seconds
    const interval = setInterval(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.replace('/login'); return }

      const { data: profile } = await supabase
        .from('profiles')
        .select('status, role')
        .eq('id', session.user.id)
        .single()

      if (!profile) return
      if (profile.status === 'active') {
        router.replace(profile.role === 'article' ? '/attend' : '/dashboard')
      }
      if (profile.status === 'deactivated') {
        router.replace('/deactivated')
      }
    }, 8_000)

    return () => clearInterval(interval)
  }, [router, supabase])

  async function signOut() {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-brand-100 px-4">
      <div className="w-full max-w-sm text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-amber-100 mb-6">
          <svg className="w-8 h-8 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">Awaiting Access</h1>
        <p className="text-sm text-gray-500 mb-2">
          Your account is pending approval by the admin.
        </p>
        <p className="text-sm text-gray-400 mb-8">
          You&apos;ll be redirected automatically once approved.
        </p>
        <div className="flex items-center justify-center gap-2 text-sm text-gray-400 mb-8">
          <Spinner className="h-4 w-4" />
          <span>Checking status...</span>
        </div>
        <button
          onClick={signOut}
          className="text-xs text-gray-400 hover:text-gray-600 underline"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
