import { DEFAULT_ROLE_COUNTS, type Role } from "./types";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function makeRoomCode() {
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

export function rolePool(counts: Partial<Record<Role, number>> = {}) {
  const merged = { ...DEFAULT_ROLE_COUNTS, ...counts };
  return (Object.keys(merged) as Role[]).flatMap((role) => Array.from({ length: Math.max(0, merged[role] || 0) }, () => role));
}
