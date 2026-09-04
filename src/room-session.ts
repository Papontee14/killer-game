/** The display name lives only in this tab's JS memory; it never enters a URL or browser storage. */
type RoomCredentials = { name: string };
const sessions = new Map<string, RoomCredentials>();

export function rememberRoomCredentials(key: string, credentials: RoomCredentials) {
  sessions.set(key, credentials);
}

export function readRoomCredentials(key: string) { return sessions.get(key); }

export function forgetRoomCredentials(key: string) { sessions.delete(key); }
