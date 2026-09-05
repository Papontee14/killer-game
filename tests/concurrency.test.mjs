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
  await f.hit('sumo');
  const ids=[await f.evidence('sumo'),await f.evidence('athlete')];
  await db.exec('begin; select id from public.rooms for update;');
  const pending=Promise.allSettled(ids.map(id=>concurrent('host','approve_evidence',['ABCDEF',id])));
  await waitForLocks(2);await db.exec('commit');
  const results=await pending;
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.message.includes('quota')).length,1);
  assert.equal((await f.as('host','get_room_view',['ABCDEF'])).attacksThisHour,2);
  assert.equal((await f.state('sumo')).hearts+(await f.state('athlete')).hearts,5);
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
