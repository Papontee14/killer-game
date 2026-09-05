/**
 * Room session metadata and active-room persistence.
 * Note: Reclaim tokens are sensitive credentials and are kept in-memory only.
 * Same-device cold restarts resume via durable browser room hints + Supabase anonymous auth.
 */

export type RoomRole = 'player' | 'host';

export type RoomCredentials = {
  name: string;
  reclaimToken?: string;
};

export type ActiveRoomRecord = {
  role: RoomRole;
  code: string;
  name: string;
};

const CREDENTIAL_STORAGE_PREFIX = 'killer_room_cred:';
const ACTIVE_ROOM_KEY = 'killer_active_room';

const inMemoryCredentials = new Map<string, RoomCredentials>();
let inMemoryActiveRoom: ActiveRoomRecord | null = null;

function isBrowser(): boolean {
  return (
    typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
  );
}

function safeGetStorage(): Storage | null {
  if (!isBrowser()) return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function sanitizeCode(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  const trimmed = code.trim().toUpperCase();
  return /^[A-Z0-9]{6}$/.test(trimmed) ? trimmed : null;
}

function sanitizeName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= 24 ? trimmed : null;
}

function sanitizeRole(role: unknown): RoomRole | null {
  return role === 'player' || role === 'host' ? role : null;
}

export function rememberRoomCredentials(
  key: string,
  credentials: RoomCredentials,
) {
  const sanitizedName =
    sanitizeName(credentials.name) ?? credentials.name.trim();
  const token =
    typeof credentials.reclaimToken === 'string' &&
    credentials.reclaimToken.trim().length > 0
      ? credentials.reclaimToken.trim()
      : undefined;

  // Keep in-memory cache (includes reclaimToken if provided)
  inMemoryCredentials.set(key, {
    name: sanitizedName,
    reclaimToken: token,
  });

  const storage = safeGetStorage();
  if (storage) {
    try {
      // Intentionally do NOT persist reclaimToken to persistent browser storage
      storage.setItem(
        `${CREDENTIAL_STORAGE_PREFIX}${key}`,
        JSON.stringify({ name: sanitizedName }),
      );
    } catch {
      // Storage unavailable or full; in-memory copy remains
    }
  }
}

export function readRoomCredentials(key: string): RoomCredentials | undefined {
  const inMem = inMemoryCredentials.get(key);
  if (inMem) return inMem;

  const storage = safeGetStorage();
  if (!storage) return undefined;

  try {
    const raw = storage.getItem(`${CREDENTIAL_STORAGE_PREFIX}${key}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw);
    const validName = sanitizeName(parsed?.name);
    if (!validName) {
      storage.removeItem(`${CREDENTIAL_STORAGE_PREFIX}${key}`);
      return undefined;
    }
    const cred: RoomCredentials = { name: validName };
    inMemoryCredentials.set(key, cred);
    return cred;
  } catch {
    return undefined;
  }
}

export function forgetRoomCredentials(key: string) {
  inMemoryCredentials.delete(key);
  const storage = safeGetStorage();
  if (storage) {
    try {
      storage.removeItem(`${CREDENTIAL_STORAGE_PREFIX}${key}`);
    } catch {
      // ignore
    }
  }

  // If the active room matches this credential key, clear active room record too
  const active = readActiveRoom();
  if (active && `${active.role}:${active.code}` === key) {
    clearActiveRoom();
  }
}

export function rememberActiveRoom(record: {
  role: RoomRole;
  code: string;
  name: string;
}) {
  const code = sanitizeCode(record.code);
  const name = sanitizeName(record.name);
  const role = sanitizeRole(record.role);
  if (!code || !name || !role) return;

  const validRecord: ActiveRoomRecord = { role, code, name };
  inMemoryActiveRoom = validRecord;

  // Also remember credentials under role:code
  rememberRoomCredentials(`${role}:${code}`, { name });

  const storage = safeGetStorage();
  if (storage) {
    try {
      storage.setItem(ACTIVE_ROOM_KEY, JSON.stringify(validRecord));
    } catch {
      // Storage quota or disabled
    }
  }
}

export function readActiveRoom(): ActiveRoomRecord | null {
  if (inMemoryActiveRoom) return inMemoryActiveRoom;

  const storage = safeGetStorage();
  if (!storage) return null;

  try {
    const raw = storage.getItem(ACTIVE_ROOM_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const code = sanitizeCode(parsed?.code);
    const name = sanitizeName(parsed?.name);
    const role = sanitizeRole(parsed?.role);

    if (!code || !name || !role) {
      storage.removeItem(ACTIVE_ROOM_KEY);
      return null;
    }

    const record: ActiveRoomRecord = { role, code, name };
    inMemoryActiveRoom = record;
    return record;
  } catch {
    return null;
  }
}

export function clearActiveRoom() {
  inMemoryActiveRoom = null;
  const storage = safeGetStorage();
  if (storage) {
    try {
      storage.removeItem(ACTIVE_ROOM_KEY);
    } catch {
      // ignore
    }
  }
}
