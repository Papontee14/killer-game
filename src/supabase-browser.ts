import { createBrowserClient } from "@supabase/ssr";
import type { Session } from "@supabase/supabase-js";

export function getSupabaseBrowser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? createBrowserClient(url, key) : null;
}

let anonymousSessionPromise: Promise<Session | null> | null = null;
export async function ensureAnonymousSession(): Promise<Session | null> {
  if (anonymousSessionPromise) return anonymousSessionPromise;
  anonymousSessionPromise = ensureAnonymousSessionOnce();
  try { return await anonymousSessionPromise; } finally { anonymousSessionPromise = null; }
}

async function ensureAnonymousSessionOnce() {
  const supabase = getSupabaseBrowser();
  if (!supabase) return null;
  const current = await supabase.auth.getSession();
  if (current.error) throw current.error;
  if (current.data.session) return current.data.session;
  const signedIn = await supabase.auth.signInAnonymously();
  if (signedIn.error) throw signedIn.error;
  return signedIn.data.session;
}
