# Role rules update

Apply `supabase/migrations/20260905_role_rules.sql` to an installation already using
the current rooms/player_secrets/evidence schema. Use `supabase/schema.sql` only
for a fresh project. The upgrade is transactional and repeatable; it does not
reset roles, hearts, evidence decisions, events, sessions or quota counters.

## Deploy order

1. Back up the target database and verify this migration in a separate Supabase
   test project first. Do not run the test fixture harness against production.
2. Apply the migration in SQL Editor. It adds nullable `evidence.attack_result`,
   replaces RPC bodies and access policies, then reloads PostgREST's schema.
3. Deploy the app. Existing RPC names remain unchanged. The additive
   `killerEvidenceProgress` projection contains metadata only. A deadline refusal
   returns the room plus `actionError: "accusation_started"` so the phase commits
   without damage. The new client displays the refusal and refreshes the room.
4. Reload open clients to activate service worker v3 and discard old shell
   caches. Previously downloaded images and already issued signed URLs cannot be
   recalled; existing signed URLs expire according to their original lifetime.

Historical approved evidence has `result: null` because the old schema did not
store per-attack outcomes. The UI shows its approval status without inventing a
result from current health. New approvals store their outcome permanently.

## Automated checks

```sh
npm ci
npx playwright install chromium
npm test
npm run test:browser
npm run typecheck
npm run lint
npm run build
```

`test:rules` runs the actual SQL/PLpgSQL in PGlite (PostgreSQL) with minimal
Supabase auth/storage fixture tables, including RLS and executing RPCs as
`authenticated`. It also checks migration preservation and service worker privacy.
`test:concurrency` starts a separate native PostgreSQL cluster in a newly created
temporary directory, using independent connections for competing requests; it
stops the process and removes only that test directory afterward. It requires a
supported platform and a non-root account on Unix. No external database is used.
`test:browser` uses mobile Chromium with a fake camera and actual SQL projections;
Supabase HTTP transport is intercepted. It does not contact the configured live
project. These checks do not exercise GoTrue, the Storage HTTP service, Realtime
delivery, or physical camera hardware.

## Supabase and physical-device acceptance

- Use separate authenticated sessions for Host, both Killers, Reporter, Police,
  a city player and an outsider. Verify direct RPC refusals as well as UI behavior.
- Approve an attack from Host and confirm the affected player's warning/hearts
  update through Realtime. Check that outsider cannot subscribe to room signals.
- Verify only Host can create/use a new signed evidence URL; sender and other
  players cannot list/read/download submitted evidence. Verify closing a room
  removes its evidence images through the Storage API.
- Transform the Wife and verify both Killers see each other and the same evidence
  statuses; city sessions see no identifying announcement or critical health.
- Select a Reporter target, kill the target from Host, then submit the inspection:
  it must fail without consuming the Reporter ability.
- Test camera permission denied/retry, capture, close, navigation and backgrounding
  on Android Chrome and iOS Safari over HTTPS. No file-picker fallback is offered.
- Submit within two minutes, wait over two minutes, then approve successfully.
  A capture older than two minutes at submission must be refused.
- Confirm refresh/reconnect preserves the database identity and game state, and
  verify due accusation and simultaneous explosion victory rules.

Do not roll back to the old insecure RPC definitions. If a release check fails,
keep the database patch and apply a forward correction before continuing play.
