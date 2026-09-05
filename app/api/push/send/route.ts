import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

function getAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey);
}

function initWebPush() {
  const publicKey =
    process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY ||
    process.env.WEB_PUSH_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_PRIVATE_KEY;
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || 'mailto:admin@killer.game';

  if (publicKey && privateKey) {
    webpush.setVapidDetails(siteUrl, publicKey, privateKey);
    return true;
  }
  return false;
}

export async function POST(req: Request) {
  try {
    const isConfigured = initWebPush();
    if (!isConfigured) {
      return NextResponse.json(
        { error: 'Web Push VAPID keys not configured on server' },
        { status: 503 },
      );
    }

    const body = await req.json();
    const { code, excludeUserId, targetUserId } = body;
    if (!code) {
      return NextResponse.json({ error: 'Missing room code' }, { status: 400 });
    }

    const supabase = getAdminSupabase();
    if (!supabase) {
      return NextResponse.json(
        { error: 'Supabase client unavailable' },
        { status: 500 },
      );
    }

    // Find the room
    const { data: room, error: roomErr } = await supabase
      .from('rooms')
      .select('id')
      .eq('code', String(code).trim().toUpperCase())
      .single();

    if (roomErr || !room) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }

    // Query active push subscriptions for this room
    let query = supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth, user_id')
      .eq('room_id', room.id);

    if (targetUserId) {
      query = query.eq('user_id', targetUserId);
    } else if (excludeUserId) {
      query = query.neq('user_id', excludeUserId);
    }

    const { data: subs, error: subErr } = await query;
    if (subErr) {
      return NextResponse.json({ error: subErr.message }, { status: 500 });
    }

    if (!subs || subs.length === 0) {
      return NextResponse.json({ sentCount: 0 });
    }

    // GAME_RULES.md:
    // "Notifications shown on a locked phone MUST be generic and must not leak role,
    //  target, heart, or inspection information. Full details appear only after the
    //  player opens the authenticated game view."
    const payload = JSON.stringify({
      title: 'KILLER',
      body: 'มีเหตุการณ์ใหม่ในห้อง เปิดเว็บเพื่อดูรายละเอียด',
      tag: 'killer-event',
      url: `/room/${encodeURIComponent(String(code).trim().toUpperCase())}`,
    });

    const deadSubscriptionIds: string[] = [];
    let sentCount = 0;

    await Promise.all(
      subs.map(async (sub) => {
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        };

        try {
          await webpush.sendNotification(pushSubscription, payload, {
            TTL: 60 * 60, // 1 hour
            urgency: 'high',
          });
          sentCount++;
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number })?.statusCode;
          // 404 or 410 means subscription is expired or unsubscribed
          if (statusCode === 404 || statusCode === 410) {
            deadSubscriptionIds.push(sub.id);
          }
        }
      }),
    );

    // Clean up expired subscriptions
    if (deadSubscriptionIds.length > 0) {
      await supabase
        .from('push_subscriptions')
        .delete()
        .in('id', deadSubscriptionIds);
    }

    return NextResponse.json({
      sentCount,
      expiredRemoved: deadSubscriptionIds.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
