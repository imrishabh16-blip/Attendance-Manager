'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { getSupabaseBrowserClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Briefcase, Users, FileText, LogOut, GraduationCap
} from 'lucide-react'
import type { UserRole } from '@/types/app'

interface Props {
  profile: { full_name: string; role: UserRole }
}

const navItems = [
  { href: '/dashboard',   label: 'Dashboard',    icon: LayoutDashboard, roles: ['admin', 'partner', 'manager'] as UserRole[] },
  { href: '/assignments', label: 'Assignments',   icon: Briefcase,       roles: ['admin', 'partner', 'manager'] as UserRole[] },
  { href: '/articles',    label: 'Articles',      icon: GraduationCap,   roles: ['admin', 'partner', 'manager'] as UserRole[] },
  { href: '/users',       label: 'Users',         icon: Users,           roles: ['admin'] as UserRole[] },
  { href: '/reports',     label: 'Reports',       icon: FileText,        roles: ['admin', 'partner', 'manager'] as UserRole[] },
]

export default function AdminNav({ profile }: Props) {
  const pathname = usePathname()
  const router   = useRouter()
  const supabase = getSupabaseBrowserClient()

  async function signOut() {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  const visible = navItems.filter(n => n.roles.includes(profile.role))

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden sm:flex flex-col w-56 bg-white border-r border-brand-100 min-h-screen">
        <div className="px-4 py-5 border-b border-brand-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-brand-600 text-white text-xs font-bold flex items-center justify-center">
              CA
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-gray-900 truncate">{profile.full_name}</p>
              <p className="text-xs text-gray-400 capitalize">{profile.role}</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {visible.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors',
                pathname === item.href || pathname.startsWith(item.href + '/')
                  ? 'bg-brand-50 text-brand-700'
                  : 'text-gray-600 hover:bg-gray-50'
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="px-3 pb-4">
          <button
            onClick={signOut}
            className="flex items-center gap-3 px-3 py-2.5 w-full rounded-xl text-sm font-medium text-gray-500 hover:bg-gray-50 transition-colors"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="sm:hidden fixed bottom-0 inset-x-0 bg-white border-t border-brand-100 z-40 safe-bottom">
        <div className="flex">
          {visible.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-colors',
                pathname === item.href || pathname.startsWith(item.href + '/')
                  ? 'text-brand-600'
                  : 'text-gray-400'
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
    </>
  )
}
