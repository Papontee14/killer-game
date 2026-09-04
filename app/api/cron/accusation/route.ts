import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

function validSecret(value: string | null, expected: string) {
  if (!value || value.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= value.charCodeAt(index) ^ expected.charCodeAt(index);
  return mismatch === 0;
}

async function run(request: Request) {
  const expected = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? request.headers.get("x-cron-secret");
  if (!expected || !validSecret(supplied, expected)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return NextResponse.json({ error: "server is not configured" }, { status: 503 });
  const supabase = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await supabase.rpc("start_due_accusations");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ transitioned: data ?? 0 });
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }
