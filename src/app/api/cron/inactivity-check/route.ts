import { NextResponse } from 'next/server'

// This endpoint is deprecated.
// Cycle inactivity monitoring was removed in the simplified attendance model.
// The underlying check_cycle_inactivity() database function has been dropped.
export async function POST() {
  return NextResponse.json(
    { message: 'Cycle inactivity monitoring has been removed. This endpoint is no longer active.' },
    { status: 410 }
  )
}
