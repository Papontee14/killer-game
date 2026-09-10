import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { database } from "./db-harness.mjs";
import { bounds, candidates, readPresets, recommend } from "../scripts/analyze-v24-balance.mjs";
import { readFile } from "node:fs/promises";
import ts from "typescript";

let db;
before(async () => { db = await database(); });
after(async () => { await db.close(); });

async function readPresetModule() {
  const source = await readFile(new URL("../src/v24-presets.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const module = { exports: {} };
  new Function("exports", "module", outputText)(module.exports, module);
  return module.exports;
}

test("Office and standard presets have the documented roles, duration, and Reporter threshold", async () => {
  const { V24_OFFICE_PRESETS: office, V24_STANDARD_12_PRESET: standard } = await readPresetModule();
  const expected = {
    5: [240, 2], 6: [240, 2], 7: [300, 3], 8: [300, 3],
    9: [360, 4], 10: [360, 5], 11: [420, 6],
  };
  assert.deepEqual(Object.keys(office).map(Number), [5, 6, 7, 8, 9, 10, 11]);
  for (const [players, [duration, villagers]] of Object.entries(expected)) {
    const preset = office[players];
    assert.equal(preset.playerCount, Number(players));
    assert.equal(preset.durationMinutes, duration);
    assert.equal(preset.roleCounts.killer, 1);
    assert.equal(preset.roleCounts.police, 1);
    assert.equal(preset.roleCounts.detective, 1);
    assert.equal(preset.roleCounts.villager, villagers);
    assert.equal(preset.roleCounts["killer-wife"], Number(players) >= 8 ? 1 : 0);
    assert.equal(preset.roleCounts.reporter, Number(players) >= 6 ? 1 : 0);
    assert.equal(preset.roleCounts.athlete + preset.roleCounts.doctor + preset.roleCounts.bomber + preset.roleCounts.sumo, 0);
    assert.equal(Object.values(preset.roleCounts).reduce((a, b) => a + b, 0), Number(players));
    if (preset.roleCounts.reporter) assert.equal(Math.floor(preset.playerCount / 2) + 1, Number(players) <= 7 ? 4 : Number(players) <= 9 ? 5 : 6);
  }
  assert.equal(standard.playerCount, 12);
  assert.equal(standard.durationMinutes, 600);
  assert.deepEqual(standard.roleCounts, { killer: 1, "killer-wife": 1, police: 1, detective: 1, reporter: 1, bomber: 1, athlete: 1, doctor: 1, villager: 4, sumo: 0 });
});

// Controlled snapshots isolate RPC boundaries; they are not played-game samples.
async function room(roles, { historicalDuration, legacy = false } = {}) {
  await db.exec("reset role; truncate public.rooms,auth.users,storage.objects cascade");
  const host = randomUUID(), id = randomUUID(), players = {};
  await db.query("insert into auth.users(id) values($1)", [host]);
  const duration = historicalDuration ?? 600;
  const base = Date.now() - (historicalDuration ? duration + 5 : 30) * 60000;
  await db.query(`insert into public.rooms(id,code,host_user_id,host_name,phase,rules_version,v24)
    values($1,'ABCDEF',$2,'Host','active',$3,$4::jsonb)`, [id, host, legacy ? "legacy" : "2.4", JSON.stringify({
    finalVoteRules: true, stage: "active", startedAt: new Date(base),
    finalAt: new Date(base + duration * 60000), cutoffAt: new Date(base + (duration - 30) * 60000),
    revealEndsAt: new Date(base + (duration - 120) * 60000), huntDeadline: new Date(base + 120 * 60000),
  })]);
  for (const role of roles) {
    let name = role;
    for (let i = 2; players[name]; i++) name = `${role}${i}`;
    const user = randomUUID(), player = randomUUID();
    await db.query("insert into auth.users(id) values($1)", [user]);
    await db.query("insert into public.players(id,room_id,user_id,name) values($1,$2,$3,$4)", [player, id, user, name]);
    const hp = role === "killer" ? 0 : role === "killer-wife" ? 1 : role === "athlete" ? 3 : 2;
    await db.query(`insert into public.player_secrets(player_id,initial_role,role_current,team,is_active_killer,hearts,max_hearts)
      values($1,$2,$2,$3,$4,$5,$5)`, [player, role, ["killer", "killer-wife"].includes(role) ? "killers" : "city", role === "killer", hp]);
    players[name] = { id: player, user, role };
  }
  async function as(name, fn, args = []) {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [name === "host" ? host : players[name].user]);
    await db.exec("set role authenticated");
    try { return (await db.query(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(",")}) result`, args)).rows[0].result; }
    finally { await db.exec("reset role"); }
  }
  const state = async name => (await db.query("select * from public.player_secrets where player_id=$1", [players[name].id])).rows[0];
  const dead = async names => db.query("update public.players set health='dead' where id=any($1::uuid[])", [names.map(name => players[name].id)]);
  const inspect = (target = "killer") => as("reporter", "use_reporter", ["ABCDEF", players[target].id]);
  return { id, players, base, as, state, dead, inspect };
}

for (let n = 5; n <= 12; n++) {
  test(`Reporter strict-majority RPC boundary for ${n} starting players`, async () => {
    const f = await room(["killer", "police", "reporter", ...Array(n - 3).fill("villager")]);
    const minimum = Math.floor(n / 2) + 1;
    const villagers = Object.keys(f.players).filter(x => x.startsWith("villager"));
    await f.dead(villagers.slice(0, n - minimum));
    const result = await f.inspect();
    assert.ok(result.events.some(e => e.message === "บทบาทเริ่มต้นของ killer คือ killer"));
    assert.equal((await f.state("reporter")).has_used_ability, true);
    await db.query("update public.player_secrets set has_used_ability=false where player_id=$1", [f.players.reporter.id]);
    // At N=5 only K/P/R remain: removing Police here isolates the gate, not a
    // reachable ongoing game (normal lineage resolution would end that game).
    await f.dead([villagers[n - minimum] ?? "police"]);
    await assert.rejects(f.inspect(), /requires more than half/);
    assert.equal((await f.state("reporter")).has_used_ability, false);
  });
}

test("candidate enumeration and chosen presets preserve a conservative City voting majority", async () => {
  const presets = await readPresets();
  let count = 0;
  for (let n = 5; n <= 12; n++) {
    const rows = candidates(n); count += rows.length;
    for (const row of rows) {
      assert.equal(Object.values(row.roleCounts).reduce((a, b) => a + b, 0), n);
      assert.ok(row.durationMinutes >= 180 && row.durationMinutes <= 600);
      assert.equal(row.durationMinutes % 30, 0);
      assert.equal(row.roleCounts.killer, 1); assert.equal(row.roleCounts.police, 1);
      for (const [role, amount] of Object.entries(row.roleCounts)) {
        assert.ok(Number.isInteger(amount) && amount >= 0 && amount <= (role === "villager" ? 20 : 1));
      }
    }
    const chosen = recommend(n), actual = presets[n];
    assert.equal(actual.playerCount, n);
    assert.deepEqual(actual.roleCounts, chosen.roleCounts);
    assert.equal(actual.durationMinutes, chosen.durationMinutes);
    assert.ok(chosen.cityFloor > chosen.killerVotes);
  }
  assert.equal(count, 7230);
  // A death at cutoff cannot be submitted; just after the boundary can allow it.
  assert.equal(bounds(8, presets[8].roleCounts, 255).normalKillUpper, 3);
  assert.equal(bounds(8, presets[8].roleCounts, 256).normalKillUpper, 4);
});

test("Reporter observes initial roles and keeps scan results private after transformation/succession", async () => {
  const f = await room(["killer", "killer-wife", "police", "detective", "reporter", "villager", "villager"]);
  await db.query("update public.player_secrets set is_active_killer=true,hearts=0,max_hearts=0 where player_id=$1", [f.players["killer-wife"].id]);
  await f.dead(["police"]);
  await db.query("select public.v24_victory($1,clock_timestamp())", [f.id]);
  assert.equal((await f.state("detective")).role_current, "police");
  for (const name of ["killer-wife", "detective", "villager"]) {
    await db.query("update public.player_secrets set has_used_ability=false where player_id=$1", [f.players.reporter.id]);
    const result = await f.inspect(name);
    assert.ok(result.events.some(e => e.message === `บทบาทเริ่มต้นของ ${name} คือ ${name}`));
  }
  const outsider = await f.as("villager2", "get_room_view", ["ABCDEF"]);
  assert.ok(outsider.events.some(e => e.message === "Reporter has used an ability."));
  assert.ok(!outsider.events.some(e => e.message.startsWith("บทบาทเริ่มต้นของ")));
  const target = await f.as("villager", "get_room_view", ["ABCDEF"]);
  assert.ok(target.events.some(e => e.message === "คุณถูกตรวจบทบาท"));
});

test("pending lethal evidence does not reduce the living count for a Reporter scan", async () => {
  const f = await room(["killer", "police", "reporter", "villager", "villager", "villager"]);
  await f.dead(["villager2", "villager3"]);
  await db.query("update public.player_secrets set hearts=1 where player_id=$1", [f.players.villager.id]);
  const { rows } = await db.query(`insert into public.v24_actions(room_id,actor_id,target_id,kind,effective_at)
    values($1,$2,$3,'attack',clock_timestamp()-interval '3 minutes') returning id`, [f.id, f.players.killer.id, f.players.villager.id]);
  await f.inspect("villager");
  await f.as("host", "v24_apply", ["ABCDEF", rows[0].id, true]);
  assert.equal((await f.state("reporter")).has_used_ability, true);
  const result = await f.as("reporter", "get_room_view", ["ABCDEF"]);
  assert.ok(result.events.some(e => e.message === "บทบาทเริ่มต้นของ villager คือ villager"));
});

test("Reporter can scan during pending bomb, but its extra victim can close the majority window", async () => {
  const f = await room(["killer", "police", "reporter", "bomber", "villager", "villager", "villager"]);
  await f.dead(["bomber", "villager2", "villager3"]);
  await db.query("update public.rooms set phase='bomb-resolution',pending_bomber_id=$2,v24=v24||jsonb_build_object('bombAt',clock_timestamp()) where id=$1", [f.id, f.players.bomber.id]);
  await f.inspect();
  await db.query("update public.player_secrets set has_used_ability=false where player_id=$1", [f.players.reporter.id]);
  await f.as("host", "resolve_bomb", ["ABCDEF", [f.players.villager.id]]);
  await assert.rejects(f.inspect(), /requires more than half/);
  assert.equal((await f.state("reporter")).has_used_ability, false);
});

test("Reporter rejects dead actors and cutoff, and Hunt expiry returns ended without consuming ability", async () => {
  const roles = ["killer", "police", "reporter", "villager", "villager", "villager"];
  let f = await room(roles);
  await f.dead(["reporter"]);
  await assert.rejects(f.inspect(), /reporter ability unavailable/);
  f = await room(roles);
  await db.query("update public.rooms set v24=v24||jsonb_build_object('cutoffAt',clock_timestamp()) where id=$1", [f.id]);
  await assert.rejects(f.inspect(), /reporter ability unavailable/);
  f = await room(roles);
  await db.query("update public.rooms set v24=v24||jsonb_build_object('huntDeadline',clock_timestamp()-interval '3 minutes') where id=$1", [f.id]);
  const result = await f.inspect();
  assert.equal(result.actionError, "game_ended");
  assert.equal(result.winner, "city");
  assert.equal((await f.state("reporter")).has_used_ability, false);
  await assert.rejects(f.inspect(), /reporter ability unavailable/);
});

test("current legacy wrapper also enforces the Reporter majority gate", async () => {
  const f = await room(["killer", "police", "reporter", "villager", "villager", "villager"], { legacy: true });
  await f.dead(["villager", "villager2", "villager3"]);
  await assert.rejects(f.inspect(), /requires more than half/);
  assert.equal((await f.state("reporter")).has_used_ability, false);
});

// Validate a reachable attack schedule against actual ordered SQL resolution.
// Historical pending rows bypass camera submission; capture/approval spacing
// below also allows one-at-a-time uploads and approvals within three minutes.
test("old eight-player preset permits a legal five-kill path to a forced 2:1 vote", async () => {
  const f = await room(["killer", "killer-wife", "police", "detective", "reporter", "villager", "villager", "villager"], { historicalDuration: 360 });
  const events = [[0,"killer-wife"], [3,"detective"], [48,"detective"],
    [60,"reporter"], [108,"reporter"], [120,"villager"], [168,"villager"],
    [180,"villager2"], [228,"villager2"], [240,"villager3"], [288,"villager3"]];
  const actions = [];
  for (const [minute, name] of events) {
    const { rows } = await db.query(`insert into public.v24_actions(room_id,actor_id,target_id,kind,effective_at)
      values($1,$2,$3,'attack',$4) returning id`, [f.id, f.players.killer.id, f.players[name].id, new Date(f.base + minute * 60000)]);
    actions.push(rows[0].id);
  }
  for (const id of actions) {
    const result = await f.as("host", "v24_apply", ["ABCDEF", id, true]);
    assert.equal(result.winner, null);
  }
  assert.equal((await db.query("select count(*)::int count from public.v24_actions where lethal and status='approved'")).rows[0].count, 5);
  assert.equal((await f.state("killer-wife")).is_active_killer, true);
  const alive = (await db.query("select name from public.players where health<>'dead' order by name")).rows.map(x => x.name);
  assert.deepEqual(alive, ["killer", "killer-wife", "police"]);
  await f.as("killer", "submit_final_ballot", ["ABCDEF", [f.players.police.id], []]);
  await f.as("killer-wife", "submit_final_ballot", ["ABCDEF", [f.players.police.id], []]);
  await f.as("police", "submit_final_ballot", ["ABCDEF", [f.players.killer.id], [f.players.killer.id, f.players["killer-wife"].id]]);
  await db.query("update public.rooms set v24=v24||jsonb_build_object('voteEndsAt',clock_timestamp()-interval '1 second') where id=$1", [f.id]);
  const result = await f.as("host", "get_room_view", ["ABCDEF"]);
  assert.equal(result.winner, "killers");
  assert.equal(result.endGameResult.reason, "final-vote");
});

test("late Wife awakening and paced Hunt kills remain possible under the revised twelve-player time", async () => {
  const f = await room(["killer", "killer-wife", "police", "detective", "reporter", "bomber", "doctor", "athlete", ...Array(4).fill("villager")], { historicalDuration: 390 });
  const events = [[74,"villager"], [119,"villager"], [150,"killer-wife"],
    [194,"villager2"], [239,"villager2"], [314,"villager3"], [359,"villager3"]];
  const actions = [];
  for (const [minute, name] of events) {
    const { rows } = await db.query(`insert into public.v24_actions(room_id,actor_id,target_id,kind,effective_at)
      values($1,$2,$3,'attack',$4) returning id`, [f.id, f.players.killer.id, f.players[name].id, new Date(f.base + minute * 60000)]);
    actions.push(rows[0].id);
  }
  for (const id of actions) assert.equal((await f.as("host", "v24_apply", ["ABCDEF", id, true])).winner, null);
  const result = await f.as("host", "get_room_view", ["ABCDEF"]);
  assert.equal(result.v24.stage, "secret-vote");
  assert.equal((await db.query("select count(*)::int count from public.v24_actions where lethal and status='approved'")).rows[0].count, 3);
  assert.equal(Date.parse(result.v24.huntDeadline), f.base + 479 * 60000);
});

for (const victim of [null, "killer", "killer-wife", "police", "detective", "reporter", "last-police"]) {
  test(`Bomber resolution consequence: ${victim ?? "no victim"}`, async () => {
    const f = await room(["killer", "killer-wife", "police", "detective", "reporter", "bomber", "villager"]);
    await db.query("update public.player_secrets set is_active_killer=true,hearts=0,max_hearts=0 where player_id=$1", [f.players["killer-wife"].id]);
    if (victim === "last-police") await f.dead(["detective"]);
    await db.query("update public.player_secrets set hearts=1 where player_id=$1", [f.players.bomber.id]);
    const { rows } = await db.query(`insert into public.v24_actions(room_id,actor_id,target_id,kind,effective_at)
      values($1,$2,$3,'attack',clock_timestamp()-interval '3 minutes') returning id`, [f.id, f.players.killer.id, f.players.bomber.id]);
    const paused = await f.as("host", "v24_apply", ["ABCDEF", rows[0].id, true]);
    assert.equal(paused.phase, "bomb-resolution");
    const target = victim === "last-police" ? "police" : victim;
    const result = await f.as("host", "resolve_bomb", ["ABCDEF", target ? [f.players[target].id] : []]);
    assert.equal(result.winner, victim === "killer" ? "city" : victim === "last-police" ? "killers" : null);
    assert.equal(result.v24.huntDeadline, paused.v24.huntDeadline);
    if (victim === "police") {
      assert.equal((await f.state("detective")).role_current, "police");
      assert.equal((await f.state("detective")).hearts, 2);
    }
    if (result.winner) await assert.rejects(f.as("host", "v24_apply", ["ABCDEF", rows[0].id, true]), /not allowed/);
  });
}

for (const scenario of ["coordinated", "split", "abstain", "tie-police-first", "tie-police-last"]) {
  test(`five living voters: ${scenario}`, async () => {
    const f = await room(["killer", "killer-wife", "police", "villager", "villager"]);
    const ranking = ["killer", "killer-wife", "villager", "villager2"].map(x => f.players[x].id);
    const fallback = scenario === "tie-police-last" ? [...ranking, f.players.police.id] : [f.players.police.id, ...ranking];
    await db.query(`update public.rooms set v24=v24||jsonb_build_object('stage','secret-vote','cutoffAt',clock_timestamp()-interval '30 minutes',
      'finalAt',clock_timestamp()-interval '1 minute','voteEndsAt',clock_timestamp()+interval '3 minutes',
      'nomineeCount',1,'fallback',$2::jsonb,'voters',$2::jsonb) where id=$1`, [f.id, JSON.stringify(fallback)]);
    const ballots = { killer: "police", "killer-wife": "police", police: "killer" };
    if (scenario === "coordinated") Object.assign(ballots, { villager: "killer", villager2: "killer" });
    if (scenario === "split") Object.assign(ballots, { villager: "killer-wife", villager2: "villager" });
    if (scenario.startsWith("tie-")) ballots.villager = "killer";
    for (const [voter, target] of Object.entries(ballots)) await f.as(voter, "submit_final_ballot", ["ABCDEF", [f.players[target].id], voter === "police" ? ranking : []]);
    await db.query("update public.rooms set v24=v24||jsonb_build_object('voteEndsAt',clock_timestamp()-interval '1 second') where id=$1", [f.id]);
    const result = await f.as("host", "get_room_view", ["ABCDEF"]);
    assert.equal(result.winner, ["coordinated", "tie-police-last"].includes(scenario) ? "city" : "killers");
  });
}
