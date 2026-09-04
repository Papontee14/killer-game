import { createRoom, addPlayer } from "./game";
import type { RoomState } from "./types";

const prefix = "killer-room:";
export function loadRoom(code: string): RoomState | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(prefix + code.toUpperCase());
  return raw ? JSON.parse(raw) as RoomState : null;
}
export function saveRoom(room: RoomState) {
  window.localStorage.setItem(prefix + room.code, JSON.stringify(room));
  window.dispatchEvent(new CustomEvent("killer-room-update", { detail: room.code }));
}
export function createOrLoadRoom(code: string, hostName: string, hostPin: string, playerPin: string) {
  const current = loadRoom(code);
  if (current && current.hostPin !== hostPin) throw new Error("Host PIN ไม่ถูกต้อง");
  if (current) return current;
  const room = createRoom(hostName, hostPin, playerPin, code);
  saveRoom(room);
  return room;
}
export function joinOrCreateDemo(code: string, name: string, pin = "1234") {
  const current = loadRoom(code);
  if (!current) return null;
  if (current.playerPin !== pin) throw new Error("PIN ผู้เล่นไม่ถูกต้อง");
  const player = current.players.find((item) => item.name.toLowerCase() === name.trim().toLowerCase());
  if (player) return { room: current, playerId: player.id };
  if (current.phase !== "lobby") throw new Error("เกมเริ่มแล้วหรือจบลงแล้ว ไม่สามารถเข้าร่วมได้");
  const next = addPlayer(current, name);
  saveRoom(next);
  return { room: next, playerId: next.players[next.players.length - 1].id };
}
export function deleteRoom(code: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(prefix + code.toUpperCase());
  window.dispatchEvent(new CustomEvent("killer-room-update", { detail: code.toUpperCase() }));
}

