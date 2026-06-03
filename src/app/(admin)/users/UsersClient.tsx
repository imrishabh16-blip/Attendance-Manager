'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Modal } from '@/components/ui/Modal'
import toast from 'react-hot-toast'
import type { Profile, UserRole } from '@/types/app'
import { UserCheck, UserX, Shield } from 'lucide-react'

interface Props {
  users:           Profile[]
  currentUserId:   string
  currentUserRole: UserRole
}

const ALL_ROLES: UserRole[] = ['article', 'manager', 'partner', 'admin']

export default function UsersClient({ users: initial, currentUserId, currentUserRole }: Props) {
  const [users, setUsers]               = useState(initial)
  const [tab, setTab]                   = useState<'pending' | 'active' | 'deactivated'>('pending')
  const [approveModal, setApprove]      = useState<Profile | null>(null)
  const [approveRole, setApproveRole]   = useState<UserRole>('article')
  const [roleModal, setRoleModal]       = useState<Profile | null>(null)
  const [selectedRole, setSelectedRole] = useState<UserRole>('article')
  const [working, setWorking]           = useState<string | null>(null)

  const filtered    = users.filter(u => u.status === tab)
  const isAdmin     = currentUserRole === 'admin'
  const canEditRoles = currentUserRole === 'admin' || currentUserRole === 'partner'
  // Partners cannot elevate to admin — mirrors server-side guard
  const editableRoles: UserRole[] = isAdmin ? ALL_ROLES : ['article', 'manager', 'partner']

  function openRoleModal(u: Profile) {
    setSelectedRole(u.role)
    setRoleModal(u)
  }

  async function callApi(userId: string, action: string, extra?: Record<string, unknown>) {
    setWorking(userId)
    const res = await fetch(`/api/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...extra }),
    })
    const json = await res.json()
    if (!res.ok) { toast.error(json.error); setWorking(null); return null }
    setUsers(prev => prev.map(u => u.id === userId ? json.profile : u))
    setWorking(null)
    return json.profile as Profile
  }

  async function approve() {
    if (!approveModal) return
    const updated = await callApi(approveModal.id, 'approve', { role: approveRole })
    if (updated) toast.success(`${approveModal.full_name} approved as ${approveRole}`)
    setApprove(null)
  }

  async function changeRole() {
    if (!roleModal || selectedRole === roleModal.role) return
    const updated = await callApi(roleModal.id, 'change_role', { role: selectedRole })
    if (updated) toast.success(`${roleModal.full_name}'s role changed to ${selectedRole}`)
    setRoleModal(null)
  }

  return (
    <div className="min-h-screen bg-brand-50">
      <div className="bg-white border-b border-brand-100 px-4 sm:px-6 py-4">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-lg font-bold text-gray-900">User Management</h1>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-5 space-y-4">
        {/* Tabs */}
        <div className="flex gap-2 border-b border-gray-200 pb-1">
          {(['pending', 'active', 'deactivated'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
                tab === t
                  ? 'text-brand-600 border-b-2 border-brand-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
              <span className="ml-1.5 text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">
                {users.filter(u => u.status === t).length}
              </span>
            </button>
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-12 text-sm text-gray-400">No users in this category</div>
        )}

        <div className="grid gap-3">
          {filtered.map(u => (
            <Card key={u.id}>
              <div className="px-5 py-4 flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900">{u.full_name}</span>
                    <RoleBadge role={u.role} />
                    {u.id === currentUserId && (
                      <span className="text-xs text-gray-400">(you)</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">{u.email}</p>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* ── Pending: approve (admin only) ── */}
                  {u.status === 'pending' && isAdmin && (
                    <Button
                      size="sm"
                      onClick={() => { setApprove(u); setApproveRole('article') }}
                      disabled={!!working}
                    >
                      <UserCheck className="h-3.5 w-3.5" />
                      Approve
                    </Button>
                  )}

                  {/* ── Active: edit role + deactivate (not self) ── */}
                  {u.status === 'active' && u.id !== currentUserId && (
                    <>
                      {canEditRoles && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!!working}
                          onClick={() => openRoleModal(u)}
                          title="Change role"
                        >
                          <Shield className="h-3.5 w-3.5 text-blue-500" />
                        </Button>
                      )}
                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="ghost"
                          loading={working === u.id}
                          onClick={async () => {
                            const updated = await callApi(u.id, 'deactivate')
                            if (updated) toast.success('User deactivated')
                          }}
                        >
                          <UserX className="h-3.5 w-3.5 text-red-500" />
                        </Button>
                      )}
                    </>
                  )}

                  {/* ── Deactivated: reactivate (admin only) ── */}
                  {u.status === 'deactivated' && isAdmin && (
                    <Button
                      size="sm"
                      variant="secondary"
                      loading={working === u.id}
                      onClick={async () => {
                        const updated = await callApi(u.id, 'reactivate')
                        if (updated) toast.success('User reactivated')
                      }}
                    >
                      Reactivate
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* ── Approve modal ── */}
      <Modal open={!!approveModal} onClose={() => setApprove(null)} title="Approve User">
        {approveModal && (
          <div className="flex flex-col gap-4">
            <div className="bg-brand-50 rounded-xl px-4 py-3">
              <p className="font-medium text-gray-900">{approveModal.full_name}</p>
              <p className="text-xs text-gray-500">{approveModal.email}</p>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">Assign Role</label>
              <select
                value={approveRole}
                onChange={e => setApproveRole(e.target.value as UserRole)}
                className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {ALL_ROLES.map(r => (
                  <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setApprove(null)} className="flex-1">
                Cancel
              </Button>
              <Button onClick={approve} loading={!!working} className="flex-1">
                <UserCheck className="h-4 w-4" />
                Approve
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Change Role modal ── */}
      <Modal open={!!roleModal} onClose={() => setRoleModal(null)} title="Change Role">
        {roleModal && (
          <div className="flex flex-col gap-4">
            <div className="bg-brand-50 rounded-xl px-4 py-3">
              <p className="font-medium text-gray-900">{roleModal.full_name}</p>
              <p className="text-xs text-gray-500">{roleModal.email}</p>
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className="text-xs text-gray-400">Current role:</span>
                <RoleBadge role={roleModal.role} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm font-medium text-gray-700">New Role</label>
              <select
                value={selectedRole}
                onChange={e => setSelectedRole(e.target.value as UserRole)}
                className="w-full px-3 py-2.5 rounded-xl border border-gray-300 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
              >
                {editableRoles.map(r => (
                  <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => setRoleModal(null)} className="flex-1">
                Cancel
              </Button>
              <Button
                onClick={changeRole}
                loading={!!working}
                disabled={selectedRole === roleModal.role}
                className="flex-1"
              >
                <Shield className="h-4 w-4" />
                Change Role
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function RoleBadge({ role }: { role: UserRole }) {
  const map: Record<UserRole, { label: string; variant: 'info' | 'success' | 'danger' | 'default' }> = {
    article: { label: 'Article',  variant: 'default' },
    manager: { label: 'Manager',  variant: 'info' },
    partner: { label: 'Partner',  variant: 'success' },
    admin:   { label: 'Admin',    variant: 'danger' },
  }
  const { label, variant } = map[role]
  return <Badge variant={variant} className="text-xs">{label}</Badge>
}
