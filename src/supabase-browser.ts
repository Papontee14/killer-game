import { createBrowserClient } from "@supabase/ssr";

export function getSupabaseBrowser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return url && key ? createBrowserClient(url, key) : null;
}

export async function ensureAnonymousSession() {
  const supabase = getSupabaseBrowser();
  if (!supabase) return null;
  const current = await supabase.auth.getSession();
  if (current.data.session) return current.data.session;
  const signedIn = await supabase.auth.signInAnonymously();
  return signedIn.data.session;
}
