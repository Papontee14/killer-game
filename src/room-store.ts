import { ensureAnonymousSession, getSupabaseBrowser } from "./supabase-browser";
import type {
  AttackActivity,
  Evidence,
  EndGameResult,
  EndGameTimelineEntry,
  KillerEvidenceProgress,
  PrivatePlayerState,
  RoomState,
  Role,
  Team,
} from "./types";

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
  const initialRole = String(
    value.initialRole ?? value.initial_role ?? currentRole,
  ) as Role;
  const isActiveKiller = Boolean(
    value.isActiveKiller ?? value.is_active_killer,
  );
  return {
    playerId: String(value.playerId ?? value.player_id),
    protectionUntil: value.protectionUntil ? String(value.protectionUntil) : undefined,
    doctorUses: Number(value.doctorUses ?? 0),
    doctorReadyAt: value.doctorReadyAt ? String(value.doctorReadyAt) : undefined,
    badgeRevealed: Boolean(value.badgeRevealed),
    initialRole,
    currentRole: isActiveKiller ? "killer" : currentRole,
    team: String(value.team ?? (isActiveKiller ? "killers" : "city")) as Team,
    isActiveKiller,
    hearts: Number(value.hearts ?? 0),
    maxHearts: Number(value.maxHearts ?? value.max_hearts ?? 0),
    hasUsedAbility: Boolean(value.hasUsedAbility ?? value.has_used_ability),
  };
}

function asRoom(value: unknown): RoomState {
  const data = value as Json;
  const players = (data.players as Array<Json> | undefined) ?? [];
  // Some deployed SQL projections concatenate JSON null with {}, producing
  // [null, {}] before roles are assigned. Lobby views have no private roles.
  const rawSecrets = data.privateStates ?? data.private_states;
  const secrets = data.phase !== "lobby" && rawSecrets &&
    typeof rawSecrets === "object" && !Array.isArray(rawSecrets)
    ? rawSecrets as Record<string, Json>
    : {};
  const evidences = (
    (data.evidences ?? data.evidence ?? []) as Array<Json>
  ).map((item) => ({
    id: String(item.id),
    killerId: String(item.killerId ?? item.killer_id),
    targetId: String(item.targetId ?? item.target_id),
    storagePath: String(item.storagePath ?? item.storage_path ?? ""),
    imageData: typeof item.imageData === "string" ? item.imageData : undefined,
    capturedAt: String(
      item.capturedAt ?? item.captured_at ?? item.createdAt ?? item.created_at,
    ),
    createdAt: String(item.createdAt ?? item.created_at),
    status: item.status as Evidence["status"],
    decisionAt: item.decisionAt
      ? String(item.decisionAt)
      : item.decision_at
        ? String(item.decision_at)
        : undefined,
  }));
  return {
    viewerRole:
      (data.viewerRole ?? data.viewer_role) === "host" ? "host" : "player",
    rulesVersion: data.rulesVersion === "2.4" ? "2.4" : "legacy",
    v24: data.v24 as RoomState["v24"],
    playerId: data.playerId ? String(data.playerId) : undefined,
    code: String(data.code),
    hostName: String(data.hostName ?? data.host_name ?? "Host"),
    phase: data.phase as RoomState["phase"],
    createdAt: String(data.createdAt ?? data.created_at),
    closedAt:
      data.closedAt || data.closed_at
        ? String(data.closedAt ?? data.closed_at)
        : undefined,
    killLimit: Number(data.killLimit ?? data.kill_limit ?? data.attackLimit ?? data.attack_limit ?? 2),
    killsThisHour: Number(
      data.killsThisHour ??
        data.kills_in_window ??
        data.attacksThisHour ??
        data.approvedAttacksInWindow ??
        data.approved_attacks_in_window ??
        0,
    ),
    quotaWindowStart: String(
      data.quotaWindowStart ??
        data.quota_window_start ??
        new Date().toISOString(),
    ),
    policeCheckAt: data.policeCheckAt
      ? String(data.policeCheckAt)
      : data.police_check_at
        ? String(data.police_check_at)
        : undefined,
    players: players.map((player) => ({
      id: String(player.id),
      name: String(player.name),
      avatarId:
        player.avatarId ?? player.avatar_id
          ? String(player.avatarId ?? player.avatar_id)
          : null,
      joinedAt: String(player.joinedAt ?? player.joined_at),
      isOnline: Boolean(player.isOnline ?? player.is_online),
      health: player.health as RoomState["players"][number]["health"],
      heartsVisibleToHost: Number(
        player.heartsVisibleToHost ?? player.hearts_visible_to_host ?? 0,
      ),
      maxHearts: Number(player.maxHearts ?? player.max_hearts ?? 0),
    })),
    privateStates: Object.fromEntries(
      Object.entries(secrets).filter(([, secret]) =>
        secret && typeof secret === "object" && !Array.isArray(secret),
      ).map(([id, secret]) => [
        id,
        asPrivateState(secret),
      ]),
    ),
    evidences,
    canViewAttackActivity: Boolean(data.canViewAttackActivity ?? data.can_view_attack_activity),
    attackActivityHidden: Boolean(data.attackActivityHidden ?? data.attack_activity_hidden),
    attackActivity: ((data.attackActivity ?? data.attack_activity ?? []) as Array<Json>).map((item) => ({
      id: String(item.id),
      killerId: String(item.killerId ?? item.killer_id),
      targetId: String(item.targetId ?? item.target_id),
      storagePath: String(item.storagePath ?? item.storage_path ?? ""),
      capturedAt: String(item.capturedAt ?? item.captured_at),
      decisionAt: item.decisionAt ?? item.decision_at ? String(item.decisionAt ?? item.decision_at) : undefined,
      result: (item.result ?? item.attackResult ?? item.attack_result ?? null) as AttackActivity["result"],
    })),
    killerEvidenceProgress: (
      (data.killerEvidenceProgress ?? []) as Array<Json>
    ).map((item) => ({
      id: String(item.id),
      killerId: String(item.killerId),
      targetId: String(item.targetId),
      capturedAt: String(item.capturedAt),
      createdAt: String(item.createdAt),
      status: item.status as Evidence["status"],
      decisionAt: item.decisionAt ? String(item.decisionAt) : undefined,
      result: (item.result ?? null) as KillerEvidenceProgress["result"],
    })),
    events: ((data.events ?? []) as Array<Json>).map((event) => ({
      id: String(event.id),
      type: event.type as RoomState["events"][number]["type"],
      message: String(event.message),
      createdAt: String(event.createdAt ?? event.created_at),
      playerId: event.playerId
        ? String(event.playerId)
        : event.visibleToPlayerId
          ? String(event.visibleToPlayerId)
          : undefined,
    })),
    winner: (data.winner ?? null) as RoomState["winner"],
    endGameResult: data.phase === "ended" && (data.endGameResult ?? data.end_game_result)
      ? (() => {
          const result = (data.endGameResult ?? data.end_game_result) as Json;
          const affected = Array.isArray(result.affectedPlayerIds)
            ? result.affectedPlayerIds
            : Array.isArray(result.affected_player_ids)
              ? result.affected_player_ids
              : [];
          return {
            reason: String(result.reason) as EndGameResult["reason"],
            occurredAt: String(result.occurredAt ?? result.occurred_at ?? new Date().toISOString()),
            actorPlayerId: result.actorPlayerId
              ? String(result.actorPlayerId)
              : result.actor_player_id
                ? String(result.actor_player_id)
                : null,
            targetPlayerId: result.targetPlayerId
              ? String(result.targetPlayerId)
              : result.target_player_id
                ? String(result.target_player_id)
                : null,
            affectedPlayerIds: affected.map(String),
          };
        })()
      : undefined,
    endGameTimeline: data.phase === "ended"
      ? ((data.endGameTimeline ?? data.end_game_timeline ?? []) as Array<Json>).map((item) => ({
          kind: String(item.kind) as EndGameTimelineEntry["kind"],
          occurredAt: String(item.occurredAt ?? item.occurred_at),
          actorPlayerId: item.actorPlayerId ?? item.actor_player_id
            ? String(item.actorPlayerId ?? item.actor_player_id)
            : null,
          targetPlayerId: item.targetPlayerId ?? item.target_player_id
            ? String(item.targetPlayerId ?? item.target_player_id)
            : null,
        }))
      : [],
    endGameSummary: data.phase === "ended"
      ? ((data.endGameSummary ?? []) as Array<Json>).map((item) => ({
          playerId: String(item.playerId),
          initialRole: (item.initialRole ?? null) as Role | null,
          currentRole: (item.currentRole ?? null) as Role | null,
          team: (item.team ?? null) as Team | null,
        }))
      : [],
    bombTargets: (
      (data.bombTargets ?? data.bomb_targets ?? []) as unknown[]
    ).map(String),
    pendingBomberId: data.pendingBomberId
      ? String(data.pendingBomberId)
      : data.pending_bomber_id
        ? String(data.pending_bomber_id)
        : undefined,
  };
}

async function rpcView(code: string) {
  const normalizedCode = roomCodeValue(code);
  if (!normalizedCode) throw new Error("ไม่พบรหัสห้อง");
  await ensureAnonymousSession();
  const { data, error } = await client().rpc("get_room_view", {
    p_code: normalizedCode,
  });
  if (error) throw error;
  if (!data) return null;
  const room = asRoom(data);
  if (room.phase === "ended" && room.players.some(
    (player) => !room.endGameSummary.some((entry) => entry.playerId === player.id),
  )) {
    // Older RPCs still return the result screen but omit the public role reveal.
    // Keep that screen usable on network failure; normal polling retries this.
    try {
      const { data: session } = await client().auth.getSession();
      const token = session.session?.access_token;
      if (token) {
        const response = await fetch("/api/room/summary", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ code: normalizedCode }),
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });
        if (response.ok) {
          const summary = await response.json();
          room.endGameSummary = asRoom({ ...data, endGameSummary: summary.endGameSummary }).endGameSummary;
        }
      }
    } catch { /* Retry on the next room refresh. */ }
  }
  if (
    (data as Json).viewerRole === "host" ||
    (data as Json).viewer_role === "host"
  ) {
    const supabase = client();
    await Promise.all(
      room.evidences.map(async (evidence) => {
        if (!evidence.storagePath) return;
        const signed = await supabase.storage
          .from("evidence")
          .createSignedUrl(evidence.storagePath, 300);
        if (!signed.error && signed.data?.signedUrl)
          evidence.imageData = signed.data.signedUrl;
      }),
    );
  }
  return room;
}

/** Storage independently verifies that this viewer may see the attack image. */
export async function loadAttackActivityImage(storagePath: string) {
  const { data, error } = await client().storage
    .from("evidence")
    .createSignedUrl(storagePath, 300);
  if (error || !data?.signedUrl)
    throw error ?? new Error("โหลดรูปหลักฐานไม่สำเร็จ");
  return data.signedUrl;
}

export async function loadRoom(code: string) {
  return rpcView(code);
}

export async function createOrLoadRoom(code: string, hostName: string) {
  const normalizedCode = roomCodeValue(code);
  const normalizedHostName = textValue(hostName) || "Host";
  if (!normalizedCode) throw new Error("ไม่พบรหัสห้อง");
  await ensureAnonymousSession();
  const { data, error } = await client().rpc("create_room", {
    p_code: normalizedCode,
    p_host_name: normalizedHostName,
  });
  if (error) {
    const existing = await rpcView(normalizedCode);
    if (existing) return existing;
    throw error;
  }
  return asRoom(data);
}

export async function joinOrCreateDemo(
  code: string,
  name: string,
) {
  const normalizedCode = roomCodeValue(code);
  const normalizedName = textValue(name);
  if (!normalizedCode) throw new Error("ไม่พบรหัสห้อง");
  if (!normalizedName) throw new Error("กรุณาระบุชื่อผู้เล่น");
  await ensureAnonymousSession();
  let data: unknown;
  try {
    const result = await client().rpc("join_room", {
      p_code: normalizedCode,
      p_name: normalizedName,
    });
    if (result.error) throw result.error;
    data = result.data;
  } catch (error) {
    // The write may have committed before the connection lost its response.
    // Recover only the authenticated viewer, never another player's name.
    const existing = await rpcView(normalizedCode).catch(() => null);
    const player = existing?.players.find((item) => item.id === existing.playerId);
    if (existing?.viewerRole === "player" && player &&
        player.name.toLowerCase() === normalizedName.toLowerCase()) {
      return { room: existing, playerId: player.id };
    }
    throw error;
  }
  const room = asRoom(data);
  const requested = String(
    (data as Json).playerId ?? (data as Json).player_id ?? "",
  );
  const player =
    room.players.find((item) => item.id === requested) ??
    room.players.find(
      (item) => item.name.toLowerCase() === normalizedName.toLowerCase(),
    );
  if (!player) throw new Error("เข้าห้องไม่สำเร็จ");
  return {
    room,
    playerId: player.id,
  };
}

async function mutate(code: string, fn: string, args: Json = {}) {
  const normalizedCode = roomCodeValue(code);
  if (!normalizedCode) throw new Error("ไม่พบรหัสห้อง");
  await ensureAnonymousSession();
  const { data, error } = await client().rpc(fn, {
    p_code: normalizedCode,
    ...args,
  });
  if (error) throw error;
  if (data?.actionError)
    throw new Error(data.actionError === "game_ended" ? "เกมจบแล้ว ไม่สามารถใช้ action เพิ่มได้" : "ถึงเวลาตำรวจชี้ตัวแล้ว ไม่สามารถโจมตีได้");
  const room = await rpcView(code);
  if (!room) throw new Error("ไม่พบห้องนี้");
  return room;
}

export function startGame(
  code: string,
  roleCounts: Partial<Record<Role, number>>,
) {
  return mutate(code, "start_game", { p_role_counts: roleCounts });
}
export function approveEvidence(code: string, evidenceId: string) {
  return mutate(code, "approve_evidence", { p_evidence_id: evidenceId });
}
export function rejectEvidence(code: string, evidenceId: string) {
  return mutate(code, "reject_evidence", { p_evidence_id: evidenceId });
}
export function resolveBomb(code: string, targetIds: string[]) {
  return mutate(code, "resolve_bomb", { p_target_ids: targetIds });
}
export function resolvePoliceCheck(code: string, targetId: string) {
  return mutate(code, "resolve_police_check", { p_target_id: targetId });
}
export function reporterAbility(code: string, targetId: string) {
  return mutate(code, "use_reporter", { p_target_id: targetId });
}
export function configureV24(code: string, durationMinutes: number) {
  return mutate(code, "configure_v24", { p_duration_minutes: durationMinutes });
}
export function doctorAbility(code: string, targetId: string) { return mutate(code, "use_doctor", { p_target_id: targetId }); }
export function revealPolice(code: string) { return mutate(code, "reveal_police"); }
export function resolveV24Action(code: string, actionId: string) { return mutate(code, "v24_apply", { p_action_id: actionId, p_approve: true }); }
export function submitFinalBallot(code: string, nominees: string[], ranking: string[]) { return mutate(code, "submit_final_ballot", { p_nominees: nominees, p_ranking: ranking }); }
export function resolveFinal(code: string) { return mutate(code, "resolve_final"); }
export function recordV24Warning(code: string, message: string) { return mutate(code, "record_v24_warning", { p_message: message }); }
export function setAccusationAt(code: string, accusationAt: string) {
  return mutate(code, "set_accusation_at", { p_at: accusationAt });
}
export function endGame(code: string) {
  return mutate(code, "end_game");
}
export async function heartbeat(code: string) {
  const normalizedCode = roomCodeValue(code);
  if (!normalizedCode) return;
  await ensureAnonymousSession();
  const { error } = await client().rpc("heartbeat", { p_code: normalizedCode });
  if (error) throw error;
}

function imageExtension(image: Blob) {
  const subtype = image.type.toLowerCase().split("/")[1];
  const extensions: Record<string, string> = {
    jpeg: "jpg",
    jpg: "jpg",
    png: "png",
    webp: "webp",
    gif: "gif",
    heic: "heic",
    heif: "heif",
  };
  return extensions[subtype] ?? "img";
}

export async function submitEvidence(
  code: string,
  targetId: string,
  image: File | Blob,
  capturedAt: string,
) {
  if (
    !targetId ||
    !capturedAt ||
    !image.type.startsWith("image/") ||
    image.size <= 0
  )
    throw new Error("กรุณาถ่ายรูปหลักฐานก่อนส่ง");
  const captureAge = Date.now() - Date.parse(capturedAt);
  if (!Number.isFinite(captureAge) || captureAge < 0 || captureAge > 120000)
    throw new Error("รูปเกิน 2 นาทีแล้ว กรุณาถ่ายใหม่");
  await ensureAnonymousSession();
  const supabase = client();
  const session = await supabase.auth.getSession();
  const userId = session.data.session?.user.id;
  if (!userId) throw new Error("เซสชันหมดอายุ กรุณาเข้าใหม่");
  const current = await rpcView(code);
  if (!current) throw new Error("ไม่พบห้องนี้");
  const storagePath = `${userId}/${crypto.randomUUID()}.${imageExtension(image)}`;
  const uploaded = await supabase.storage
    .from("evidence")
    .upload(storagePath, image, { contentType: image.type, upsert: false });
  if (uploaded.error) throw uploaded.error;
  const { data, error } = await supabase.rpc("submit_evidence", {
    p_code: roomCodeValue(code),
    p_target_id: targetId,
    p_storage_path: storagePath,
    p_captured_at: capturedAt,
  });
  if (error || data?.actionError) {
    await supabase.storage.from("evidence").remove([storagePath]);
    throw error || new Error(data?.actionError === "game_ended" ? "เกมจบแล้ว ไม่สามารถโจมตีได้" : "ถึงเวลาตำรวจชี้ตัวแล้ว ไม่สามารถโจมตีได้");
  }
  const room = await rpcView(code);
  if (!room) throw new Error("ไม่พบห้องนี้");
  return room;
}
export function selectAvatar(code: string, avatarId: string) {
  return mutate(code, "select_avatar", { p_avatar_id: avatarId });
}
export function removeLobbyPlayer(code: string, playerId: string) {
  return mutate(code, "remove_lobby_player", { p_player_id: playerId });
}

export async function closeRoom(code: string) {
  const existing = await rpcView(code);
  if (existing) {
    const paths = existing.evidences
      .map((evidence) => evidence.storagePath)
      .filter(Boolean);
    if (paths.length) {
      const removed = await client().storage.from("evidence").remove(paths);
      if (removed.error) throw removed.error;
    }
  }
  return mutate(code, "close_room");
}
export const deleteRoom = closeRoom;
