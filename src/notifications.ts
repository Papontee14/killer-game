export type NotificationPermissionState =
  | 'default'
  | 'granted'
  | 'denied'
  | 'unsupported';

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
  const options: NotificationOptions = {
    body: message,
    tag: 'killer-event',
    icon: '/manifest.webmanifest',
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
    const reg = await navigator.serviceWorker.ready;
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
) {
  try {
    await fetch('/api/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, excludeUserId }),
    });
  } catch {
    // Non-blocking background call
  }
}
