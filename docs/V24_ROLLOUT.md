# v2.4 rollout

1. Back up the database. Apply historical migrations in established order, then
   `supabase/migrations/20260909_v24.sql`. Do not replay old migrations over v2.4.
   Fresh installations use `supabase/schema.sql`.
2. Existing rooms retain `legacy`; new rooms default to `2.4`. Never mass-update
   running rooms or player secrets. Existing RPC implementations are preserved
   under server-only `_pre24` names.
3. Verify tables and RPC grants before deploying the compatible frontend. An old
   frontend cannot configure new v2.4 rooms. Keep the compatible frontend while
   any v2.4 game is running.
4. Verify server scheduling. If pg_cron exists, migration installs
   `killer-v24-clock` every minute. Existing `advance_notification_schedule()`
   also evaluates v2.4. Otherwise configure a trusted scheduler to POST
   `/api/game/tick` every minute with `Authorization: Bearer <GAME_TICK_SECRET>`.
   The route requires existing Supabase service-role environment settings.
5. Run a staging no-client Hunt timeout, pending-deadline evidence, Doctor heal,
   succession and a complete secret vote. Check push on a real phone. Local
   tests do not validate deployed Auth/Storage/Realtime/push configuration.

## Checks and monitoring

Run `npm run typecheck`, `npm run build`, `npm test`,
`npm run test:concurrency`, `npm run test:browser`. Run
`node scripts/sync-v24-schema.mjs` after migration edits to refresh the fresh
schema suffix; never edit historical migrations.

Monitor scheduler failures/last runs and rooms staying active past deadlines.
The two-minute upload allowance delays Hunt confirmation; pending events must be
resolved before declaring a miss. Result time remains the real deadline.
Host overrun delays Final but never reopens active play.

`v24_actions` retains effective times, approval, lethal and actual heal outcomes.
Use approved lethal actions for first-kill latency/inter-kill gaps, approved
attacks for attack rates, and heals for Doctor efficiency. `v24_ballots` retains
secret ballots/rankings for Host-authorized analysis. Winner reason codes separate
Hunt, lineage, all-Killer elimination, low kills and Final Vote.

Rollback is additive: keep data and the compatible frontend for running v2.4
rooms. If necessary suspend new v2.4 rooms by changing only the new-room default
back to `legacy`. Do not drop tables, wrappers or version fields mid-game.

## Doctor image

Built-in imagegen used the Reporter portrait as a style reference. Final asset:
`public/pixel/role-doctor.webp`, 512×512. `scripts/prepare-doctor-asset.mjs` packages
the generated PNG as WebP.

Prompt: Create a new Doctor role portrait matching the reference pixel art in
rendering style, square composition, dark near-black green background, muted olive
palette and green rim lighting. A distinct adult doctor, half-body portrait wearing
a medical coat with stethoscope, holding a small medical bag. Crisp detailed pixel
art with the same scale and atmosphere. No text, letters, logo, watermark or border.
Replace the reporter microphone and notebook with medical equipment.
