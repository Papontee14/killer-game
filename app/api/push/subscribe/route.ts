import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabaseWithAuth(token: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
}

export async function POST(req: Request) {
  try {
    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabaseWithAuth(token);
    if (!supabase) {
      return NextResponse.json(
        { error: 'Server misconfigured' },
        { status: 500 },
      );
    }

    const body = await req.json();
    const { code, subscription } = body;
    if (
      !code ||
      !subscription ||
      !subscription.endpoint ||
      !subscription.keys
    ) {
      return NextResponse.json(
        { error: 'Invalid subscription payload' },
        { status: 400 },
      );
    }

    const { error } = await supabase.rpc('register_push_subscription', {
      p_code: String(code).trim().toUpperCase(),
      p_endpoint: String(subscription.endpoint),
      p_p256dh: String(subscription.keys.p256dh || ''),
      p_auth: String(subscription.keys.auth || ''),
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
