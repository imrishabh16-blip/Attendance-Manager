// Per-session attendance status — the single definition shared by the
// Attendance Report export and Article Analytics so the two can never
// disagree. Moved verbatim from api/export/attendance/route.ts.
//
// attendanceTypeLabel is attendance_records.attendance_type; durationHours is
// get_attendance_export's duration_hours (null while the session is open).
export function computeStatus(attendanceTypeLabel: string, durationHours: number | null): string {
  if (attendanceTypeLabel === 'others' || attendanceTypeLabel === 'unallocated') {
    return 'Unallocated'
  }
  if (durationHours !== null && durationHours < 4) {
    return 'Half Day'
  }
  return 'Completed'
}

// Mirrors get_attendance_export's duration_hours: hours between check-in and
// check-out rounded to 2 decimals, null unless the session is closed.
export function sessionDurationHours(checkedInAt: string | null, checkedOutAt: string | null): number | null {
  if (!checkedInAt || !checkedOutAt) return null
  const hours = (new Date(checkedOutAt).getTime() - new Date(checkedInAt).getTime()) / 3_600_000
  return Math.round(hours * 100) / 100
}
