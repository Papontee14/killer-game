/** Credentials stay out of URLs and persistent browser storage. Supabase owns the durable session. */
type RoomCredentials = { name: string; reclaimToken?: string };
const sessions = new Map<string, RoomCredentials>();

export function rememberRoomCredentials(key: string, credentials: RoomCredentials) {
  sessions.set(key, credentials);
}

export function readRoomCredentials(key: string) { return sessions.get(key); }

export function forgetRoomCredentials(key: string) { sessions.delete(key); }
