export type UserRole = 'article' | 'intern' | 'manager' | 'partner' | 'admin'
export type UserStatus = 'pending' | 'active' | 'deactivated'
// WorkType is now a flexible string — maintained in the work_types DB table.
// The union was removed to support admin-defined custom work types.
export type WorkType = string
export type AssignmentStatus = 'active' | 'inactive'
export type AttendanceType = 'regular' | 'others' | 'unallocated'

export interface Profile {
  id: string
  email: string
  full_name: string
  role: UserRole
  status: UserStatus
  approved_by: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
}

export interface Assignment {
  id: string
  client_name: string
  work_type: WorkType
  status: AssignmentStatus
  notes: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface AttendanceRecord {
  id: string
  article_id: string
  assignment_id: string | null
  cycle_id: string | null
  attendance_date: string
  checked_in_at: string | null
  checked_in_lat: number | null
  checked_in_lng: number | null
  checked_out_at: string | null
  checked_out_lat: number | null
  checked_out_lng: number | null
  note: string | null
  attendance_type: AttendanceType
  others_client_name: string | null
  flagged_for_review: boolean
  regularized: boolean
  created_at: string
}

export interface Client {
  id: string
  name: string
  created_at: string
}

export interface LeaveRecord {
  id:         string
  article_id: string
  leave_date: string
  note:       string | null
  created_at: string
}

export interface DashboardSummary {
  active_articles_today: number
  on_leave_today: number
  flagged_attendance: number
  open_checkins: number
}

export interface LiveActivityRow {
  article_id:      string
  article_name:    string
  assignment_id:   string | null
  client_name:     string | null
  work_type:       WorkType | null
  checked_in_at:   string
  duration_mins:   number         // DB snapshot — component recomputes client-side
  record_id:       string
  attendance_type: AttendanceType
}

export interface OnLeaveArticleRow {
  article_id:   string
  article_name: string
}

// Roles that behave exactly like Article: Attend page access, own-attendance
// permissions, and inclusion in every Article-scoped dashboard/report query.
export const ARTICLE_ROLES: UserRole[] = ['article', 'intern']

// Single source of truth for the "is this an Article-equivalent role" check —
// future roles that should behave like Article only need to be added to
// ARTICLE_ROLES above; every call site stays correct automatically.
export function isArticleRole(role: UserRole): boolean {
  return ARTICLE_ROLES.includes(role)
}
