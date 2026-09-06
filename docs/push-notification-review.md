# 8-bit icon and background notification review — 2026-09-06

## Assets

Generated using the built-in image_gen tool from the user's attached icon. Source: `public/pixel/killer-icon-8bit-source.png`. Rebuild derivatives with `node scripts/generate-icons.mjs` (Playwright Chromium required). The generator uses nearest-neighbour resizing; the separate maskable asset keeps the complete artwork inside its safe circle. Android's small notification badge uses a transparent white pixel knife; the full notification icon uses the colour artwork. Manifest, Apple touch icon and notification URLs are versioned to avoid reusing old cached assets. Installed launchers may take time to refresh; reinstall if the old icon persists.

Final image-generation prompt:
> Use case: style-transfer. Edit the attached game app icon into authentic crisp 8-bit pixel art. Preserve the large diagonal knife from lower left to upper right, sinister green eyes in its blade, neon green blade edge and red handle edge, shadowy ghost figures behind it, and four white corner brackets. Square full-bleed very dark background. Simplify into a cohesive limited palette with large hard square pixels and stair-stepped edges, no smooth gradients, no glossy 3D rendering, no text. Keep the knife clearly readable as a small installed app and notification icon, with main subject within central 80 percent. Save the resulting image.

## What was verified

- The existing sender calls web-push with high urgency and a one-hour TTL. The service worker handles incoming push without an open page, uses waitUntil, and displays generic text without exposing roles or targets.
- Local VAPID public/private keys and Supabase service-role configuration are present. The connected database has the push_subscriptions table and six registered subscriptions. Counts do not establish that subscriptions are still deliverable. No notifications were sent to existing players during review.
- The permission button now reports ready only when device registration succeeds; failure is visible and can be retried. Waiting for service-worker readiness and the registration HTTP response is bounded to avoid an indefinitely pending button.
- The browser's dispatch request uses keepalive so ordinary navigation does not cancel it.
- Automated tests exercise registration success/failure, existing/new subscriptions, missing configuration, keepalive and a push handler with no page context. This is a simulation, not a physical phone lock-screen test.

## Remaining delivery limits

An installed app with notification permission and a valid server subscription can receive Web Push with its screen locked. iPhone/iPad requires a Home Screen web app on iOS/iPadOS 16.4 or later. Lock-screen visibility, sound, screen wake and delivery timing remain subject to OS notification settings, Focus/Do Not Disturb, connectivity and power policies.

Game mutations currently trigger the push HTTP request from the acting browser after its RPC and room refresh. This is not a durable server-side event queue: closing or losing connection immediately after the mutation can still lose the dispatch. Deadline transitions are evaluated when room state is loaded; there is no independent scheduled job to send time-based reminders while every device is asleep. This review does not add such a scheduler.

Production deployment/environment and actual mobile delivery have not been verified. Changes are in the local workspace.

## Physical device acceptance check

1. Deploy the updated build to the HTTPS game origin. Confirm VAPID keys and service-role credentials there, and the push-subscription migration.
2. Install/open the app on a phone (Home Screen on iOS), join a test room, allow notifications, and wait for the ready label. Enable Lock Screen notifications in device settings.
3. Lock the receiving phone for at least five minutes. From a second device, perform a game action in that test room, such as starting the game.
4. Confirm a generic KILLER notification arrives, inspect its icon, and tap it to reopen the room. Repeat with the app closed and with each supported phone OS.
5. Test timed reminders separately: the current app cannot guarantee them while all clients are asleep.

References:
- https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation
