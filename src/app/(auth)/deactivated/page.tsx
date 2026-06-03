'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'

export default function DeactivatedPage() {
  const router  = useRouter()
  const supabase = getSupabaseBrowserClient()

  useEffect(() => {
    // Poll every 10 s — redirect automatically when admin reactivates the account
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
    }, 10_000)

    return () => clearInterval(interval)
  }, [router, supabase])

  async function signOut() {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-brand-100 px-4">
      <div className="w-full max-w-sm text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-red-100 mb-6">
          <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728L5.636 5.636" />
          </svg>
        </div>

        <h1 className="text-xl font-bold text-gray-900 mb-2">Account Deactivated</h1>
        <p className="text-sm text-gray-500 mb-2">
          Your account has been deactivated by your office administrator.
        </p>
        <p className="text-sm text-gray-400 mb-10">
          You will be redirected automatically if your account is reactivated.
        </p>

        <button
          onClick={signOut}
          className="text-sm text-brand-600 hover:text-brand-700 font-medium"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
