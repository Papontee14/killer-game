import { ensureAnonymousSession, getSupabaseBrowser } from "./supabase-browser";
import type { Evidence, PrivatePlayerState, RoomState, Role, Team } from "./types";

/** Supabase is the authority. This adapter intentionally has no localStorage fallback. */
type Json = Record<string, unknown>;

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function roomCodeValue(value: unknown) {
  return textValue(value).toUpperCase();
}

function client() {
  const supabase = getSupabaseBrowser();
  if (!supabase) throw new Error("ยังไม่ได้ตั้งค่า Supabase");
  return supabase;
}

function asPrivateState(value: Json): PrivatePlayerState {
  const currentRole = String(value.currentRole ?? value.current_role) as Role;
  const initialRole = String(value.initialRole ?? value.initial_role ?? currentRole) as Role;
  const isActiveKiller = Boolean(value.isActiveKiller ?? value.is_active_killer);
  return {
    playerId: String(value.playerId ?? value.player_id), initialRole, currentRole,
    team: String(value.team ?? (isActiveKiller ? "killers" : "city")) as Team,
    isActiveKiller, hearts: Number(value.hearts ?? 0),
    maxHearts: Number(value.maxHearts ?? value.max_hearts ?? 0),
    hasUsedAbility: Boolean(value.hasUsedAbility ?? value.has_used_ability),
  };
}

function asRoom(value: unknown): RoomState {
  const data = value as Json;
  const players = (data.players as Array<Json> | undefined) ?? [];
  const secrets = (data.privateStates ?? data.private_states ?? {}) as Record<string, Json>;
  const evidences = ((data.evidences ?? data.evidence ?? []) as Array<Json>).map((item) => ({
    id: String(item.id), killerId: String(item.killerId ?? item.killer_id), targetId: String(item.targetId ?? item.target_id),
    storagePath: String(item.storagePath ?? item.storage_path ?? ""), imageData: typeof item.imageData === "string" ? item.imageData : undefined,
    capturedAt: String(item.capturedAt ?? item.captured_at ?? item.createdAt ?? item.created_at), createdAt: String(item.createdAt ?? item.created_at),
    status: item.status as Evidence["status"], decisionAt: item.decisionAt ? String(item.decisionAt) : item.decision_at ? String(item.decision_at) : undefined,
  }));
  return {
    viewerRole: ((data.viewerRole ?? data.viewer_role) === "host" ? "host" : "player"),
    code: String(data.code), hostName: String(data.hostName ?? data.host_name ?? "Host"), phase: data.phase as RoomState["phase"],
    createdAt: String(data.createdAt ?? data.created_at), attackLimit: Number(data.attackLimit ?? data.attack_limit ?? 2),
    attacksThisHour: Number(data.attacksThisHour ?? data.approvedAttacksInWindow ?? data.approved_attacks_in_window ?? 0),
    quotaWindowStart: String(data.quotaWindowStart ?? data.quota_window_start ?? new Date().toISOString()),
    policeCheckAt: data.policeCheckAt ? String(data.policeCheckAt) : data.police_check_at ? String(data.police_check_at) : undefined,
    players: players.map((player) => ({ id: String(player.id), name: String(player.name), joinedAt: String(player.joinedAt ?? player.joined_at),
      isOnline: Boolean(player.isOnline ?? player.is_online), health: player.health as RoomState["players"][number]["health"],
      heartsVisibleToHost: Number(player.heartsVisibleToHost ?? player.hearts_visible_to_host ?? 0), maxHearts: Number(player.maxHearts ?? player.max_hearts ?? 0) })),
    privateStates: Object.fromEntries(Object.entries(secrets).map(([id, secret]) => [id, asPrivateState(secret)])), evidences,
    events: ((data.events ?? []) as Array<Json>).map((event) => ({ id: String(event.id), type: event.type as RoomState["events"][number]["type"], message: String(event.message),
      createdAt: String(event.createdAt ?? event.created_at), playerId: event.playerId ? String(event.playerId) : event.visibleToPlayerId ? String(event.visibleToPlayerId) : undefined })),
    winner: (data.winner ?? null) as RoomState["winner"], bombTargets: ((data.bombTargets ?? data.bomb_targets ?? []) as unknown[]).map(String),
    pendingBomberId: data.pendingBomberId ? String(data.pendingBomberId) : data.pending_bomber_id ? String(data.pending_bomber_id) : undefined,
  };
}

async function rpcView(code: string) {
  const normalizedCode = roomCodeValue(code);
  if (!normalizedCode) throw new Error("ไม่พบรหัสห้อง");
  await ensureAnonymousSession();
  const { data, error } = await client().rpc("get_room_view", { p_code: normalizedCode });
  if (error) throw error;
  if (!data) return null;
  const room = asRoom(data);
  if ((data as Json).viewerRole === "host" || (data as Json).viewer_role === "host") {
    const supabase = client();
    await Promise.all(room.evidences.map(async (evidence) => {
      if (!evidence.storagePath) return;
      const signed = await supabase.storage.from("evidence").createSignedUrl(evidence.storagePath, 300);
      if (!signed.error && signed.data?.signedUrl) evidence.imageData = signed.data.signedUrl;
    }));
  }
  return room;
}

export async function loadRoom(code: string) { return rpcView(code); }

export async function createOrLoadRoom(code: string, hostName: string) {
  const normalizedCode = roomCodeValue(code);
  const normalizedHostName = textValue(hostName) || "Host";
  if (!normalizedCode) throw new Error("ไม่พบรหัสห้อง");
  await ensureAnonymousSession();
  const { data, error } = await client().rpc("create_room", { p_code: normalizedCode, p_host_name: normalizedHostName });
  if (error) {
    const existing = await rpcView(normalizedCode);
    if (existing) return existing;
    throw error;
  }
  return asRoom(data);
}

export async function joinOrCreateDemo(code: string, name: string, reclaimToken?: string) {
  const normalizedCode = roomCodeValue(code);
  const normalizedName = textValue(name);
  if (!normalizedCode) throw new Error("ไม่พบรหัสห้อง");
  if (!normalizedName) throw new Error("กรุณาระบุชื่อผู้เล่น");
  await ensureAnonymousSession();
  const { data, error } = await client().rpc("join_room", {
    p_code: normalizedCode,
    p_name: normalizedName,
    p_reclaim_token: textValue(reclaimToken) || null,
  });
  if (error) throw error;
  const room = asRoom(data);
  const requested = String((data as Json).playerId ?? (data as Json).player_id ?? "");
  const player = room.players.find((item) => item.id === requested) ?? room.players.find((item) => item.name.toLowerCase() === normalizedName.toLowerCase());
  if (!player) throw new Error("เข้าห้องไม่สำเร็จ");
  return {
    room,
    playerId: player.id,
    reclaimToken: textValue((data as Json).reclaimToken ?? (data as Json).reclaim_token) || undefined,
  };
}

async function mutate(code: string, fn: string, args: Json = {}) {
  const normalizedCode = roomCodeValue(code);
  if (!normalizedCode) throw new Error("ไม่พบรหัสห้อง");
  await ensureAnonymousSession();
  const { error } = await client().rpc(fn, { p_code: normalizedCode, ...args });
  if (error) throw error;
  const room = await rpcView(code);
  if (!room) throw new Error("ไม่พบห้องนี้");
  return room;
}

export function startGame(code: string, roleCounts: Partial<Record<Role, number>>) { return mutate(code, "start_game", { p_role_counts: roleCounts }); }
export function approveEvidence(code: string, evidenceId: string) { return mutate(code, "approve_evidence", { p_evidence_id: evidenceId }); }
export function rejectEvidence(code: string, evidenceId: string) { return mutate(code, "reject_evidence", { p_evidence_id: evidenceId }); }
export function resolveBomb(code: string, targetIds: string[]) { return mutate(code, "resolve_bomb", { p_target_ids: targetIds }); }
export function resolvePoliceCheck(code: string, targetId: string) { return mutate(code, "resolve_police_check", { p_target_id: targetId }); }
export function reporterAbility(code: string, targetId: string) { return mutate(code, "use_reporter", { p_target_id: targetId }); }
export function setAccusationAt(code: string, accusationAt: string) { return mutate(code, "set_accusation_at", { p_at: accusationAt }); }
export async function heartbeat(code: string) {
  const normalizedCode = roomCodeValue(code);
  if (!normalizedCode) return;
  await ensureAnonymousSession();
  const { error } = await client().rpc("heartbeat", { p_code: normalizedCode });
  if (error) throw error;
}

function dataUrlToBlob(dataUrl: string) {
  const match = dataUrl.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
  if (!match) throw new Error("รูปหลักฐานไม่ถูกต้อง");
  const bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
  return new Blob([bytes], { type: match[1] });
}

export async function submitEvidence(code: string, targetId: string, imageData: string, capturedAt: string) {
  await ensureAnonymousSession();
  const supabase = client();
  const session = await supabase.auth.getSession();
  const userId = session.data.session?.user.id;
  if (!userId) throw new Error("เซสชันหมดอายุ กรุณาเข้าใหม่");
  const storagePath = `${userId}/${crypto.randomUUID()}.jpg`;
  const uploaded = await supabase.storage.from("evidence").upload(storagePath, dataUrlToBlob(imageData), { contentType: "image/jpeg", upsert: false });
  if (uploaded.error) throw uploaded.error;
  const { error } = await supabase.rpc("submit_evidence", { p_code: roomCodeValue(code), p_target_id: targetId, p_storage_path: storagePath, p_captured_at: capturedAt });
  if (error) { await supabase.storage.from("evidence").remove([storagePath]); throw error; }
  const room = await rpcView(code);
  if (!room) throw new Error("ไม่พบห้องนี้");
  return room;
}

export async function closeRoom(code: string) {
  const existing = await rpcView(code);
  if (existing) {
    const paths = existing.evidences.map((evidence) => evidence.storagePath).filter(Boolean);
    if (paths.length) {
      const removed = await client().storage.from("evidence").remove(paths);
      if (removed.error) throw removed.error;
    }
  }
  return mutate(code, "close_room");
}
export const deleteRoom = closeRoom;
