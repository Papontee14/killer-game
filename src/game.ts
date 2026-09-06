const DEFAULT_ROLE_COUNTS: Record<string, number> = {
  killer: 1,
  "killer-wife": 0,
  police: 1,
  reporter: 0,
  bomber: 0,
  detective: 0,
  athlete: 0,
  sumo: 0,
  villager: 0,
};

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function makeRoomCode() {
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

export function parseRoomInvitationCode(raw: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();

  // 1. Direct 6-character room code
  const directMatch = trimmed.match(/^[A-Za-z0-9]{6}$/);
  if (directMatch) {
    return directMatch[0].toUpperCase();
  }

  // 2. Query param pattern anywhere in the string (e.g. ?room=ABCDEF, &room=ABCDEF, room=ABCDEF)
  const paramMatch = trimmed.match(/(?:[?&]|^)room=([A-Za-z0-9]{6})(?:&|$)/i);
  if (paramMatch) {
    return paramMatch[1].toUpperCase();
  }

  // 3. Path match in URL (e.g. /room/ABCDEF)
  const pathMatch = trimmed.match(/\/room\/([A-Za-z0-9]{6})(?:[/?&#]|$)/i);
  if (pathMatch) {
    return pathMatch[1].toUpperCase();
  }

  return null;
}

export function rolePool(counts: Partial<Record<string, number>> = {}) {
  const merged = { ...DEFAULT_ROLE_COUNTS, ...counts };
  return Object.keys(merged).flatMap((role) => Array.from({ length: Math.max(0, merged[role] || 0) }, () => role));
}
