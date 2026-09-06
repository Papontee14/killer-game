# KILLER — 8-bit Neon review

This folder contains browser captures of the implemented UI, not image mockups.

Typography update (2026-09-06): Thai and Latin now use local TA 8 BIT. Entry screens and Host/player workflow captures were refreshed with this font. Other captures may show the previous typography. Font source and usage terms: [app/fonts/README.md](../../app/fonts/README.md).

## Entry screens

| Screen | 360px | 390px | 768px | 1440px |
| --- | --- | --- | --- | --- |
| Home | [View](home-360.png) | [View](home-390.png) | [View](home-768.png) | [View](home-1440.png) |
| Join | [View](join-360.png) | [View](join-390.png) | [View](join-768.png) | [View](join-1440.png) |
| Create | [View](host-360.png) | [View](host-390.png) | [View](host-768.png) | [View](host-1440.png) |
| Summary | [View](summary-360.png) | [View](summary-390.png) | [View](summary-768.png) | [View](summary-1440.png) |

## Game screens

- [Host lobby, mobile](../ux-review/host-lobby-360.png) · [Host lobby, desktop](../ux-review/host-lobby-1440.png)
- [Host active game, mobile](../ux-review/host-390.png) · [Host active game, desktop](../ux-review/host-1440.png)
- [Player waiting room](../ux-review/player-lobby-390.png) · [Player active game](../ux-review/player-390.png)
- [Evidence review](../ux-review/evidence-390.png) · [Camera preview](../ux-review/mission-preview.png) · [Invitation QR](../ux-review/invite-qr.png)
- [Generated artwork overview](assets.png)

Game captures use an isolated PostgreSQL fixture and intercepted Supabase transport. Names such as `killer` and `police` are test player names; public avatars do not represent their roles. These checks do not contact production or validate physical-device camera hardware.

## Artwork provenance

21 illustrations were generated with the built-in **imagegen** tool: 3 scene illustrations, 9 role portraits, a Host portrait, and 8 neutral avatars. The final WebP files live in [`public/pixel`](../../public/pixel). Their final prompts and original generated source locations are recorded in [`scripts/pixel-assets.json`](../../scripts/pixel-assets.json).

[`prepare-pixel-assets.cjs`](../../scripts/prepare-pixel-assets.cjs) packages the original images as WebP with nearest-neighbor resizing (1200px scenes, 512px role portraits, 128px avatars). It also creates the code-native pixel K PWA icons and the artwork overview. Original PNGs remain in the generator's directory; runtime uses only project-owned WebP files.

UI controls, text, pixel SVG icons and the KILLER wordmark are real components, separate from the illustrations. Evidence images, the camera feed and QR codes are not pixelated.

## Verification

Verified on 2026-09-06: production build (including lint and TypeScript) passed; 66 rule/service/session/concurrency tests passed; all 46 browser tests passed. Captures cover 360, 390, 768 and 1440px viewports. The local preview is available at `http://127.0.0.1:3000` while the development server is running.

Run `npm run typecheck`, `npm run build`, `npm test`, and `npm run test:browser`. Browser tests refresh these captures and exercise the new entry history, invitations, recovery, game creation, role privacy, camera evidence, Host actions and game completion.

No database migration, API change or production deployment is required by this redesign.
