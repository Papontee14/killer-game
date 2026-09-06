export type NotificationPermissionState =
  | 'default'
  | 'granted'
  | 'denied'
  | 'unsupported';

export type RoomNotificationKind =
  | 'generic'
  | 'evidence'
  | 'police-reminder';

export const POLICE_CHECK_REMINDER =
  '\u0e15\u0e33\u0e23\u0e27\u0e08\u0e08\u0e30\u0e17\u0e33\u0e01\u0e32\u0e23\u0e0a\u0e35\u0e49\u0e15\u0e31\u0e27\u0e43\u0e19 3 \u0e19\u0e32\u0e17\u0e35';
export const EVIDENCE_RECEIVED =
  '\u0e21\u0e35\u0e2b\u0e25\u0e31\u0e01\u0e10\u0e32\u0e19\u0e43\u0e2b\u0e21\u0e48\u0e23\u0e2d Host \u0e15\u0e23\u0e27\u0e08\u0e2a\u0e2d\u0e1a';

export function getNotificationPermission(): NotificationPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  try {
    const perm = await Notification.requestPermission();
    return perm;
  } catch {
    return 'denied';
  }
}

/**
 * Trigger generic notification according to GAME_RULES.md:
 * "Notifications shown on a locked phone MUST be generic and must not leak role,
 *  target, heart, or inspection information. Full details appear only after the
 *  player opens the authenticated game view."
 */
export async function showGenericNotification(
  message = 'มีเหตุการณ์ใหม่ในห้อง เปิดเว็บเพื่อดูรายละเอียด',
) {
  if (typeof window === 'undefined') return;
  if (!('Notification' in window) || Notification.permission !== 'granted')
    return;

  const title = 'KILLER';
  const options: NotificationOptions & { renotify: boolean; vibrate: number[] } = {
    body: message,
    tag: 'killer-event',
    icon: '/icon-192.png?v=8bit-1',
    badge: '/notification-badge.png?v=8bit-1',
    // Ask the OS for a visible, audible notification while the device is locked.
    // Android still decides whether the lock screen itself is illuminated.
    silent: false,
    renotify: true,
    requireInteraction: true,
    vibrate: [200, 100, 200],
  };

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      if (reg && reg.showNotification) {
        await reg.showNotification(title, options);
        return;
      }
    }
  } catch {
    // fallback to new Notification
  }

  try {
    new Notification(title, options);
  } catch {
    // Ignore notification instantiation failures (e.g. Android requires SW)
  }
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

/**
 * Schedule the three-minute police reminder for an open room view. When the
 * Host client reaches the reminder time it asks the server to fan the reminder
 * out to every registered device; each open room view also gets a local alert.
 */
export function schedulePoliceCheckReminder(
  code: string,
  policeCheckAt: string | undefined,
  isHost: boolean,
) {
  if (typeof window === 'undefined' || !policeCheckAt) return () => undefined;

  const reminderAt = Date.parse(policeCheckAt) - 3 * 60 * 1000;
  const delay = reminderAt - Date.now();
  // Do not show a stale “in 3 minutes” message after the reminder window.
  if (!Number.isFinite(reminderAt) || delay < -30 * 1000) return () => undefined;

  const storageKey = `killer_police_reminder:${code}:${policeCheckAt}`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const fire = () => {
    try {
      if (window.localStorage.getItem(storageKey)) return;
      window.localStorage.setItem(storageKey, '1');
    } catch {
      // Still show the notification when storage is unavailable.
    }
    void showGenericNotification(POLICE_CHECK_REMINDER);
    if (isHost) {
      void notifyRoomParticipants(code, undefined, undefined, 'police-reminder');
    }
  };

  timer = setTimeout(fire, Math.max(0, delay));
  return () => {
    if (timer) clearTimeout(timer);
  };
}

async function readyServiceWorker(): Promise<ServiceWorkerRegistration> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Service worker unavailable')), 12000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Register Web Push Subscription with server so notifications arrive
 * even when the mobile phone screen is locked or app is closed.
 */
export async function subscribeToWebPush(
  code: string,
  authToken: string,
): Promise<boolean> {
  if (
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator) ||
    !('PushManager' in window)
  ) {
    return false;
  }

  const publicKey = process.env.NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY;
  if (!publicKey) {
    return false;
  }

  try {
    const reg = await readyServiceWorker();
    if (!reg.pushManager) return false;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      signal: AbortSignal.timeout(12000),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({
        code,
        subscription: sub.toJSON(),
      }),
    });

    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Trigger server to dispatch Web Push notifications to all participants in the room
 */
export async function notifyRoomParticipants(
  code: string,
  excludeUserId?: string,
  targetUserId?: string,
  kind: RoomNotificationKind = 'generic',
) {
  try {
    await fetch('/api/push/send', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, excludeUserId, targetUserId, kind }),
    });
  } catch {
    // Non-blocking background call
  }
}
