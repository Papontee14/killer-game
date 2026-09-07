import { test } from 'node:test';
import assert from 'node:assert/strict';
import { database, fixture } from './db-harness.mjs';

test('approved attack creates one durable generic notification per room member', async () => {
  const db = await database();
  try {
    await db.query("select set_config('app.notification_queue_enabled','off',false)");
    const f = await fixture(db);
    await db.query("select set_config('app.notification_queue_enabled','on',false)");
    await f.hit('sumo');
    const result = await db.query("select kind,count(*)::int count from public.room_notifications where event_key like 'event:%' group by kind");
    assert.deepEqual(result.rows, [{ kind: 'generic', count: 10 }]);
    const claimed = await db.query("select * from public.claim_room_notifications(20)");
    const generic = claimed.rows.filter((row) => row.kind === 'generic');
    assert.equal(generic.length, 10);
    assert.equal(new Set(generic.map((row) => row.recipient_user_id)).size, 10);
  } finally {
    await db.close();
  }
});

test('a rejected evidence notification is private to the killer and Host', async () => {
  const db = await database();
  try {
    await db.query("select set_config('app.notification_queue_enabled','off',false)");
    const f = await fixture(db);
    await db.query("select set_config('app.notification_queue_enabled','on',false)");
    const id = await f.evidence('sumo');
    await f.as('host', 'reject_evidence', ['ABCDEF', id]);
    const result = await db.query("select recipient_user_id from public.room_notifications where event_key like 'event:%'");
    assert.equal(result.rows.length, 2);
    assert.deepEqual(new Set(result.rows.map((row) => row.recipient_user_id)), new Set([f.users.host, f.users.killer]));
  } finally {
    await db.close();
  }
});
