# KILLER UX/UI review

The first pass improves readability, the Host workflow, and the case-file presentation using existing artwork. The follow-up adds Killer mission steps, room invitation links/QR, and privacy restoration. Gameplay, APIs, database schemas, and migrations are unchanged.

## Screenshots

- [Before: mobile landing](before-mobile.png) / [After: mobile landing](after-mobile.png)
- [Before: desktop landing](before-desktop.png) / [After: desktop landing](after-desktop.png)
- [Host overview at 360px](host-360.png) / [1440px](host-1440.png)
- [Host lobby at 360px](host-lobby-360.png) / [1440px](host-lobby-1440.png)
- [Player](player-390.png) / [Player lobby](player-lobby-390.png)
- [Evidence review](evidence-390.png)
- [Role reveal](role-reveal-360.png) / [End-game summary](end-game-360.png)
- [Room invitation QR](invite-qr.png) / [Mission preview and current step](mission-preview.png)

## Follow-up behavior

- Killer sees three steps with the current step highlighted, the remaining approved-photo quota, and the existing per-evidence Host review status.
- Host can open **ชวนเพื่อน · ลิงก์ / QR** in the lobby. QR and copied links contain only the current origin and room code. Valid `?room=ABCDEF` invitations prefill the join form and take precedence over automatic resume; the player still enters their name and confirms joining.
- QR generation runs locally using [node-qrcode](https://github.com/soldair/node-qrcode). Browser tests decode the rendered pixels with an independent decoder and check the destination.
- Privacy keeps the mounted screen, photo, target, dialog inputs, scroll, and focus in memory. Hidden content is removed from layout and accessibility, made inert, and native dialogs leave the top layer. Only the hidden flag is persisted in sessionStorage.
- Returning refreshes the room first. Old ability confirmations are cleared when their role, phase, ability state, or participant health becomes invalid. In-flight actions and room updates continue while hidden.

Before images are the saved landing-page captures from the earlier review. Internal pages use SQL-backed browser fixtures with sample players. The evidence fixture is a one-pixel test image; that screenshot validates the layout and controls, not real photographic content. Screenshots are full-page captures, so mobile pages may extend beyond one viewport.

## Validation

- Typecheck and production build pass.
- All 65 unit/integration tests pass.
- The 39 browser cases are verified: the full run passed 38 cases; the nine-role case timed out during role reveal and passed on an isolated rerun against the final source. Coverage includes camera flow, quota, evidence approval, role changes, recovery, and public-roster privacy.
- New cases decode the actual QR image, follow the invitation with an existing session, check clipboard fallback, verify mission steps, restore photo/target/scroll/focus, hide and reload role dialogs without acknowledgement, retain recovery and confirmation inputs, invalidate outdated abilities, and keep in-flight responses and game results private.
- Additional responsive checks exercise Host task order and navigation, lobby layout, and landing-page overflow at 360, 390, 768, and 1440px. At 360 × 800 and 390 × 844, the join submit button fits without scrolling before the keyboard opens.

Production deployment remains a separate step.
