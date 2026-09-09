import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/** Optional scheduler endpoint when pg_cron is unavailable; never client-driven. */
export async function POST(request: Request) {
  const secret = process.env.GAME_TICK_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    return NextResponse.json(
      { error: "Scheduler unavailable" },
      { status: 503 },
    );
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { error } = await client.rpc("advance_v24_schedule");
  if (error)
    return NextResponse.json(
      { error: "Clock evaluation failed" },
      { status: 503 },
    );
  return NextResponse.json({ ok: true });
}
