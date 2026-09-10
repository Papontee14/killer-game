import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { database, fixture } from "./db-harness.mjs";

let db;
let f;

before(async () => {
  db = await database();
  // Exercise the deployable migration as well as the checked-in schema.
  await db.exec(await readFile(new URL("../supabase/migrations/20260910_end_game_story.sql", import.meta.url), "utf8"));
});
after(async () => db.close());
beforeEach(async () => { f = await fixture(db); });

test("the post-game story exposes approved structured events only to room members", async () => {
  const approved = await f.evidence("villager");
  await f.as("host", "approve_evidence", ["ABCDEF", approved]);
  await f.evidence("sumo"); // Pending evidence is deliberately absent.

  await assert.rejects(
    f.as("villager", "get_end_game_story", ["ABCDEF"]),
    /after the game ends/,
  );
  await f.as("host", "end_game", ["ABCDEF"]);

  const story = await f.as("villager", "get_end_game_story", ["ABCDEF"]);
  const attack = story.entries.find((entry) => entry.kind === "attack");
  assert.equal(attack.actorPlayerId, f.players.killer);
  assert.equal(attack.targetPlayerId, f.players.villager);
  assert.deepEqual(attack.affectedPlayerIds, [f.players.villager]);
  assert.ok(attack.result.storagePath);
  assert.equal(story.entries.filter((entry) => entry.kind === "attack").length, 1);
  assert.ok(story.entries.some((entry) => entry.kind === "game-start"));
  assert.ok(story.entries.some((entry) => entry.kind === "game-ended"));
  await assert.rejects(
    f.as("outsider", "get_end_game_story", ["ABCDEF"]),
    /not allowed/,
  );
});

test("ended-room members can read approved evidence but never pending evidence", async () => {
  const approved = await f.evidence("villager");
  await f.as("host", "approve_evidence", ["ABCDEF", approved]);
  const pending = await f.evidence("sumo");
  const paths = await db.query("select id,storage_path from public.evidence where id=any($1)", [[approved, pending]]);
  const approvedPath = paths.rows.find((row) => row.id === approved).storage_path;
  const pendingPath = paths.rows.find((row) => row.id === pending).storage_path;
  await f.as("host", "end_game", ["ABCDEF"]);

  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [f.users.reporter]);
  await db.exec("set role authenticated");
  try {
    const visible = await db.query("select name from storage.objects order by name");
    assert.ok(visible.rows.some((row) => row.name === approvedPath));
    assert.ok(!visible.rows.some((row) => row.name === pendingPath));
  } finally {
    await db.exec("reset role");
  }
});
