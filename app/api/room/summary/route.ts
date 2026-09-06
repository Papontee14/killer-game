import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// Compatibility with databases whose get_room_view predates endGameSummary.
// Never let a caller's claimed phase or player list authorize a reveal.
export async function POST(request: Request) {
  const reply = (body: unknown, status = 200) =>
    NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return reply({ error: "Unauthorized" }, 401);
  try {
    const { code } = await request.json();
    if (typeof code !== "string" || !/^[A-Z0-9]{6}$/.test(code))
      return reply({ error: "Invalid room code" }, 400);
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !anonKey || !serviceKey)
      return reply({ error: "Summary unavailable" }, 503);
    const viewer = createClient(url, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    // The authenticated RPC checks both room membership and the current phase.
    const { data: room, error } = await viewer.rpc("get_room_view", { p_code: code });
    if (error || !room) return reply({ error: "Forbidden" }, 403);
    if (room.phase !== "ended") return reply({ error: "Game has not ended" }, 409);
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: players, error: queryError } = await admin.from("players")
      .select("id, player_secrets(initial_role, role_current, team), rooms!inner(code, phase)")
      .eq("rooms.code", code).eq("rooms.phase", "ended");
    if (queryError) return reply({ error: "Summary unavailable" }, 503);
    return reply({ endGameSummary: (players ?? []).map((player) => {
      const secret = Array.isArray(player.player_secrets)
        ? player.player_secrets[0] : player.player_secrets;
      return {
        playerId: player.id,
        initialRole: secret?.initial_role ?? null,
        currentRole: secret?.role_current ?? null,
        team: secret?.team ?? null,
      };
    }) });
  } catch {
    return reply({ error: "Summary unavailable" }, 503);
  }
}
