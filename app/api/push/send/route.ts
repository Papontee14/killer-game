import { NextResponse } from 'next/server';

// An older cached browser may still call this URL. Database RPCs now enqueue
// notifications atomically, so this endpoint must never create a duplicate.
export async function POST() {
  return NextResponse.json({ queued: false, deprecated: true }, { status: 202 });
}
