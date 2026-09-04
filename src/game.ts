import { DEFAULT_ROLE_COUNTS, healthState, ROLE_HEARTS, type Player, type Role, type RoomEvent, type RoomState, type WinningTeam } from "./types";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const makeId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
export function makeRoomCode() { return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join(""); }
const now = () => new Date().toISOString();
const event = (message: string, type: RoomEvent["type"] = "system", playerId?: string): RoomEvent => ({ id: makeId(), message, type, createdAt: now(), playerId });

export function createRoom(hostName: string, hostPin: string, playerPin: string, code = makeRoomCode()): RoomState {
  return { code, hostName, hostPin, playerPin, phase: "lobby", createdAt: now(), attackLimit: 2, attacksThisHour: 0, attackHour: new Date().getHours(), players: [], privateStates: {}, evidences: [], events: [event("ห้องถูกสร้างแล้ว รอผู้เล่นเข้าร่วม")], winner: null, bombTargets: [] };
}

export function rolePool(counts: Partial<Record<Role, number>> = {}) {
  const merged = { ...DEFAULT_ROLE_COUNTS, ...counts };
  return (Object.keys(merged) as Role[]).flatMap((role) => Array.from({ length: Math.max(0, merged[role] || 0) }, () => role));
}

export function addPlayer(room: RoomState, name: string, id = makeId()): RoomState {
  if (room.phase !== "lobby") throw new Error("เกมเริ่มแล้วหรือจบลงแล้ว ไม่สามารถเข้าร่วมได้");
  if (room.players.some((player) => player.name.toLowerCase() === name.trim().toLowerCase())) throw new Error("ชื่อนี้อยู่ในห้องแล้ว");
  const player: Player = { id, name: name.trim(), joinedAt: now(), isOnline: true, health: "alive", heartsVisibleToHost: 0, maxHearts: 2 };
  return { ...room, players: [...room.players, player], events: [event(`${player.name} เข้าร่วมเกม`), ...room.events] };
}

export function startGame(room: RoomState, counts?: Partial<Record<Role, number>>): RoomState {
  const roles = rolePool(counts);
  if (room.players.length !== roles.length) throw new Error(`ต้องมีผู้เล่น ${roles.length} คนก่อนเริ่มเกม`);
  const shuffled = [...roles].sort(() => Math.random() - 0.5);
  const privateStates = Object.fromEntries(room.players.map((player, index) => {
    const role = shuffled[index];
    const maxHearts = ROLE_HEARTS[role];
    return [player.id, { playerId: player.id, role, hearts: maxHearts, maxHearts, hasUsedAbility: false, isKillerSide: role === "killer" || role === "killer-wife" }];
  }));
  const players = room.players.map((player) => ({ ...player, maxHearts: privateStates[player.id].maxHearts, heartsVisibleToHost: privateStates[player.id].hearts }));
  return { ...room, phase: "active", privateStates, players, events: [event("เกมเริ่มแล้ว บทบาทถูกแจกเรียบร้อย"), ...room.events] };
}

export function approveEvidence(room: RoomState, evidenceId: string): RoomState {
  const evidence = room.evidences.find((item) => item.id === evidenceId);
  if (!evidence || evidence.status !== "pending") return room;
  const currentHour = new Date().getHours();
  const reset = room.attackHour !== currentHour;
  const attacksThisHour = reset ? 0 : room.attacksThisHour;
  if (attacksThisHour >= room.attackLimit) return { ...room, evidences: room.evidences.map((item) => item.id === evidenceId ? { ...item, status: "rejected", decisionAt: now() } : item), events: [event("โควต้าการโจมตีชั่วโมงนี้เต็มแล้ว", "warning"), ...room.events] };
  const targetState = room.privateStates[evidence.targetId];
  if (!targetState || targetState.hearts <= 0) return room;
  const hearts = targetState.hearts - 1;
  const updatedPrivate = { ...room.privateStates, [evidence.targetId]: { ...targetState, hearts } };
  const players = room.players.map((player) => player.id === evidence.targetId ? { ...player, health: healthState(hearts, player.maxHearts), heartsVisibleToHost: hearts } : player);
  const targetName = room.players.find((player) => player.id === evidence.targetId)?.name || "ผู้เล่น";
  const killerState = room.privateStates[evidence.killerId];
  const updatedEvidence = room.evidences.map((item) => item.id === evidenceId ? { ...item, status: "approved" as const, decisionAt: now() } : item);
  let events = [event("มีการโจมตีเกิดขึ้น", "attack", evidence.targetId), ...room.events];
  let phase = room.phase;
  let winner = room.winner;
  let attackLimit = room.attackLimit;
  if (hearts <= 0) {
    events = [event(`${targetName} ถูกกำจัด`, "warning", evidence.targetId), ...events];
    if (targetState.role === "killer-wife") {
      const killerIds = Object.values(updatedPrivate).filter((state) => state.role === "killer" || state.role === "killer-wife").map((state) => state.playerId);
      events = [event("เมีย Killer ถูกกำจัด — ตอนนี้มี Killer เพิ่มเป็น 2 คน", "ability"), ...events];
      killerIds.forEach((id) => { updatedPrivate[id] = { ...updatedPrivate[id], role: "killer", isKillerSide: true }; });
      attackLimit = 3;
    }
    if (targetState.role === "bomber") { phase = "bomb-resolution"; events = [event(`${targetName} ถูกเปิดเผยว่าเป็น Bomber — Host ต้องจัดการระเบิด`, "bomb", targetState.playerId), ...events]; }
    if (targetState.role === "police") {
      const detective = Object.values(updatedPrivate).find((state) => state.role === "detective" && state.hearts > 0);
      if (detective) { updatedPrivate[detective.playerId] = { ...detective, role: "police" }; events = [event("ตำรวจถูกกำจัด นักสืบเลื่อนเป็นตำรวจแบบลับ", "ability"), ...events]; }
      else { winner = "killers"; phase = "ended"; events = [event("ฝ่าย Killer ชนะ — ไม่มีนักสืบเหลืออยู่", "winner"), ...events]; }
    }
  }
  if (killerState && !killerState.isKillerSide) return room;
  return { ...room, phase, winner, attackLimit, attacksThisHour: attacksThisHour + 1, attackHour: currentHour, privateStates: updatedPrivate, players, evidences: updatedEvidence, events };
}

export function rejectEvidence(room: RoomState, evidenceId: string): RoomState {
  return { ...room, evidences: room.evidences.map((item) => item.id === evidenceId ? { ...item, status: "rejected", decisionAt: now() } : item), events: [event("หลักฐานถูกปฏิเสธ ไม่เกิดความเสียหาย", "warning"), ...room.events] };
}

export function submitEvidence(room: RoomState, killerId: string, targetId: string, imageData: string): RoomState {
  const state = room.privateStates[killerId];
  if (!state?.isKillerSide || room.phase !== "active") throw new Error("ยังไม่สามารถส่งหลักฐานได้");
  const currentHour = new Date().getHours();
  const attacksThisHour = room.attackHour === currentHour ? room.attacksThisHour : 0;
  if (attacksThisHour >= room.attackLimit) throw new Error("โควต้าการโจมตีชั่วโมงนี้เต็มแล้ว");
  return { ...room, attacksThisHour, attackHour: currentHour, evidences: [{ id: makeId(), killerId, targetId, imageData, createdAt: now(), status: "pending" }, ...room.evidences], events: [event("มีหลักฐานการโจมตีใหม่รอการตรวจ", "warning"), ...room.events] };
}

export function useReporter(room: RoomState, reporterId: string, targetId: string): RoomState {
  const reporter = room.privateStates[reporterId];
  const target = room.privateStates[targetId];
  if (!reporter || reporter.role !== "reporter" || reporter.hasUsedAbility || !target) throw new Error("ใช้ความสามารถนี้ไม่ได้");
  return { ...room, privateStates: { ...room.privateStates, [reporterId]: { ...reporter, hasUsedAbility: true } }, events: [event("นักข่าวได้ใช้ความสามารถแล้ว", "ability"), event(`${room.players.find((p) => p.id === targetId)?.name || "ผู้เล่น"} รู้ตัวว่าถูกตรวจบทบาท`, "ability", targetId), ...room.events] };
}

export function resolveBomb(room: RoomState, targetIds: string[]): RoomState {
  if (room.phase !== "bomb-resolution") return room;
  const ids = targetIds.slice(0, 2);
  const privateStates = { ...room.privateStates };
  const players = room.players.map((player) => {
    if (!ids.includes(player.id)) return player;
    privateStates[player.id] = { ...privateStates[player.id], hearts: 0 };
    return { ...player, health: "dead" as const, heartsVisibleToHost: 0 };
  });
  const names = players.filter((player) => ids.includes(player.id)).map((player) => player.name).join(" และ ") || "ไม่มีผู้เล่น";
  const killerDied = ids.some((id) => privateStates[id]?.isKillerSide);
  const remainingKillers = Object.values(privateStates).some((state) => state.isKillerSide && state.hearts > 0);
  return { ...room, phase: remainingKillers ? "active" : "ended", bombTargets: ids, privateStates, players, winner: !remainingKillers ? "city" : null, events: [event(`ระเบิดกำจัด ${names}`, "bomb"), ...(killerDied ? [event("ฝ่ายเมืองชนะ — Killer ถูกกำจัดจากระเบิด", "winner")] : []), ...room.events] };
}

export function syncClock(room: RoomState): RoomState {
  const hour = new Date().getHours();
  if (room.attackHour === hour || room.phase !== "active") return room;
  return { ...room, attacksThisHour: 0, attackHour: hour, events: [event(`โควต้าการโจมตีรีเซ็ตแล้ว — ชั่วโมงที่ ${String(hour).padStart(2, "0")}:00`), ...room.events] };
}

export function beginPoliceCheck(room: RoomState): RoomState {
  if (room.phase !== "active") return room;
  return { ...room, phase: "police-check", policeCheckAt: now(), events: [event("ถึงเวลาชี้ตัว ตำรวจเลือกผู้ต้องสงสัยหนึ่งคน", "warning"), ...room.events] };
}

export function resolvePoliceCheck(room: RoomState, policeId: string, targetId: string): RoomState {
  if (room.phase !== "police-check") throw new Error("ยังไม่ถึงเวลาชี้ตัว");
  const police = room.privateStates[policeId];
  const target = room.privateStates[targetId];
  if (!police || police.role !== "police" || police.hearts <= 0 || !target) throw new Error("ผู้เล่นนี้ไม่มีสิทธิ์ชี้ตัว");
  const correct = target.isKillerSide;
  return { ...room, phase: "ended", winner: correct ? "city" : "killers", events: [event(correct ? "ฝ่ายเมืองชนะ — ตำรวจชี้ตัว Killer ถูกต้อง" : "ฝ่าย Killer ชนะ — ตำรวจชี้ตัวผิดคน", "winner"), ...room.events] };
}
export function endRoomGame(room: RoomState, winner: WinningTeam = null): RoomState {
  if (room.phase === "ended") return room;
  const message = winner === "city" ? "Host สั่งจบเกม — ฝ่ายเมืองชนะ" : winner === "killers" ? "Host สั่งจบเกม — ฝ่าย Killer ชนะ" : "Host สั่งจบเกม";
  return { ...room, phase: "ended", winner: winner || room.winner, events: [event(message, "system"), ...room.events] };
}
