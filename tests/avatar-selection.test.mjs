import { before, after, beforeEach, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { nativeDatabase } from "./native-db.mjs";
import { fixture } from "./db-harness.mjs";

let server, db, f;
before(async () => { server = await nativeDatabase(); db = server.db; });
after(async () => { await server?.close(); });
beforeEach(async () => { f = await fixture(db); });
afterEach(async () => { await db?.exec("rollback"); });

test("lobby avatars are exclusive, required to start, and released when Host removes a player", async () => {
  await f.as("outsider", "create_room", ["UVWXYZ", "Other"]);
  const first = await f.as("villager", "join_room", ["UVWXYZ", "visitor"]);
  const second = await f.as("athlete", "join_room", ["UVWXYZ", "runner"]);
  await f.as("villager", "select_avatar", ["UVWXYZ", "m-sea-01"]);
  await assert.rejects(f.as("athlete", "select_avatar", ["UVWXYZ", "m-sea-01"]), /already selected/);
  await assert.rejects(f.as("outsider", "start_game", ["UVWXYZ", { killer: 1, police: 1 }]), /avatar selection/);
  await f.as("athlete", "select_avatar", ["UVWXYZ", "f-sea-01"]);
  const room = await f.as("outsider", "start_game", ["UVWXYZ", { killer: 1, police: 1 }]);
  assert.equal(room.phase, "active");
  assert.equal(room.players.find((player) => player.id === first.playerId).avatarId, "m-sea-01");
  assert.equal(room.players.find((player) => player.id === second.playerId).avatarId, "f-sea-01");
});

test("only the Host can remove lobby players", async () => {
  await f.as("outsider", "create_room", ["UVWXYZ", "Other"]);
  const joined = await f.as("villager", "join_room", ["UVWXYZ", "visitor"]);
  await assert.rejects(f.as("villager", "remove_lobby_player", ["UVWXYZ", joined.playerId]), /not allowed/);
  const room = await f.as("outsider", "remove_lobby_player", ["UVWXYZ", joined.playerId]);
  assert.equal(room.players.length, 0);
});

test("two players racing for one avatar produce exactly one owner", async () => {
  await f.as("outsider", "create_room", ["UVWXYZ", "Other"]);
  await f.as("villager", "join_room", ["UVWXYZ", "visitor"]);
  await f.as("athlete", "join_room", ["UVWXYZ", "runner"]);
  const select = async (role) => {
    const client = await server.newClient();
    try {
      await client.query("begin");
      await client.query("select set_config('request.jwt.claim.sub',$1,true)", [f.users[role]]);
      await client.query("set local role authenticated");
      const result = await client.query("select public.select_avatar($1,$2) as result", ["UVWXYZ", "m-sea-01"]);
      await client.query("commit");
      return result.rows[0].result;
    } catch (error) { await client.query("rollback"); throw error; } finally { await client.end(); }
  };
  const results = await Promise.allSettled([select("villager"), select("athlete")]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
});

test("the catalog contains 44 balanced avatar choices with matching WebP files", async () => {
  const catalog = await db.query("select gender,count(*)::int amount from public.avatar_catalog group by gender order by gender");
  assert.deepEqual(catalog.rows, [{ gender: "female", amount: 22 }, { gender: "male", amount: 22 }]);
  const files = await readdir(new URL("../public/pixel/characters/", import.meta.url));
  assert.equal(files.filter((file) => file.endsWith(".webp")).length, 44);
});
