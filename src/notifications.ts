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
