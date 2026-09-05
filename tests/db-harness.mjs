import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export const schema = await readFile(
  new URL("../supabase/schema.sql", import.meta.url),
  "utf8",
);
export const migration = (
  await Promise.all(
    [
      "20260905_role_rules.sql",
      "20260905_room_closed_state.sql",
      "20260905_anonymous_attack_events.sql",
      "20260905_end_game_summary.sql",
      "20260905_submission_quota.sql",
      "20260905_restore_end_game_rpc.sql",
    ].map((file) =>
      readFile(
        new URL("../supabase/migrations/" + file, import.meta.url),
        "utf8",
      ),
    ),
  )
).join("\n");

// Actual PostgreSQL/PLpgSQL engine. Supabase-owned auth/storage tables are minimal
// local fixtures; this suite does not claim to test GoTrue, Storage HTTP, or Realtime.
export async function database() {
  const db = new PGlite();
  await initializeDatabase(db);
  return db;
}

export async function initializeDatabase(db, native = false) {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    grant usage on schema auth,storage to authenticated,anon;
    create table storage.buckets(id text primary key,name text,public boolean);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant select,insert,delete on storage.objects to authenticated;
    create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
  `);
  await db.exec(
    native
      ? schema
      : schema.replace(
          "create extension if not exists pgcrypto with schema extensions;",
          "-- pgcrypto unused by these functions; built-in gen_random_uuid is available.",
        ),
  );
}

export async function fixture(db) {
  await db.exec(
    "reset role; truncate public.rooms,auth.users,storage.objects cascade;",
  );
  const roles = [
    "killer",
    "killer-wife",
    "police",
    "reporter",
    "bomber",
    "detective",
    "athlete",
    "sumo",
    "villager",
  ];
  const users = Object.fromEntries(
    ["host", "outsider", ...roles].map((role) => [role, randomUUID()]),
  );
  for (const id of Object.values(users))
    await db.query("insert into auth.users(id) values($1)", [id]);
  async function as(role, fn, args = []) {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      users[role] ?? "",
    ]);
    await db.exec("set role authenticated");
    try {
      return (
        await db.query(
          `select public.${fn}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as result`,
          args,
        )
      ).rows[0].result;
    } finally {
      await db.exec("reset role");
    }
  }
  await as("host", "create_room", ["ABCDEF", "Moderator"]);
  const players = {};
  for (const role of roles)
    players[role] = (await as(role, "join_room", ["ABCDEF", role])).playerId;
  await as("host", "start_game", [
    "ABCDEF",
    Object.fromEntries(roles.map((role) => [role, 1])),
  ]);
  // Deterministic fixtures exercise each role; production start_game remains random.
  for (const role of roles) {
    const hearts =
      role === "killer" ? 0 : role === "athlete" ? 3 : role === "sumo" ? 4 : 2;
    await db.query(
      `update public.player_secrets set initial_role=$2,role_current=$2,team=$3,is_active_killer=$4,hearts=$5,max_hearts=$5 where player_id=$1`,
      [
        players[role],
        role,
        role === "killer" ? "killers" : "city",
        role === "killer",
        hearts,
      ],
    );
  }
  const roomId = (
    await db.query("select id from public.rooms where code='ABCDEF'")
  ).rows[0].id;
  async function evidence(target, sender = "killer", age = 0) {
    const storagePath = users[sender] + "/" + randomUUID() + ".jpg";
    await db.query(
      'insert into storage.objects(bucket_id,name,metadata) values(\'evidence\',$1,\'{"mimetype":"image/jpeg","size":100}\')',
      [storagePath],
    );
    await as(sender, "submit_evidence", [
      "ABCDEF",
      players[target],
      storagePath,
      new Date(Date.now() - age).toISOString(),
    ]);
    return (
      await db.query("select id from public.evidence where storage_path=$1", [
        storagePath,
      ])
    ).rows[0]?.id;
  }
  async function hit(target, sender = "killer") {
    const id = await evidence(target, sender);
    return as("host", "approve_evidence", ["ABCDEF", id]);
  }
  async function resetQuota() {
    await db.query(
      "update public.rooms set approved_attacks_in_window=0 where id=$1",
      [roomId],
    );
  }
  async function state(role) {
    return (
      await db.query(
        "select s.*,p.health from public.player_secrets s join public.players p on p.id=s.player_id where s.player_id=$1",
        [players[role]],
      )
    ).rows[0];
  }
  async function bomb(targets) {
    await db.query(
      "update public.rooms set phase='bomb-resolution',pending_bomber_id=$2 where id=$1",
      [roomId, players.bomber],
    );
    await db.query("update public.players set health='dead' where id=$1", [
      players.bomber,
    ]);
    return as("host", "resolve_bomb", [
      "ABCDEF",
      targets.map((role) => players[role]),
    ]);
  }
  return { as, users, players, roomId, evidence, hit, resetQuota, state, bomb };
}
