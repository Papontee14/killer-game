import {before,after,beforeEach,afterEach,test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {nativeDatabase} from './native-db.mjs';
import {fixture} from './db-harness.mjs';
let server,db,f;
before(async()=>{server=await nativeDatabase();db=server.db;});
after(async()=>{await server?.close();});
beforeEach(async()=>{f=await fixture(db);});
afterEach(async()=>{await db?.exec('rollback');});
async function v24() {
  await db.exec("update public.rooms set rules_version='2.4',v24=jsonb_build_object('stage','active','startedAt',clock_timestamp()-interval '1 hour','cutoffAt',clock_timestamp()+interval '8 hours','finalAt',clock_timestamp()+interval '9 hours','huntDeadline',clock_timestamp()+interval '1 hour')");
  await db.query("update public.player_secrets set role_current='doctor',initial_role='doctor',doctor_uses=0 where player_id=$1",[f.players.sumo]);
}
test('v24 concurrent Doctor uses consume exactly one charge',async()=>{
  await v24();
  const results=await Promise.allSettled(['villager','athlete'].map(role=>concurrent('sumo','use_doctor',['ABCDEF',f.players[role]])));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1); assert.equal((await f.state('sumo')).doctor_uses,1);
});
test('v24 repeated concurrent approval applies damage only once',async()=>{
  await v24();
  const id=(await db.query("insert into public.v24_actions(room_id,actor_id,target_id,kind,effective_at) values($1,$2,$3,'attack',clock_timestamp()-interval '3 minutes') returning id",[f.roomId,f.players.killer,f.players.villager])).rows[0].id;
  await Promise.all([0,1].map(()=>concurrent('host','v24_apply',['ABCDEF',id,true])));
  assert.equal((await f.state('villager')).hearts,1);
  assert.equal((await db.query("select count(*)::int n from public.v24_actions where status='approved'")).rows[0].n,1);
});
test('v24 racing ballots retain a single immutable vote',async()=>{
  await v24(); const ids=Object.values(f.players);
  await db.query("update public.rooms set v24=v24||jsonb_build_object('stage','secret-vote','cutoffAt',clock_timestamp()-interval '30 minutes','finalAt',clock_timestamp()-interval '1 minute','voteEndsAt',clock_timestamp()+interval '2 minutes','nomineeCount',1,'fallback',$1::jsonb,'voters',$1::jsonb)",[JSON.stringify(ids)]);
  await Promise.all(['killer','police'].map(role=>concurrent('villager','submit_final_ballot',['ABCDEF',[f.players[role]],[]])));
  assert.equal((await db.query('select count(*)::int n from public.v24_ballots')).rows[0].n,1);
});
test('v24 Reporter waiting on a room lock cannot cross cutoff',async()=>{
  await v24();
  await db.exec("begin; update public.rooms set v24=v24||jsonb_build_object('cutoffAt',clock_timestamp()+interval '1 second')");
  const pending=Promise.allSettled([concurrent('reporter','use_reporter',['ABCDEF',f.players.villager])]);
  await waitForLocks(1);
  await waitFor(async()=>(await db.query("select clock_timestamp()>=(v24->>'cutoffAt')::timestamptz as due from public.rooms")).rows[0].due);
  await db.exec('commit');
  assert.equal((await pending)[0].status,'rejected');assert.equal((await f.state('reporter')).has_used_ability,false);
});
async function concurrent(role,fn,args) {
  const client=await server.newClient();
  try {
    await client.query('begin');
    await client.query("select set_config('request.jwt.claim.sub',$1,true)",[f.users[role]]);
    await client.query('set local role authenticated');
    const result=await client.query(`select public.${fn}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as result`,args);
    await client.query('commit'); return result.rows[0].result;
  } catch(e) {await client.query('rollback');throw e;} finally {await client.end();}
}
async function waitFor(predicate) {
  const start=Date.now();
  while(!await predicate()) {if(Date.now()-start>5000) throw Error('Timed out waiting for database lock');await delay(20);}
}
async function waitForLocks(count) {
  await waitFor(async()=>{
    await db.query('select pg_stat_clear_snapshot()');
    return (await db.query("select count(*)::int n from pg_stat_activity where wait_event_type='Lock' and pid<>pg_backend_pid()")).rows[0].n>=count;
  });
}

test('two approvals racing for the final quota unit: exactly one commits',async()=>{
  await db.query("update public.rooms set approved_attacks_in_window=1");
  await db.query("update public.player_secrets set hearts=1 where player_id=any($1::uuid[])",[ [f.players.sumo,f.players.athlete] ]);
  await db.query("update public.players set health='critical' where id=any($1::uuid[])",[ [f.players.sumo,f.players.athlete] ]);
  const ids=[await f.evidence('sumo'),await f.evidence('athlete')];
  await db.exec('begin; select id from public.rooms for update;');
  const pending=Promise.allSettled(ids.map(id=>concurrent('host','approve_evidence',['ABCDEF',id])));
  await waitForLocks(1);await db.exec('commit');
  const results=await pending;
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.message.includes('quota')).length,1);
  assert.equal((await f.as('host','get_room_view',['ABCDEF'])).killsThisHour,2);
  assert.equal((await f.state('sumo')).hearts+(await f.state('athlete')).hearts,1);
});

test('two Reporter requests consume exactly one ability and emit one public announcement',async()=>{
  const results=await Promise.allSettled(['killer','sumo'].map(role=>concurrent('reporter','use_reporter',['ABCDEF',f.players[role]])));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await db.query("select count(*)::int n from public.room_events where message='Reporter has used an ability.'")).rows[0].n,1);
});

test('target dying while Reporter waits for lock refuses inspection without spending ability',async()=>{
  await db.exec('begin; select id from public.rooms for update;');
  await db.query("update public.players set health='dead' where id=$1",[f.players.sumo]);
  const pending=Promise.allSettled([concurrent('reporter','use_reporter',['ABCDEF',f.players.sumo])]);
  await waitForLocks(1);await db.exec('commit');
  assert.equal((await pending)[0].status,'rejected');
  assert.equal((await f.state('reporter')).has_used_ability,false);
});

test('Reporter rechecks the majority limit after waiting for a room lock',async()=>{
  await db.query("update public.players set health='dead' where id=any($1::uuid[])",[[f.players.killer,f.players['killer-wife'],f.players.bomber]]);
  await db.exec('begin; select id from public.rooms for update;');
  const pending=Promise.allSettled([concurrent('reporter','use_reporter',['ABCDEF',f.players.athlete])]);
  await waitForLocks(1);
  await db.query("update public.players set health='dead' where id=any($1::uuid[])",[[f.players.police,f.players.sumo]]);
  await db.exec('commit');
  const result=(await pending)[0];
  assert.equal(result.status,'rejected');
  assert.match(result.reason.message,/reporter ability requires more than half of starting players alive/);
  assert.equal((await f.state('reporter')).has_used_ability,false);
  assert.equal((await db.query("select count(*)::int n from public.room_events where message='Reporter has used an ability.'")).rows[0].n,0);
});

test('approval begun before deadline but blocked on a lock uses time after lock acquisition',async()=>{
  const id=await f.evidence('sumo');
  await db.exec("begin; update public.rooms set police_check_at=clock_timestamp()+interval '1 second'");
  const pending=concurrent('host','approve_evidence',['ABCDEF',id]);
  await waitForLocks(1);
  await waitFor(async()=>(await db.query('select clock_timestamp()>police_check_at as due from public.rooms')).rows[0].due);
  await db.exec('commit');
  const result=await pending;
  assert.equal(result.actionError,'accusation_started');
  assert.equal(result.phase,'police-check');
  assert.equal((await f.state('sumo')).hearts,4);
});
