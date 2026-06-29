export type UserRole = 'article' | 'manager' | 'partner' | 'admin'
export type UserStatus = 'pending' | 'active' | 'deactivated'
// WorkType is now a flexible string — maintained in the work_types DB table.
// The union was removed to support admin-defined custom work types.
export type WorkType = string
export type AssignmentStatus = 'active' | 'archived'
export type CycleStatus = 'active' | 'closed'
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

export interface AssignmentCycle {
  id: string
  assignment_id: string
  status: CycleStatus
  started_at: string
  started_by: string
  ended_at: string | null
  ended_by: string | null
  notes: string | null
  created_at: string
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

export interface InactivityAlert {
  id: string
  cycle_id: string
  assignment_id: string
  last_activity_date: string
  days_inactive: number
  dismissed: boolean
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

// WORK_TYPES kept only for badge colour mapping in workTypeBadgeColor().
// The UI dropdown now fetches from the work_types DB table instead.
export const WORK_TYPES: string[] = [
  'Internal Audit',
  'Statutory Audit',
  'Tax Audit',
  'GST Compliance',
  'GST Litigation',
  'Income Tax Compliance',
  'Income Tax Litigation',
  'Others',
]

export const ELEVATED_ROLES: UserRole[] = ['admin', 'partner', 'manager']
