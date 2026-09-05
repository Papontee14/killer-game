import { test } from 'node:test';
import assert from 'node:assert/strict';

// Mock localStorage and window in node environment
class MockLocalStorage {
  constructor() {
    this.store = new Map();
  }
  getItem(key) {
    return this.store.has(key) ? this.store.get(key) : null;
  }
  setItem(key, value) {
    this.store.set(key, String(value));
  }
  removeItem(key) {
    this.store.delete(key);
  }
  clear() {
    this.store.clear();
  }
}

const mockStorage = new MockLocalStorage();
globalThis.window = {
  localStorage: mockStorage,
};

const {
  rememberRoomCredentials,
  readRoomCredentials,
  forgetRoomCredentials,
  rememberActiveRoom,
  readActiveRoom,
  clearActiveRoom,
} = await import('../src/room-session.ts');

test('room-session persists credentials without sensitive reclaimToken in localStorage', () => {
  mockStorage.clear();
  rememberRoomCredentials('player:ABC123', {
    name: 'Alice',
    reclaimToken: 'secret-token-12345',
  });

  // In-memory returns reclaimToken
  const inMem = readRoomCredentials('player:ABC123');
  assert.equal(inMem?.name, 'Alice');
  assert.equal(inMem?.reclaimToken, 'secret-token-12345');

  // LocalStorage has name, but NOT reclaimToken
  const raw = mockStorage.getItem('killer_room_cred:player:ABC123');
  assert.ok(raw);
  const parsed = JSON.parse(raw);
  assert.equal(parsed.name, 'Alice');
  assert.equal(parsed.reclaimToken, undefined);
});

test('room-session remembers and reads active room', () => {
  mockStorage.clear();
  rememberActiveRoom({
    role: 'player',
    code: 'xyz789',
    name: 'Bob',
  });

  const active = readActiveRoom();
  assert.deepEqual(active, {
    role: 'player',
    code: 'XYZ789',
    name: 'Bob',
  });

  // Verify it was stored in localStorage with uppercase 6-char code
  const raw = mockStorage.getItem('killer_active_room');
  assert.ok(raw);
  const parsed = JSON.parse(raw);
  assert.equal(parsed.role, 'player');
  assert.equal(parsed.code, 'XYZ789');
  assert.equal(parsed.name, 'Bob');

  // Verify credentials were also saved
  const cred = readRoomCredentials('player:XYZ789');
  assert.equal(cred?.name, 'Bob');
});

test('room-session rejects invalid active room values and cleans up corrupted storage', () => {
  clearActiveRoom();
  mockStorage.clear();
  mockStorage.setItem(
    'killer_active_room',
    JSON.stringify({ role: 'hacker', code: 'bad-code', name: '' }),
  );

  const active = readActiveRoom();
  assert.equal(active, null);
  // Corrupted key should have been removed
  assert.equal(mockStorage.getItem('killer_active_room'), null);
});

test('forgetRoomCredentials removes active room when matching', () => {
  mockStorage.clear();
  rememberActiveRoom({
    role: 'player',
    code: 'ROOM44',
    name: 'Charlie',
  });

  assert.ok(readActiveRoom());
  forgetRoomCredentials('player:ROOM44');
  assert.equal(readActiveRoom(), null);
  assert.equal(readRoomCredentials('player:ROOM44'), undefined);
});

test('clearActiveRoom removes active room pointer without crashing', () => {
  mockStorage.clear();
  rememberActiveRoom({
    role: 'host',
    code: 'HOST99',
    name: 'Master',
  });

  assert.equal(readActiveRoom()?.code, 'HOST99');
  clearActiveRoom();
  assert.equal(readActiveRoom(), null);
});
