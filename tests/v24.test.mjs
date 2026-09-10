import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  database,
  fixture,
  initializeDatabase,
  schema,
} from "./db-harness.mjs";
import { PGlite } from "@electric-sql/pglite";
let db, f;
before(async () => {
  db = await database();
});
after(async () => {
  await db.close();
});
beforeEach(async () => {
  f = await fixture(db);
  await db.exec(
    `update public.rooms set rules_version='2.4',police_check_at=null,v24=jsonb_build_object('stage','active','startedAt',clock_timestamp()-interval '30 minutes','finalAt',clock_timestamp()+interval '570 minutes','cutoffAt',clock_timestamp()+interval '540 minutes','revealEndsAt',clock_timestamp()+interval '450 minutes','huntDeadline',clock_timestamp()+interval '90 minutes','proximityRule','Nearest player within two metres; equal distance uses seat order')`,
  );
  await db.query(
    "update public.player_secrets set hearts=1,max_hearts=1 where player_id=$1",
    [f.players["killer-wife"]],
  );
  await db.query(
    "update public.player_secrets set initial_role='doctor',role_current='doctor',hearts=2,max_hearts=2 where player_id=$1",
    [f.players.sumo],
  );
});
const view = (role) => f.as(role, "get_room_view", ["ABCDEF"]);
async function action(
  target,
  { kind = "attack", minutes = 3, actor = "killer" } = {},
) {
  const result = await db.query(
    `insert into public.v24_actions(room_id,actor_id,target_id,kind,effective_at) values($1,$2,$3,$4,clock_timestamp()-make_interval(mins=>$5)) returning id`,
    [f.roomId, f.players[actor], f.players[target], kind, minutes],
  );
  return result.rows[0].id;
}
const apply = (id) => f.as("host", "v24_apply", ["ABCDEF", id, true]);
test("Wife transforms on first hit, consumes damage only, hides identity", async () => {
  const id = await action("killer-wife");
  const result = await apply(id);
  assert.equal((await f.state("killer-wife")).is_active_killer, true);
  assert.equal(result.v24.attacksUsed, 1);
  assert.equal(result.v24.killsUsed, 0);
  const city = await view("villager");
  assert.equal(city.v24.huntDeadline, undefined);
  assert.equal(city.privateStates[f.players["killer-wife"]], undefined);
  assert.ok(
    city.events.some((e) => e.message === "มี Killer คนที่สองเกิดขึ้น"),
  );
  assert.equal((await apply(id)).v24.attacksUsed, 1);
});
test("new rules keep Killer's Wife role while awakening the attack ability", async () => {
  await db.exec(
    "update public.rooms set v24=v24||jsonb_build_object('finalVoteRules',true)",
  );
  await apply(await action("killer-wife"));
  const wife = await f.state("killer-wife");
  assert.equal(wife.initial_role, "killer-wife");
  assert.equal(wife.role_current, "killer-wife");
  assert.equal(wife.is_active_killer, true);
  const city = await view("villager");
  assert.ok(city.events.some((e) => e.message === "Killer's Wife has awakened. There are now two active Killers."));
});
test("Police takes damage normally, protection prevents repeated hit", async () => {
  await apply(await action("police", { minutes: 4 }));
  assert.equal((await f.state("police")).hearts, 1);
  assert.equal((await view("host")).winner, null);
  await assert.rejects(apply(await action("police")), /target protected/);
});
test("Doctor uses charge on full health; only Host sees mechanical result", async () => {
  await f.as("sumo", "use_doctor", ["ABCDEF", f.players.villager]);
  await db.exec(
    "update public.v24_actions set effective_at=clock_timestamp()-interval '3 minutes'",
  );
  const id = (await db.query("select id from public.v24_actions")).rows[0].id;
  await apply(id);
  assert.equal((await f.state("sumo")).doctor_uses, 1);
  assert.equal((await f.state("villager")).hearts, 2);
  const own = await view("sumo");
  assert.equal(own.v24.actions, undefined);
  assert.ok(own.events.some((e) => e.message === "Doctor treated villager"));
  await assert.rejects(
    f.as("sumo", "use_doctor", ["ABCDEF", f.players.villager]),
    /doctor ability unavailable/,
  );
});
test("earlier lethal event prevents later heal from reviving; charges remain consumed", async () => {
  await db.query(
    "update public.player_secrets set hearts=1 where player_id=$1",
    [f.players.villager],
  );
  const attack = await action("villager", { minutes: 5 });
  const heal = await action("villager", {
    kind: "heal",
    actor: "sumo",
    minutes: 3,
  });
  await assert.rejects(apply(heal), /earlier event/);
  await apply(attack);
  await apply(heal);
  assert.equal((await f.state("villager")).health, "dead");
});
test("three attacks per rolling hour; fourth refused atomically", async () => {
  await apply(await action("villager", { minutes: 6 }));
  await apply(await action("reporter", { minutes: 5 }));
  await apply(await action("athlete", { minutes: 4 }));
  await assert.rejects(
    apply(await action("detective")),
    /rolling attack quota/,
  );
  assert.equal((await f.state("detective")).hearts, 2);
});
test("Hunt expires without pending evidence and records deadline", async () => {
  await db.exec(
    "update public.rooms set v24=v24||jsonb_build_object('huntDeadline',clock_timestamp()-interval '3 minutes')",
  );
  const result = await view("host");
  assert.equal(result.winner, "city");
  assert.equal(result.endGameResult.reason, "hunt-clock-expired");
});
test("pending lethal event prevents premature Hunt loss and resets from effective time", async () => {
  await db.query(
    "update public.player_secrets set hearts=1 where player_id=$1",
    [f.players.villager],
  );
  const id = await action("villager", { minutes: 4 });
  await db.exec(
    "update public.rooms set v24=v24||jsonb_build_object('huntDeadline',clock_timestamp()-interval '3 minutes')",
  );
  assert.equal((await view("host")).winner, null);
  const result = await apply(id);
  assert.equal(result.winner, null);
  assert.ok(Date.parse(result.v24.huntDeadline) > Date.now());
});
test("Detective promotion restores two hearts; next lineage death loses", async () => {
  await db.query(
    "update public.player_secrets set hearts=1 where player_id=any($1)",
    [[f.players.police, f.players.detective]],
  );
  await apply(await action("police"));
  assert.equal((await f.state("detective")).role_current, "police");
  assert.equal((await f.state("detective")).hearts, 2);
  await db.query("update public.players set health='dead' where id=$1", [
    f.players.detective,
  ]);
  await db.query("select public.v24_victory($1,clock_timestamp())", [f.roomId]);
  assert.equal((await view("host")).winner, "killers");
});
async function voting(k = 1) {
  const ids = Object.values(f.players);
  if (k === 2)
    await db.query(
      "update public.player_secrets set role_current='killer',is_active_killer=true,hearts=0,max_hearts=0 where player_id=$1",
      [f.players["killer-wife"]],
    );
  await db.query(
    "update public.rooms set v24=v24||jsonb_build_object('stage','secret-vote','cutoffAt',clock_timestamp()-interval '30 minutes','finalAt',clock_timestamp()-interval '1 minute','voteEndsAt',clock_timestamp()+interval '2 minutes','nomineeCount',$1::int,'fallback',$2::jsonb,'voters',$2::jsonb)",
    [k, JSON.stringify(ids)],
  );
}
test("secret ballots enforce membership, no self vote, immutable and hidden", async () => {
  await voting();
  await assert.rejects(
    f.as("villager", "submit_final_ballot", [
      "ABCDEF",
      [f.players.villager],
      [],
    ]),
    /invalid ballot/,
  );
  await f.as("villager", "submit_final_ballot", [
    "ABCDEF",
    [f.players.killer],
    [],
  ]);
  await f.as("villager", "submit_final_ballot", [
    "ABCDEF",
    [f.players.police],
    [],
  ]);
  assert.deepEqual((await view("villager")).v24.myBallot.nominees, [
    f.players.killer,
  ]);
  assert.equal((await view("reporter")).v24.myBallot, null);
  assert.equal((await view("reporter")).v24.ballots, undefined);
  assert.equal((await view("reporter")).v24.fallback, undefined);
  await assert.rejects(
    f.as("outsider", "submit_final_ballot", ["ABCDEF", [f.players.killer], []]),
    /vote unavailable/,
  );
});
test("K=2 requires both killers for City victory", async () => {
  await voting(2);
  await f.as("villager", "submit_final_ballot", [
    "ABCDEF",
    [f.players.killer, f.players["killer-wife"]],
    [],
  ]);
  await db.exec(
    "update public.rooms set v24=v24||jsonb_build_object('voteEndsAt',clock_timestamp()-interval '1 second')",
  );
  const result = await view("host");
  assert.equal(result.winner, "city");
  assert.equal(result.v24.nominees.length, 2);
});
test("new final vote accepts exactly one name and only the original Killer wins", async () => {
  await voting(2);
  await db.exec(
    "update public.rooms set v24=v24||jsonb_build_object('finalVoteRules',true)",
  );
  await assert.rejects(
    f.as("villager", "submit_final_ballot", [
      "ABCDEF",
      [f.players.killer, f.players["killer-wife"]],
      [],
    ]),
    /invalid ballot/,
  );
  await f.as("villager", "submit_final_ballot", [
    "ABCDEF",
    [f.players["killer-wife"]],
    [],
  ]);
  await db.exec("update public.rooms set v24=v24||jsonb_build_object('voteEndsAt',clock_timestamp()-interval '1 second')");
  const result = await view("host");
  assert.equal(result.winner, "killers");
  assert.deepEqual(result.v24.nominees, [f.players["killer-wife"]]);
});
test("new rules end for City when a bomb eliminates the original Killer", async () => {
  await db.exec(
    "update public.rooms set v24=v24||jsonb_build_object('finalVoteRules',true,'bombAt',clock_timestamp())",
  );
  await apply(await action("killer-wife"));
  await db.query("update public.rooms set phase='bomb-resolution',pending_bomber_id=$1", [f.players.bomber]);
  const result = await f.as("host", "resolve_bomb", ["ABCDEF", [f.players.killer]]);
  assert.equal(result.winner, "city");
  assert.equal(result.endGameResult.reason, "original-killer-eliminated");
  assert.equal((await f.state("killer-wife")).is_active_killer, true);
});
test("history lock removes earlier attack events from living players until the game ends", async () => {
  await db.exec(
    "update public.rooms set v24=v24||jsonb_build_object('finalVoteRules',true)",
  );
  await apply(await action("villager"));
  assert.ok((await view("reporter")).events.some((event) => event.type === "attack"));
  await db.exec("update public.rooms set v24=v24||jsonb_build_object('cutoffAt',clock_timestamp()-interval '1 second')");
  const living = await view("reporter");
  assert.equal(living.attackActivityHidden, true);
  assert.ok(!living.events.some((event) => event.type === "attack"));
  const host = await view("host");
  assert.equal(host.attackActivityHidden, false);
  assert.ok(host.events.some((event) => event.type === "attack"));
  await db.exec("update public.rooms set phase='ended'");
  assert.equal((await view("reporter")).attackActivityHidden, false);
});
test("private tables and internal engine cannot be invoked by a player", async () => {
  await assert.rejects(
    f.as("villager", "v24_tick", [f.roomId]),
    /permission denied/,
  );
  await assert.rejects(
    f.as("villager", "v24_resolve_vote", [f.roomId]),
    /permission denied/,
  );
  await assert.rejects(
    f.as("villager", "get_room_view_pre24", ["ABCDEF"]),
    /permission denied/,
  );
});
test("upgrade applies to existing schema and is repeatable without resetting rooms", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/20260909_v24.sql", import.meta.url),
    "utf8",
  );
  const finalVote = await readFile(
    new URL("../supabase/migrations/20260910_final_vote_and_history_lock.sql", import.meta.url),
    "utf8",
  );
  const reporterLimit = await readFile(
    new URL("../supabase/migrations/20260910_reporter_majority_limit.sql", import.meta.url),
    "utf8",
  );
  const privateStates = await readFile(
    new URL("../supabase/migrations/20260910_room_view_private_states.sql", import.meta.url),
    "utf8",
  );
  await db.exec(sql);
  await db.exec(finalVote);
  await db.exec(reporterLimit);
  await db.exec(privateStates);
  await db.exec(sql);
  await db.exec(finalVote);
  await db.exec(reporterLimit);
  await db.exec(privateStates);
  const room = await view("host");
  assert.equal(room.rulesVersion, "2.4");
  assert.equal(room.v24.finalVoteRules, undefined);
});
test("migration upgrades a genuine pre-v24 active database without changing its game", async () => {
  const oldDb = new PGlite();
  try {
    await initializeDatabase(
      oldDb,
      false,
      schema.split(/\r?\n-- BEGIN GENERATED V24 UPGRADE\r?\n/)[0],
    );
    const old = await fixture(oldDb, { legacySchema: true });
    await old.hit("athlete");
    const pending = await old.evidence("villager");
    const before = await old.state("athlete");
    const migration = await readFile(
      new URL("../supabase/migrations/20260909_v24.sql", import.meta.url),
      "utf8",
    );
    const attackActivity = await readFile(
      new URL("../supabase/migrations/20260909_attack_activity.sql", import.meta.url),
      "utf8",
    );
    const hostBomberJudgment = await readFile(
      new URL("../supabase/migrations/20260909_v24_host_bomber_judgment.sql", import.meta.url),
      "utf8",
    );
    const finalVote = await readFile(
      new URL("../supabase/migrations/20260910_final_vote_and_history_lock.sql", import.meta.url),
      "utf8",
    );
    const reporterLimit = await readFile(
      new URL("../supabase/migrations/20260910_reporter_majority_limit.sql", import.meta.url),
      "utf8",
    );
    const privateStates = await readFile(
      new URL("../supabase/migrations/20260910_room_view_private_states.sql", import.meta.url),
      "utf8",
    );
    await oldDb.exec(migration);
    await oldDb.exec(attackActivity);
    await oldDb.exec(hostBomberJudgment);
    await oldDb.exec(finalVote);
    await oldDb.exec(reporterLimit);
    await oldDb.exec(privateStates);
    const room = await old.as("host", "get_room_view", ["ABCDEF"]);
    assert.equal(room.rulesVersion, "legacy");
    assert.equal(room.phase, "active");
    assert.equal((await old.state("athlete")).hearts, before.hearts);
    assert.equal(
      room.evidences.find((e) => e.id === pending).status,
      "pending",
    );
    await old.as("host", "approve_evidence", ["ABCDEF", pending]);
    assert.equal((await old.state("villager")).hearts, 1);
  } finally {
    await oldDb.close();
  }
});
test("new room starts with Doctor and configurable schedule, no Sumo", async () => {
  await f.as("outsider", "create_room", ["NEWABC", "Host"]);
  assert.equal(
    (await f.as("outsider", "get_room_view", ["NEWABC"])).rulesVersion,
    "2.4",
  );
  for (const role of ["killer", "police", "sumo"]) {
    await f.as(role, "join_room", ["NEWABC", role]);
    await f.as(role, "select_avatar", [
      "NEWABC",
      role === "killer"
        ? "m-sea-01"
        : role === "police"
          ? "m-sea-02"
          : "m-sea-03",
    ]);
  }
  await f.as("outsider", "configure_v24", [
    "NEWABC",
    300,
    "Nearest within two metres; ties use seat order",
  ]);
  const result = await f.as("outsider", "start_game", [
    "NEWABC",
    { killer: 1, police: 1, doctor: 1 },
  ]);
  assert.equal(result.phase, "active");
  assert.equal(
    Date.parse(result.v24.finalAt) - Date.parse(result.v24.startedAt),
    300 * 60000,
  );
  assert.ok(
    Object.values(result.privateStates).some((s) => s.currentRole === "doctor"),
  );
  await assert.rejects(
    f.as("outsider", "configure_v24", ["NEWABC", 600, "Changed rule"]),
    /not allowed/,
  );
});
test("protection expires exactly at 45 minutes", async () => {
  const id = await action("villager");
  await db.query(
    "update public.player_secrets set protection_until=(select effective_at from public.v24_actions where id=$1) where player_id=$2",
    [id, f.players.villager],
  );
  await apply(id);
  assert.equal((await f.state("villager")).hearts, 1);
});
test("rolling attacks at exactly 60 minutes release quota", async () => {
  const id = await action("villager");
  for (const role of ["reporter", "athlete", "detective"])
    await action(role, { minutes: 63 });
  await db.query(
    "update public.v24_actions set status='approved',effective_at=(select effective_at from public.v24_actions where id=$1)-interval '60 minutes' where id<>$1",
    [id],
  );
  await apply(id);
  assert.equal((await f.state("villager")).hearts, 1);
});
test("second lethal hit within 60 minutes is refused; explosion does not use quota", async () => {
  await db.query(
    "update public.player_secrets set hearts=1 where player_id=any($1)",
    [[f.players.villager, f.players.reporter]],
  );
  await apply(await action("villager", { minutes: 4 }));
  await assert.rejects(apply(await action("reporter")), /rolling kill quota/);
});
test("heal adds one heart without changing protection, never heals self", async () => {
  await db.query(
    "update public.player_secrets set hearts=1,protection_until=clock_timestamp()+interval '30 minutes' where player_id=$1",
    [f.players.athlete],
  );
  const before = await f.state("athlete");
  await apply(await action("athlete", { kind: "heal", actor: "sumo" }));
  const after = await f.state("athlete");
  assert.equal(after.hearts, 2);
  assert.deepEqual(after.protection_until, before.protection_until);
  await assert.rejects(
    f.as("sumo", "use_doctor", ["ABCDEF", f.players.sumo]),
    /doctor ability unavailable/,
  );
});
test("four Doctor charges and exact 90 minute expiry", async () => {
  await db.query(
    "update public.player_secrets set doctor_uses=3,doctor_ready_at=clock_timestamp()-interval '1 second' where player_id=$1",
    [f.players.sumo],
  );
  await f.as("sumo", "use_doctor", ["ABCDEF", f.players.killer]);
  await db.query(
    "update public.player_secrets set doctor_ready_at=clock_timestamp()-interval '1 second' where player_id=$1",
    [f.players.sumo],
  );
  await assert.rejects(
    f.as("sumo", "use_doctor", ["ABCDEF", f.players.killer]),
    /doctor ability unavailable/,
  );
});
test("exact Hunt deadline kill is accepted; transform never resets Hunt", async () => {
  const id = await action("villager");
  await db.query(
    "update public.player_secrets set hearts=1 where player_id=$1",
    [f.players.villager],
  );
  await db.query(
    "update public.rooms set v24=v24||jsonb_build_object('huntDeadline',(select effective_at from public.v24_actions where id=$1))",
    [id],
  );
  const result = await apply(id);
  assert.equal(result.winner, null);
});
test("Hunt stops after cutoff when deadline is later", async () => {
  await db.exec(
    "update public.rooms set v24=v24||jsonb_build_object('cutoffAt',clock_timestamp()-interval '10 minutes','huntDeadline',clock_timestamp()-interval '3 minutes')",
  );
  const result = await view("host");
  assert.equal(result.winner, null);
  assert.equal(result.phase, "resolution");
});
test("Bomber kills at most one, can eliminate Killer, and never transforms Wife", async () => {
  await db.exec(
    "update public.rooms set phase='bomb-resolution',v24=v24||jsonb_build_object('bombAt',clock_timestamp())",
  );
  await db.query("update public.rooms set pending_bomber_id=$1", [
    f.players.bomber,
  ]);
  await assert.rejects(
    f.as("host", "resolve_bomb", [
      "ABCDEF",
      [f.players.killer, f.players.police],
    ]),
    /invalid bomb resolution/,
  );
  const result = await f.as("host", "resolve_bomb", [
    "ABCDEF",
    [f.players.killer],
  ]);
  assert.equal(result.winner, "city");
});
test("cutoff rejects new abilities and pending resolution delays Final safely", async () => {
  await action("villager");
  await db.exec(
    "update public.rooms set v24=v24||jsonb_build_object('cutoffAt',clock_timestamp()-interval '1 minute','finalAt',clock_timestamp()-interval '1 second')",
  );
  await assert.rejects(
    f.as("sumo", "use_doctor", ["ABCDEF", f.players.villager]),
    /doctor ability unavailable/,
  );
  await assert.rejects(
    f.as("reporter", "use_reporter", ["ABCDEF", f.players.villager]),
    /reporter ability unavailable/,
  );
  assert.equal((await view("host")).phase, "resolution");
});
test("v24 Reporter requires a strict living majority after its time tick", async () => {
  await db.query(
    "update public.players set health='dead' where id=any($1::uuid[])",
    [[
      f.players["killer-wife"],
      f.players.bomber,
      f.players.athlete,
      f.players.sumo,
    ]],
  );
  await f.as("reporter", "use_reporter", ["ABCDEF", f.players.villager]);
  await db.query(
    "update public.player_secrets set has_used_ability=false where player_id=$1",
    [f.players.reporter],
  );
  await db.query("update public.players set health='dead' where id=$1", [
    f.players.detective,
  ]);
  await assert.rejects(
    f.as("reporter", "use_reporter", ["ABCDEF", f.players.villager]),
    /reporter ability requires more than half of starting players alive/,
  );
  assert.equal((await f.state("reporter")).has_used_ability, false);
});
test("Police ranking controls tied nominees and fallback covers missing Police ballot", async () => {
  await voting();
  const ranking = [
    f.players.killer,
    ...Object.values(f.players).filter(
      (id) => ![f.players.killer, f.players.police].includes(id),
    ),
  ];
  await f.as("police", "submit_final_ballot", [
    "ABCDEF",
    [f.players.killer],
    ranking,
  ]);
  await f.as("villager", "submit_final_ballot", [
    "ABCDEF",
    [f.players.reporter],
    [],
  ]);
  await db.exec(
    "update public.rooms set v24=v24||jsonb_build_object('voteEndsAt',clock_timestamp()-interval '1 second')",
  );
  assert.deepEqual((await view("host")).v24.nominees, [f.players.killer]);
});
test("no ballots uses precommitted fallback, without revealing it", async () => {
  await voting();
  await db.exec(
    "update public.rooms set v24=v24||jsonb_build_object('voteEndsAt',clock_timestamp()-interval '1 second')",
  );
  assert.deepEqual((await view("host")).v24.nominees, [f.players.killer]);
});
test("live camera submissions reserve slots and rejection releases them", async () => {
  await f.evidence("villager");
  await f.evidence("reporter");
  await assert.rejects(f.evidence("athlete"), /pending evidence limit/);
  const eid = (
    await db.query("select evidence_id from public.v24_actions limit 1")
  ).rows[0].evidence_id;
  await f.as("host", "reject_evidence", ["ABCDEF", eid]);
  await f.evidence("athlete");
  assert.equal((await view("host")).v24.pendingAttacks, 2);
});
test("server scheduler ends a Hunt miss without any client reading the room", async () => {
  await db.exec(
    "update public.rooms set v24=v24||jsonb_build_object('huntDeadline',clock_timestamp()-interval '3 minutes'); select public.advance_v24_schedule()",
  );
  const result = (await db.query("select phase,winner from public.rooms"))
    .rows[0];
  assert.equal(result.phase, "ended");
  assert.equal(result.winner, "city");
});
test("five confirmed kills enter Final vote instead of auto-winning; delayed vote gets three minutes", async () => {
  for (let i = 0; i < 5; i++) {
    const id = await action("villager", { minutes: 60 + i * 60 });
    await db.query(
      "update public.v24_actions set status='approved',lethal=true where id=$1",
      [id],
    );
  }
  await db.exec(
    "update public.rooms set v24=v24||jsonb_build_object('cutoffAt',clock_timestamp()-interval '40 minutes','finalAt',clock_timestamp()-interval '10 minutes','huntDeadline',clock_timestamp()+interval '1 hour')",
  );
  const result = await view("host");
  assert.equal(result.phase, "secret-vote");
  assert.equal(result.winner, null);
  assert.equal(result.v24.nomineeCount, 1);
  assert.ok(Date.parse(result.v24.voteEndsAt) - Date.now() > 175000);
  assert.equal((await view("villager")).v24.fallback, undefined);
});
test("Final low-kill fallback and discussion phases follow server schedule", async () => {
  await db.exec(
    "update public.rooms set v24=v24||jsonb_build_object('cutoffAt',clock_timestamp()-interval '20 minutes','finalAt',clock_timestamp()+interval '5 minutes','huntDeadline',clock_timestamp()+interval '1 hour')",
  );
  assert.equal((await view("host")).phase, "final-discussion");
  await db.exec(
    "update public.rooms set v24=v24||jsonb_build_object('finalAt',clock_timestamp()-interval '1 second')",
  );
  const result = await view("host");
  assert.equal(result.winner, "city");
  assert.equal(result.endGameResult.reason, "final-low-kills");
});
test("legacy Police attack behavior survives alongside v24", async () => {
  await db.exec("update public.rooms set rules_version='legacy'");
  const result = await f.hit("police");
  assert.equal(result.winner, "city");
  assert.equal((await f.state("police")).hearts, 2);
});

test("v24 succession timeline uses effective time and remains private before game end", async () => {
  await db.query("update public.player_secrets set hearts=1 where player_id=$1", [f.players.police]);
  const id = await action("police", { minutes: 4 });
  const at = (await db.query("select effective_at from public.v24_actions where id=$1", [id])).rows[0].effective_at;
  await apply(id);
  const city = await view("villager");
  assert.equal(city.v24.milestones, undefined);
  assert.deepEqual(city.endGameTimeline ?? [], []);
  await db.query("select public.v24_finish($1,'city','all-killers-eliminated',clock_timestamp())", [f.roomId]);
  const ended = await view("villager");
  assert.equal(Date.parse(ended.endGameTimeline.find(e => e.kind === "detective-promoted").occurredAt), new Date(at).getTime());
});
