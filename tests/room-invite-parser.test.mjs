import { test } from "node:test";
import assert from "node:assert/strict";

const { parseRoomInvitationCode } = await import("../src/game.ts");

test("parseRoomInvitationCode correctly parses various QR code payloads", () => {
  // Direct 6-character room codes
  assert.equal(parseRoomInvitationCode("ABCDEF"), "ABCDEF");
  assert.equal(parseRoomInvitationCode("k9p2mx"), "K9P2MX");
  assert.equal(parseRoomInvitationCode("  123456  "), "123456");

  // Full URL with query param
  assert.equal(parseRoomInvitationCode("https://killer-game.app/?room=ABCDEF"), "ABCDEF");
  assert.equal(parseRoomInvitationCode("http://localhost:3000/?room=K9P2MX"), "K9P2MX");
  assert.equal(parseRoomInvitationCode("http://localhost:3000/?foo=bar&room=K9P2MX&baz=1"), "K9P2MX");

  // Path-based URL
  assert.equal(parseRoomInvitationCode("https://killer-game.app/room/ABCDEF"), "ABCDEF");
  assert.equal(parseRoomInvitationCode("https://killer-game.app/room/ABCDEF/"), "ABCDEF");

  // Query string directly
  assert.equal(parseRoomInvitationCode("?room=ABCDEF"), "ABCDEF");
  assert.equal(parseRoomInvitationCode("room=ABCDEF"), "ABCDEF");

  // Invalid formats
  assert.equal(parseRoomInvitationCode(""), null);
  assert.equal(parseRoomInvitationCode("ABC"), null);
  assert.equal(parseRoomInvitationCode("ABCDEFG"), null);
  assert.equal(parseRoomInvitationCode("https://google.com"), null);
  assert.equal(parseRoomInvitationCode("hello-world-room"), null);
});
