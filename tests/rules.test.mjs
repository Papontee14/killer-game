import { before, after, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  database,
  fixture,
  migration,
  schema,
} from "./db-harness.mjs";
import { readFile } from "node:fs/promises";

let db, f;
const endGameRepairMigration = await readFile(
  new URL(
    "../supabase/migrations/20260905_restore_end_game_rpc.sql",
    import.meta.url,
  ),
  "utf8",
);
before(async () => {
  db = await database();
});
after(async () => {
  await db?.close();
});
beforeEach(async () => {
  f = await fixture(db);
});
const view = (role) => f.as(role, "get_room_view", ["ABCDEF"]);
const rpc = (role, name, ...args) => f.as(role, name, ["ABCDEF", ...args]);

test("role summary is hidden until ended and never available to outsiders", async () => {
  for (const phase of ["lobby", "active", "police-check", "bomb-resolution"]) {
    await db.query("update public.rooms set phase=$1", [phase]);
    for (const role of ["host", "villager", "killer"])
      assert.deepEqual((await view(role)).endGameSummary, []);
  }
  await rpc("host", "end_game");
  assert.equal(await view("outsider"), null);
  assert.equal(await view("nobody"), null);
});

test("ended summary reveals final roles and teams without expanding private data, including after closure", async () => {
  await f.hit("killer-wife");
  await f.hit("killer-wife");
  await f.resetQuota();
  await f.hit("police");
  await f.hit("police");
  const before = await view("villager");
  const ended = await rpc("host", "end_game");
  assert.equal(ended.winner, null);
  const result = await view("villager");
  assert.equal(result.endGameSummary.length, result.players.length);
  assert.deepEqual(result.privateStates, before.privateStates);
  assert.deepEqual(result.evidences, []);
  assert.deepEqual(result.killerEvidenceProgress, []);
  for (const entry of result.endGameSummary)
    assert.deepEqual(Object.keys(entry).sort(), ["currentRole", "initialRole", "playerId", "team"]);
  assert.deepEqual(result.endGameSummary.find((s) => s.playerId === f.players.detective), {
    playerId: f.players.detective, initialRole: "detective", currentRole: "police", team: "city",
  });
  assert.deepEqual(result.endGameSummary.find((s) => s.playerId === f.players["killer-wife"]), {
    playerId: f.players["killer-wife"], initialRole: "killer-wife", currentRole: "killer", team: "killers",
  });
  for (const role of ["host", "killer", "police"])
    assert.deepEqual((await view(role)).endGameSummary, result.endGameSummary);
  await rpc("host", "close_room");
  const closed = await view("villager");
  assert.ok(closed.closedAt);
  assert.deepEqual(closed.endGameSummary, result.endGameSummary);
  assert.equal(await view("outsider"), null);
});

test("summary accompanies either Police accusation outcome", async () => {
  for (const [target, winner] of [["killer", "city"], ["villager", "killers"]]) {
    await db.exec("update public.rooms set phase='police-check',winner=null");
    const result = await rpc("police", "resolve_police_check", f.players[target]);
    assert.equal(result.winner, winner);
    assert.equal(result.endGameSummary.length, result.players.length);
    assert.ok(result.endGameSummary.every((entry) => entry.currentRole && entry.team));
  }
});

test("ending an unstarted lobby includes every player with unassigned roles", async () => {
  await db.exec("delete from public.player_secrets; update public.rooms set phase='lobby'");
  const ended = await rpc("host", "end_game");
  assert.equal(ended.winner, null);
  const result = await view("villager");
  assert.equal(result.endGameSummary.length, result.players.length);
  for (const entry of result.endGameSummary)
    assert.deepEqual(entry, { playerId: entry.playerId, initialRole: null, currentRole: null, team: null });
});

test("all nine roles have correct hearts; role pool rejects invalid setup and Host cannot play", async () => {
  for (const [role, hearts] of Object.entries({
    killer: 0,
    "killer-wife": 2,
    police: 2,
    reporter: 2,
    bomber: 2,
    detective: 2,
    athlete: 3,
    sumo: 4,
    villager: 2,
  })) {
    assert.equal((await f.state(role)).hearts, hearts);
    assert.equal((await f.state(role)).health, "alive");
  }
  await assert.rejects(rpc("host", "join_room", "Moderator"));
  await db.exec("update public.rooms set phase='lobby'");
  for (const counts of [
    null,
    {},
    { killer: 0, police: 1, villager: 8 },
    { killer: 2, police: 1, villager: 6 },
    { killer: 1, police: 0, villager: 8 },
    { killer: 1, police: 1, villager: 7, reporter: null },
  ])
    await assert.rejects(rpc("host", "start_game", counts));
  const started = await rpc("host", "start_game", {
    killer: 1,
    police: 1,
    athlete: 1,
    sumo: 1,
    villager: 5,
  });
  const states = Object.values(started.privateStates);
  assert.equal(states.filter((s) => s.currentRole === "killer").length, 1);
  assert.equal(states.filter((s) => s.currentRole === "police").length, 1);
  assert.equal(states.find((s) => s.currentRole === "athlete").hearts, 3);
  assert.equal(states.find((s) => s.currentRole === "sumo").hearts, 4);
});

test("pending/rejected evidence does no damage, warning or quota; approved nonlethal attack does all three privately", async () => {
  const id = await f.evidence("villager");
  assert.equal((await f.state("villager")).hearts, 2);
  assert.equal(
    (await view("villager")).events.filter((e) => e.type === "warning").length,
    0,
  );
  assert.equal((await view("host")).attacksThisHour, 0);
  await rpc("host", "reject_evidence", id);
  assert.equal((await f.state("villager")).hearts, 2);
  await f.hit("villager");
  const mine = await view("villager"),
    other = await view("athlete"),
    killer = await view("killer");
  assert.equal(mine.privateStates[f.players.villager].hearts, 1);
  assert.equal(
    mine.events.filter(
      (e) => e.playerId === f.players.villager && e.type === "warning",
    ).length,
    1,
  );
  assert.equal(
    other.players.find((p) => p.id === f.players.villager).health,
    "alive",
  );
  assert.equal(
    killer.players.find((p) => p.id === f.players.villager).health,
    "alive",
  );
  assert.equal(
    killer.killerEvidenceProgress.find((e) => e.status === "approved").result,
    "target is still alive",
  );
  assert.equal(killer.attacksThisHour, 1);
  assert.deepEqual(Object.keys(other.privateStates), [f.players.athlete]);
});

test("quota is shared, counts nonlethal attacks and resets by Bangkok calendar hour", async () => {
  await f.hit("sumo");
  const id = await f.evidence("sumo");
  await f.hit("athlete");
  await assert.rejects(f.evidence("sumo"), /quota/);
  await assert.rejects(rpc("host", "approve_evidence", id), /quota/);
  assert.equal((await f.state("sumo")).hearts, 3);
  assert.equal((await view("host")).attacksThisHour, 2);
  await db.exec(
    "update public.rooms set quota_window_start=quota_window_start-interval '1 hour'",
  );
  await f.evidence("athlete"); // new hour allows submission before any approval resets the counter
  await rpc("host", "approve_evidence", id);
  assert.equal((await view("host")).attacksThisHour, 1);
  const bucket = (
    await db.query(
      "select quota_window_start=(date_trunc('hour',clock_timestamp() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok') as ok from public.rooms",
    )
  ).rows[0];
  assert.equal(bucket.ok, true);
  const boundaries = (
    await db.query(`select date_trunc('hour','2026-09-05 08:59:59+07'::timestamptz at time zone 'Asia/Bangkok') as before,
    date_trunc('hour','2026-09-05 09:00:00+07'::timestamptz at time zone 'Asia/Bangkok') as after`)
  ).rows[0];
  assert.notEqual(String(boundaries.before), String(boundaries.after));
});

test("wife transforms privately, both Killers see shared progress, quota grows without reset", async () => {
  await f.hit("killer-wife");
  await f.hit("killer-wife");
  const wife = await view("killer-wife"),
    killer = await view("killer"),
    city = await view("villager");
  assert.equal(
    wife.privateStates[f.players["killer-wife"]].isActiveKiller,
    true,
  );
  assert.equal(wife.privateStates[f.players["killer-wife"]].maxHearts, 0);
  assert.equal(wife.attackLimit, 3);
  assert.equal(wife.attacksThisHour, 2);
  assert.deepEqual(wife.killerEvidenceProgress, killer.killerEvidenceProgress);
  assert.equal(wife.killerEvidenceProgress.length, 2);
  assert.equal(
    city.players.find((p) => p.id === f.players["killer-wife"]).health,
    "alive",
  );
  const publicAbility = city.events.filter((e) => e.type === "ability");
  assert.deepEqual(
    publicAbility.map((e) => e.message),
    ["Killer has eliminated Killer's Wife. There are now two Killers."],
  );
  assert.equal(
    wife.events.filter(
      (e) => e.playerId === f.players["killer-wife"] && e.type === "warning",
    ).length,
    2,
  );
  await f.hit("sumo", "killer-wife");
  assert.equal((await view("killer")).attacksThisHour, 3);
  for (const progress of (await view("killer")).killerEvidenceProgress)
    for (const key of [
      "storagePath",
      "imageData",
      "hearts",
      "maxHearts",
      "initialRole",
      "currentRole",
    ])
      assert.equal(key in progress, false);
  await assert.rejects(f.evidence("sumo", "killer-wife"), /quota/);
  await assert.rejects(f.evidence("sumo", "killer"), /quota/);
  await f.resetQuota();
  await assert.rejects(f.evidence("killer-wife"), /evidence/);
});

test("normal lethal attack sends a private warning and generic public death", async () => {
  await f.hit("villager");
  await f.hit("villager");
  const dead = await view("villager");
  assert.equal(dead.privateStates[f.players.villager].hearts, 0);
  assert.equal(
    dead.events.filter(
      (e) => e.playerId === f.players.villager && e.type === "warning",
    ).length,
    2,
  );
  assert.equal(
    (await view("killer")).killerEvidenceProgress.filter(
      (e) => e.result === "elimination confirmed",
    ).length,
    1,
  );
});

test("reporter refuses self/dead/NULL targets without consuming ability and reads initial role once", async () => {
  for (const target of [f.players.reporter, null])
    await assert.rejects(rpc("reporter", "use_reporter", target));
  await db.query("update public.players set health='dead' where id=$1", [
    f.players.villager,
  ]);
  await assert.rejects(rpc("reporter", "use_reporter", f.players.villager));
  assert.equal((await f.state("reporter")).has_used_ability, false);
  await f.hit("killer-wife");
  await f.hit("killer-wife");
  const result = await rpc(
    "reporter",
    "use_reporter",
    f.players["killer-wife"],
  );
  assert.ok(
    result.events.some(
      (e) =>
        e.playerId === f.players.reporter && e.message.endsWith("killer-wife"),
    ),
  );
  await assert.rejects(rpc("reporter", "use_reporter", f.players.killer));
  const target = await view("killer-wife");
  assert.ok(
    target.events.some(
      (e) =>
        e.message === "คุณถูกตรวจบทบาท" &&
        e.playerId === f.players["killer-wife"],
    ),
  );
  assert.ok(
    !(await view("athlete")).events.some((e) =>
      e.message.includes("บทบาทเริ่มต้น"),
    ),
  );
});

test("promoted detective still reports initial Detective; reporter is allowed during accusation and bomb phase", async () => {
  await f.hit("police");
  await f.hit("police");
  assert.equal((await f.state("detective")).role_current, "police");
  await db.exec("update public.rooms set phase='police-check'");
  const result = await rpc("reporter", "use_reporter", f.players.detective);
  assert.ok(result.events.some((e) => e.message.endsWith("detective")));
  await db.exec(
    "update public.player_secrets set has_used_ability=false where role_current='reporter'; update public.rooms set phase='bomb-resolution'",
  );
  await rpc("reporter", "use_reporter", f.players.sumo);
});

test("Host, outsider, wrong role, dead actor and unauthenticated caller cannot use role RPCs", async () => {
  for (const role of ["host", "outsider", "villager", "nobody"])
    await assert.rejects(rpc(role, "use_reporter", f.players.killer));
  assert.equal(
    (await view("villager")).events.some((e) =>
      e.message.includes("บทบาทเริ่มต้น"),
    ),
    false,
  );
  await db.query("update public.players set health='dead' where id=$1", [
    f.players.reporter,
  ]);
  await assert.rejects(rpc("reporter", "use_reporter", f.players.killer));
  await db.exec("update public.rooms set phase='police-check'");
  for (const role of ["host", "outsider", "villager", "nobody"])
    await assert.rejects(rpc(role, "resolve_police_check", f.players.killer));
  for (const id of [null, f.players.police])
    await assert.rejects(rpc("police", "resolve_police_check", id));
  assert.equal((await view("host")).winner, null);
});

test("cross-room target and Host-only mutations refuse outsiders", async () => {
  const other = await f.as("outsider", "create_room", ["UVWXYZ", "Other"]);
  const joined = await f.as("villager", "join_room", ["UVWXYZ", "visitor"]);
  await assert.rejects(rpc("reporter", "use_reporter", joined.playerId));
  await assert.rejects(
    rpc(
      "killer",
      "submit_evidence",
      joined.playerId,
      "missing",
      new Date().toISOString(),
    ),
  );
  for (const [fn, args] of [
    ["start_game", [{}]],
    ["approve_evidence", [null]],
    ["reject_evidence", [null]],
    ["resolve_bomb", [[]]],
    ["set_accusation_at", [new Date().toISOString()]],
    ["close_room", []],
  ])
    await assert.rejects(rpc("outsider", fn, ...args));
  assert.equal(other.phase, "lobby");
});

test("Host can end a game from any open phase, while non-Hosts cannot", async () => {
  for (const phase of ["lobby", "active", "police-check", "bomb-resolution"]) {
    await db.query("update public.rooms set phase=$1, winner=null", [phase]);
    const ended = await rpc("host", "end_game");
    assert.equal(ended.phase, "ended");
    assert.ok(ended.events.some((event) => event.message === "Host สั่งจบเกม"));
  }
  await db.exec("update public.rooms set phase='active'");
  await assert.rejects(rpc("outsider", "end_game"));
});

test("end-game repair migration restores the missing RPC and its Host-only access", async () => {
  await db.exec("drop function public.end_game(text)");
  await db.exec(endGameRepairMigration);
  await db.exec(endGameRepairMigration);

  for (const phase of ["lobby", "active", "police-check", "bomb-resolution"]) {
    await db.query("update public.rooms set phase=$1, winner=null", [phase]);
    const ended = await rpc("host", "end_game");
    assert.equal(ended.phase, "ended");
  }
  await db.exec("update public.rooms set phase='active'");
  await assert.rejects(rpc("outsider", "end_game"));
});

test("heartbeat only changes presence for the authenticated member; internal helpers are not callable", async () => {
  for (const role of ["host", "outsider", "nobody"])
    await assert.rejects(rpc(role, "heartbeat"));
  await rpc("villager", "heartbeat");
  for (const name of ["advance_due_accusation", "room_for_code", "add_event"]) {
    const args =
      name === "advance_due_accusation"
        ? [f.roomId]
        : name === "room_for_code"
          ? ["ABCDEF"]
          : [f.roomId, "ability", "injected", null];
    await assert.rejects(f.as("villager", name, args), /permission denied/);
  }
});

test("upgrade and fresh-install definitions remain identical for all migrated RPCs", () => {
  const definitions = (text) =>
    new Map(
      [
        ...text.replace(/\r\n/g, "\n").matchAll(
          /create or replace function public\.(\w+)\([\s\S]*?\$\$;/g,
        ),
      ].map((match) => [match[1], match[0]]),
    );
  const fresh = definitions(schema);
  for (const [name, body] of definitions(migration))
    assert.equal(body, fresh.get(name), name);
});

test("deadline is persisted by direct approval without damage and by direct submission without evidence", async () => {
  const id = await f.evidence("sumo");
  await db.exec(
    "update public.rooms set police_check_at=clock_timestamp()-interval '1 second'",
  );
  const result = await rpc("host", "approve_evidence", id);
  assert.equal(result.actionError, "accusation_started");
  assert.equal(result.phase, "police-check");
  assert.equal((await f.state("sumo")).hearts, 4);
  assert.equal((await view("host")).attacksThisHour, 0);
  await db.exec("update public.rooms set phase='active'");
  assert.equal(await f.evidence("sumo"), undefined);
  assert.equal(
    (await db.query("select count(*)::int n from public.evidence")).rows[0].n,
    1,
  );
  assert.equal((await view("host")).phase, "police-check");
});

test("freshness applies at submission only; pending evidence never expires on Host review", async () => {
  await assert.rejects(f.evidence("sumo", "killer", 121000), /stale/);
  const id = await f.evidence("sumo");
  await db.query(
    "update public.evidence set captured_at=captured_at-interval '1 day',created_at=created_at-interval '1 day' where id=$1",
    [id],
  );
  await rpc("host", "approve_evidence", id);
  assert.equal((await f.state("sumo")).hearts, 3);
});

test("Bomber auto-pauses attacks and reveals only its own role", async () => {
  const pending = await f.evidence("sumo");
  await f.hit("bomber");
  const result = await f.hit("bomber");
  assert.equal(result.phase, "bomb-resolution");
  assert.ok(
    result.events.some(
      (e) => e.type === "bomb" && e.message.endsWith("Bomber"),
    ),
  );
  await assert.rejects(rpc("host", "approve_evidence", pending));
  const resolved = await rpc("host", "resolve_bomb", [f.players.villager]);
  assert.equal(resolved.attacksThisHour, 2);
  assert.equal((await f.state("villager")).health, "dead");
});

for (const targets of [
  ["killer", "police"],
  ["police", "killer"],
])
  test(
    "last Killer and Police explosion: city wins regardless of order " +
      targets.join(","),
    async () => {
      await db.query("update public.players set health='dead' where id=$1", [
        f.players.detective,
      ]);
      const result = await f.bomb(targets);
      assert.equal(result.winner, "city");
      assert.equal(result.pendingBomberId, null);
      assert.ok(
        result.events
          .filter((e) => e.type === "bomb")
          .every((e) => !e.message.includes("Killer")),
      );
    },
  );

for (const targets of [
  ["police", "detective"],
  ["detective", "police"],
])
  test(
    "Police and Detective explosion: Killers win regardless of order " +
      targets.join(","),
    async () => {
      assert.equal((await f.bomb(targets)).winner, "killers");
    },
  );

test("bomb accepts zero victims, refuses duplicates/NULL/too many/dead victims and no wife transformation", async () => {
  await f.bomb([]);
  assert.equal((await view("host")).phase, "active");
  await db.exec("update public.rooms set phase='bomb-resolution'");
  for (const ids of [
    null,
    [null],
    [f.players.killer, f.players.killer],
    Object.values(f.players).slice(0, 3),
    [f.players.bomber],
  ])
    await assert.rejects(rpc("host", "resolve_bomb", ids));
  await rpc("host", "resolve_bomb", [f.players["killer-wife"]]);
  assert.equal((await f.state("killer-wife")).is_active_killer, false);
  assert.equal((await f.state("killer-wife")).health, "dead");
});

test("bomb kills transformed Killer; old pending attacks of a dead Killer cannot be approved", async () => {
  await f.hit("killer-wife");
  await f.hit("killer-wife");
  await f.resetQuota();
  const id = await f.evidence("sumo", "killer-wife");
  const result = await f.bomb(["killer-wife"]);
  assert.equal(result.winner, null);
  await assert.rejects(
    rpc("host", "approve_evidence", id),
    /killer is not active/,
  );
  assert.equal((await f.state("sumo")).hearts, 4);
});

test("bomb ends in accusation if deadline passed; Police accusation decides either winner", async () => {
  await db.exec(
    "update public.rooms set police_check_at=clock_timestamp()-interval '1 second'",
  );
  assert.equal((await f.bomb([])).phase, "police-check");
  assert.equal(
    (await rpc("police", "resolve_police_check", f.players.killer)).winner,
    "city",
  );
  await db.exec("update public.rooms set phase='police-check',winner=null");
  assert.equal(
    (await rpc("police", "resolve_police_check", f.players.sumo)).winner,
    "killers",
  );
});

test("Detective death alone continues, Police later dies without successor: Killers win", async () => {
  await f.hit("detective");
  await f.hit("detective");
  assert.equal((await view("host")).winner, null);
  await f.resetQuota();
  await f.hit("police");
  assert.equal((await f.hit("police")).winner, "killers");
});

test("Storage reads are Host-only and Realtime signals remain authorized without table grants", async () => {
  await f.evidence("sumo");
  for (const role of ["killer", "reporter", "host", "outsider"]) {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      f.users[role],
    ]);
    await db.exec("set role authenticated");
    try {
      assert.equal(
        (await db.query("select * from storage.objects")).rows.length,
        role === "host" ? 1 : 0,
      );
      assert.equal(
        (await db.query("select * from public.room_signals")).rows.length,
        role === "outsider" ? 0 : 1,
      );
      await assert.rejects(
        db.query("select * from public.player_secrets"),
        /permission denied/,
      );
    } finally {
      await db.exec("reset role");
    }
  }
});

test("migration upgrades an active room without changing gameplay data; legacy results stay unknown", async () => {
  await f.hit("sumo");
  const pending = await f.evidence("athlete");
  // Model the pre-upgrade physical shape while preserving current fixture rows.
  await db.exec("alter table public.evidence drop column attack_result");
  const snapshot = async () =>
    Object.fromEntries(
      await Promise.all(
        ["rooms", "players", "player_secrets", "evidence", "room_events"].map(
          async (table) => [
            table,
            (await db.query(`select * from public.${table} order by 1`)).rows,
          ],
        ),
      ),
    );
  const before = await snapshot();
  await db.exec(migration);
  await db.exec(migration); // repeat is safe
  const after = await snapshot();
  for (const e of after.evidence) {
    assert.equal(e.attack_result, null);
    delete e.attack_result;
  }
  assert.deepEqual(after, before);
  await rpc("host", "approve_evidence", pending);
  assert.equal((await f.state("athlete")).hearts, 2);
});

test("approved attack announces anonymously to everyone except the victim; pending and rejected evidence stay silent", async () => {
  const text = "มีคนถูกโจมตีจาก Killer";
  const announcements = async (role) =>
    (await view(role)).events.filter((e) => e.message === text);
  const pending = await f.evidence("sumo");
  for (const role of ["sumo", "athlete", "killer", "host"])
    assert.equal((await announcements(role)).length, 0);
  await rpc("host", "reject_evidence", pending);
  for (const role of ["sumo", "athlete", "killer", "host"])
    assert.equal((await announcements(role)).length, 0);
  const evidence = await f.evidence("sumo");
  await rpc("host", "approve_evidence", evidence);
  assert.equal((await announcements("sumo")).length, 0);
  assert.equal(
    (await view("sumo")).events.filter(
      (e) => e.message === "คุณถูกโจมตีและเสียหัวใจ 1 ดวง",
    ).length,
    1,
  );
  for (const role of ["athlete", "villager", "killer", "host"]) {
    const events = await announcements(role);
    assert.equal(events.length, 1);
    assert.equal(events[0].playerId, null);
    assert.equal(JSON.stringify(events[0]).includes(f.players.sumo), false);
    assert.equal(Object.hasOwn(events[0], "excluded_player_id"), false);
  }
  assert.equal(
    (await view("athlete")).events.some(
      (e) => e.message === "คุณถูกโจมตีและเสียหัวใจ 1 ดวง",
    ),
    false,
  );
  await assert.rejects(rpc("host", "approve_evidence", evidence));
  assert.equal((await announcements("athlete")).length, 1);
});
