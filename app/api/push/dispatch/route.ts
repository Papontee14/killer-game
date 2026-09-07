import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

type ClaimedNotification = { id: string; room_id: string; room_code: string; recipient_user_id: string; kind: 'generic' | 'evidence' | 'police-reminder'; attempts: number };

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key) : null;
}
function configuredPush() {
  const publicKey = process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY || process.env.WEB_PUSH_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(process.env.NEXT_PUBLIC_SITE_URL || 'mailto:admin@killer.game', publicKey, privateKey);
  return true;
}
function permitted(req: Request) {
  const expected = process.env.PUSH_DISPATCH_SECRET;
  return Boolean(expected && req.headers.get('x-notification-dispatch-secret') === expected);
}
function genericBody(kind: ClaimedNotification['kind']) {
  if (kind === 'police-reminder') return 'ตำรวจจะทำการชี้ตัวใน 3 นาที';
  return 'มีเหตุการณ์ใหม่ในห้อง เปิดเว็บเพื่อดูรายละเอียด';
}
function retryAfterSeconds(error: unknown) {
  const raw = (error as { headers?: Record<string, string | undefined> })?.headers?.['retry-after'];
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) && value >= 0 ? Math.min(value, 300) : undefined;
}

export async function POST(req: Request) {
  if (!permitted(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!configuredPush()) return NextResponse.json({ error: 'Web Push is not configured' }, { status: 503 });
  const supabase = admin();
  if (!supabase) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  const { data, error } = await supabase.rpc('claim_room_notifications', { p_limit: 20 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const jobs = (data || []) as ClaimedNotification[];
  let acceptedByPushService = 0;

  await Promise.all(jobs.map(async (job) => {
    const { data: subscriptions, error: subscriptionsError } = await supabase.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('room_id', job.room_id).eq('user_id', job.recipient_user_id);
    if (subscriptionsError) {
      await supabase.from('room_notifications').update({ state: 'pending', lease_expires_at: null, last_error: 'subscription lookup failed' }).eq('id', job.id);
      return;
    }
    if (!subscriptions?.length) {
      await supabase.from('room_notifications').update({ state: 'sent', sent_at: new Date().toISOString(), lease_expires_at: null, last_error: null }).eq('id', job.id);
      return;
    }
    const { data: deliveries } = await supabase.from('push_notification_deliveries')
      .select('subscription_id, state').eq('notification_id', job.id);
    const completed = new Set((deliveries || []).filter((delivery) => delivery.state === 'sent' || delivery.state === 'failed').map((delivery) => delivery.subscription_id));
    const pendingSubscriptions = subscriptions.filter((subscription) => !completed.has(subscription.id));
    if (!pendingSubscriptions.length) {
      const failed = (deliveries || []).some((delivery) => delivery.state === 'failed');
      await supabase.from('room_notifications').update({ state: failed ? 'failed' : 'sent', sent_at: failed ? null : new Date().toISOString(), lease_expires_at: null, last_error: failed ? 'push delivery failed' : null }).eq('id', job.id);
      return;
    }
    const payload = JSON.stringify({ title: 'KILLER', body: genericBody(job.kind), notificationId: job.id, url: `/room/${encodeURIComponent(job.room_code)}` });
    let transient = false;
    let permanent = false;
    let retrySeconds: number | undefined;
    await Promise.all(pendingSubscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload, { TTL: 60 * 60, urgency: 'high' });
        acceptedByPushService++;
        await supabase.from('push_notification_deliveries').upsert({ notification_id: job.id, subscription_id: subscription.id, attempts: job.attempts, state: 'sent', sent_at: new Date().toISOString(), last_error: null });
      } catch (error: unknown) {
        const status = (error as { statusCode?: number }).statusCode;
        const expired = status === 404 || status === 410;
        const retryable = !status || status === 429 || status >= 500;
        transient ||= retryable;
        permanent ||= !retryable;
        retrySeconds = retryAfterSeconds(error) ?? retrySeconds;
        await supabase.from('push_notification_deliveries').upsert({ notification_id: job.id, subscription_id: subscription.id, attempts: job.attempts, state: retryable ? 'pending' : 'failed', last_error: expired ? 'subscription expired' : `push ${status || 'network'} failed` });
        if (expired) await supabase.from('push_subscriptions').delete().eq('id', subscription.id);
      }
    }));
    if (transient && job.attempts < 8) {
      const seconds = retrySeconds ?? Math.min(5 * 2 ** Math.max(0, job.attempts - 1), 300);
      await supabase.from('room_notifications').update({ state: 'pending', due_at: new Date(Date.now() + seconds * 1000).toISOString(), lease_expires_at: null, last_error: 'retry scheduled' }).eq('id', job.id);
    } else {
      await supabase.from('room_notifications').update({ state: permanent ? 'failed' : 'sent', sent_at: permanent ? null : new Date().toISOString(), lease_expires_at: null, last_error: permanent ? 'push delivery failed' : null }).eq('id', job.id);
    }
  }));
  return NextResponse.json({ claimed: jobs.length, acceptedByPushService });
}
