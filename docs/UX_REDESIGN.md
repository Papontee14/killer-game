# KILLER — UX/UI implementation

The real application remains on `/`, `/room/[code]`, and `/room/[code]/host`. Room data, private role projections, abilities, evidence approval, and recovery use the existing Supabase RPCs; there is no production demo-data fallback.

## Design system

- `app/redesign.css`: dark green surfaces, muted green borders, neon green primary actions, red danger states, amber pending states; Thai Noto Sans typography; focus styles, 44–52px targets, safe-area navigation, reduced motion.
- `components/game-ui.tsx`: brand, native modal dialog with focus management, rules for all nine roles, private role reveal and transitions, recovery card, player/Host navigation, network state.
- Existing shared player rows, hearts, evidence cards, event feed, quota cards, and camera now use the same visual system. Public avatars are neutral initials. Public rows never show role or hearts.
- Player layouts support 360px/390px; Host uses a desktop sidebar and mobile bottom navigation.

## Connected paths

| Path | Implementation |
| --- | --- |
| Join / create / recover | Entry tabs, 6-character code, 24-character name, optional recovery credentials; same-device resume remains automatic |
| Lobby → role → play | Live roster, Host name, private recovery card, role reveal, acknowledgment, role-specific actions |
| Killer evidence | Living non-ally target → rear live camera → preview and two-minute timer → submit → shared status history; no gallery input or historical evidence image for players |
| Host review | Queue, enlarge private image, captured/submitted timestamps, approval/rejection, duplicate-action lock, quota and phase restrictions |
| Reporter | Target → confirmation → one-use action → private result in news; original role remains server-authoritative |
| Police | Thai-time schedule → suspect → consequence review → confirmation → winner/loser |
| Role changes | Live private wife-to-Killer and Detective-to-Police dialogs; current-role actions and hearts update |
| Bomber | Paused state → Host selects 0–2 living players → named consequence review → resolve |
| End / close | Player outcome and five-second countdown; Host stays to download ZIP and confirm closure |
| Leave / recover | Name-confirmed departure, recovery explanation, new-device restoration of the same player |
| System states | Offline/stale data with retry, permission denial, expired photo, empty lists, action errors in Thai, spectator state, closed-room state |

The archive now includes `game-summary.json` alongside evidence images, even if there are no images. A failed close can be retried without forcing another download of already removed images. Archives are Host-only; no player result screen reveals the full roster of roles.

## Database deployment

Apply `supabase/migrations/20260905_room_closed_state.sql` to the target Supabase database before deploying the UI. It adds `closedAt` to the existing authorized room projection, so devices already in a closed lobby can show the closed-room state. It does not change role access or game rules. The fresh schema and earlier role migration mirror the projection for consistent local tests. No remote migration or deployment was performed in this task.

## Validation

- `npm test`: rules, projection privacy, concurrent actions, session persistence, service worker privacy.
- `npm run test:browser`: real SQL fixtures through an intercepted Supabase transport; camera lifecycle, evidence, role abilities, all nine mobile variants, private transformations, recovery, responsive navigation, archive and closure.
- `npm run typecheck`, `npm run lint`, `npm run build`.
- Browser screenshots are generated in `test-results/redesign-desktop.png`, `redesign-mobile.png`, and `redesign-host.png`. Host review screenshots use consistent Thai names.

Browser tests validate SQL and UI integration. They do not replace device testing of real cameras, operating-system push delivery, or the deployed Supabase Auth/Storage/Realtime services.

## Image asset

Built-in imagegen generated `public/killer-night.png`. The supplied attachment contained text only, so this illustration follows the written visual direction, without claiming a match to an unavailable reference image. The hero is used only on entry, private role reveal, lobby and game-result surfaces; operational screens stay focused on data.

Final generation prompt:

> Use case: stylized-concept. Create a polished cinematic anime thriller illustration for the Thai secret-role party game KILLER, wide landscape 1536x1024. Three mysterious young adult characters in a rainy Bangkok night street: foreground black-haired young man in black jacket looking toward viewer, woman and another man behind him, each ambiguous and intriguing. Detailed hand-painted anime key visual, dramatic emerald green rim lighting and a little crimson neon, nearly black green shadows, city highrises and narrow alley, rain and reflective pavement, atmospheric fog. Characters compose the right half and center, left quarter mostly atmospheric dark city for text overlay. Elegant mature thriller mood, no gore, no weapons, no text, no letters, no logos, no UI. Intended to crop for mobile and desktop hero backgrounds.
