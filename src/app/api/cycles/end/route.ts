import { NextResponse } from 'next/server'

// DEPRECATED: Cycle lifecycle was removed in the simplified attendance model.
// Historical cycle data is preserved in the assignment_cycles table (read-only).
export async function POST() {
  return NextResponse.json(
    { error: 'Cycle management has been removed. Attendance records link directly to assignments.' },
    { status: 410 }
  )
}
