import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { database, fixture } from './db-harness.mjs';

const migrationSql = await readFile(
  new URL('../supabase/migrations/20260923_private_realtime_broadcast.sql', import.meta.url),
  'utf8',
);

async function visibleMessageCount(db, userId, topic) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  await db.query("select set_config('realtime.topic',$1,false)", [topic]);
  await db.exec('set role authenticated');
  try {
    return (await db.query("select count(*)::int as count from realtime.messages where extension='broadcast' and topic=current_setting('realtime.topic')")).rows[0].count;
  } finally {
    await db.exec('reset role');
  }
}

test('room broadcasts are private, harmless invalidations and ignore heartbeat-only/no-op writes', async () => {
  const db = await database();
  try {
    const f = await fixture(db);
    await db.query('truncate realtime.broadcast_log');

    await f.as('sumo', 'heartbeat', ['ABCDEF']);
    await db.query("update public.rooms set phase=phase where code='ABCDEF'");
    assert.equal((await db.query('select count(*)::int as count from realtime.broadcast_log')).rows[0].count, 0);

    await db.query("update public.rooms set v24=v24||jsonb_build_object('testRealtime',true) where code='ABCDEF'");
    const messages = (await db.query('select topic,event,payload,is_private from realtime.broadcast_log')).rows;
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0], {
      topic: 'room:ABCDEF',
      event: 'room_changed',
      payload: { changedAt: messages[0].payload.changedAt },
      is_private: true,
    });
    assert.deepEqual(Object.keys(messages[0].payload), ['changedAt']);
  } finally {
    await db.close();
  }
});

test('room and user topics expose broadcasts only to their authorized member', async () => {
  const db = await database();
  try {
    const f = await fixture(db);
    await db.query("insert into realtime.messages(extension,topic,event,payload,is_private) values ('broadcast','room:ABCDEF','room_changed','{}',true),('broadcast',$1,'room_notification','{}',true)", [`user:${f.users.killer}`]);

    assert.equal(await visibleMessageCount(db, f.users.host, 'room:ABCDEF'), 1);
    assert.equal(await visibleMessageCount(db, f.users.outsider, 'room:ABCDEF'), 0);
    assert.equal(await visibleMessageCount(db, f.users.host, `user:${f.users.killer}`), 0);
    assert.equal(await visibleMessageCount(db, f.users.killer, `user:${f.users.killer}`), 1);
  } finally {
    await db.close();
  }
});

test('room notices broadcast only to their recipient and catch-up is scoped to room and user', async () => {
  const db = await database();
  try {
    const f = await fixture(db);
    await db.query('truncate realtime.broadcast_log');
    await db.query(
      `insert into public.room_notifications(room_id,recipient_user_id,event_key,kind,due_at,expires_at)
       values($1,$2,'test-notice','generic',clock_timestamp(),clock_timestamp()+interval '1 hour')`,
      [f.roomId, f.users.killer],
    );

    const broadcast = (await db.query('select topic,event,payload,is_private from realtime.broadcast_log')).rows[0];
    assert.equal(broadcast.topic, `user:${f.users.killer}`);
    assert.equal(broadcast.event, 'room_notification');
    assert.equal(broadcast.is_private, true);
    assert.equal(broadcast.payload.room_code, 'ABCDEF');
    assert.equal('recipient_user_id' in broadcast.payload, false);

    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [f.users.killer]);
    await db.exec('set role authenticated');
    const own = await db.query(
      "select id,kind,room_code from public.get_recent_room_notifications('ABCDEF',clock_timestamp()-interval '30 seconds')",
    );
    await db.exec('reset role');
    assert.equal(own.rows.length, 1);
    assert.equal(own.rows[0].room_code, 'ABCDEF');

    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [f.users.sumo]);
    await db.exec('set role authenticated');
    const otherMember = await db.query(
      "select id from public.get_recent_room_notifications('ABCDEF',clock_timestamp()-interval '30 seconds')",
    );
    await db.exec('reset role');
    assert.equal(otherMember.rows.length, 0);

    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [f.users.outsider]);
    await db.exec('set role authenticated');
    await assert.rejects(
      db.query("select id from public.get_recent_room_notifications('ABCDEF',clock_timestamp()-interval '30 seconds')"),
      /not allowed/,
    );
    await db.exec('reset role');
  } finally {
    await db.close();
  }
});

test('private Broadcast migration can be reapplied without changing game data', async () => {
  const db = await database();
  try {
    const f = await fixture(db);
    await db.exec(migrationSql);
    await db.exec(migrationSql);
    const room = (await db.query("select code,phase from public.rooms where id=$1", [f.roomId])).rows[0];
    assert.equal(room.code, 'ABCDEF');
    assert.equal(room.phase, 'active');
  } finally {
    await db.close();
  }
});
