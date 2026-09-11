# Killer game rules v2.4

This is the authority for rooms with `rules_version = '2.4'`. The user adopted
the supplied KILLER Balance Playtest v2.4 Hunt Clock specification. Future balance
experiments in that document are not enabled rules. Existing rooms remain
`legacy`; see [legacy rules](docs/LEGACY_GAME_RULES.md).

## Current rules and compatible 2.4 rooms

Rules below describe the current 2.4 profile used by rooms started after the
Wife-revote revision (`v24.finalVoteRules = true`, `v24.wifeRevoteRules = true`).
Rooms that started before either revision keep their existing 2.4 behavior:
they do not end when the original Killer dies, the Wife changes her current role
to Killer when awakened, and Final voting selects the number of living active
Killers (one or two). The relevant compatibility behavior is called out below.

## Setup and schedule

- Default 12 players plus Host: Killer, Wife, Police, Detective, Reporter,
  Bomber, Athlete, Doctor (one each), Villager (four). No Sumo.
- Exactly one initial Killer and Police; optional special roles 0–1, Villager
  0–20. At least three players must match the role count and select avatars.
- Host configures duration (121–2880 minutes; default 600) before start. Settings
  then lock. During a Bomber explosion, Host judges the closest living player
  from the evidence image.
- Server start time anchors cutoff at Final minus 30 minutes, discussion at
  Final minus 10 minutes, Reveal deadline at Final minus two hours. Other
  cooldowns and Hunt durations remain fixed when game length changes.
- Stop new attacks/abilities at cutoff. Resolve pending events before discussion
  and Final. Communication Lock starts secret voting for three minutes. A late
  Host resolution delays voting but still gives three minutes without reopening
  attacks, abilities or information gathering.

## Evidence and ordered resolution

- Live-camera image must be submitted within two minutes of capture and before
  cutoff. Validate timestamp, image ownership and MIME/size on the server; Host
  validates authenticity. Pending/rejected evidence never damages the target.
- Attack effective time is validated capture time; heal effective time is server
  activation time. Host processes earliest pending event first; simultaneous
  timestamps use stable action ID order.
- Wait out the two-minute upload window before applying effects (or cutoff,
  when no further submissions are accepted). Refuse uploads at/before the last
  resolved timestamp instead of rewriting history retroactively.
- Approved normal attack applies one hit and starts protection for 45 minutes
  from effective time. Evidence within protection must be rejected even when
  reviewed later. Attack at exactly expiry is allowed. Switching targets is allowed.
- Both Killers share three approved attacks and one elimination per rolling
  60 minutes. Events exactly 60 minutes old leave the window. Transformation
  costs one attack, no kill; explosion costs neither.
- Pending submissions reserve attack capacity, maximum two per active Killer
  and three approved/pending attacks in the relevant window. Reject releases
  reservations. Approval atomically rechecks protection, actor/target and quotas.
  An ineligible attack remains pending for Host rejection without damage.

## Hunt Clock and victory

- First confirmed Killer kill must have effective time ≤ start +120 minutes.
  Each subsequent kill resets the shared deadline to kill time +120 minutes.
  Wife transformation and explosion never reset Hunt Clock.
- Check only deadlines at/before cutoff. Before declaring a miss, wait out the
  upload allowance and resolve pending events at/before the deadline. A kill
  exactly at deadline counts; Host review time does not move the kill time.
- Missed Hunt deadline ends the game for City, with deadline recorded as result
  time. A later action cannot rescue a missed clock.
- After an event, current-rule rooms first check whether the original Killer is
  alive; if not, City wins. Then check living active Killers: none means City
  wins. Resolve Police succession next; no living Active Police means Killer
  Side wins. Resolve Bomber victims before these checks. Earlier 2.4 rooms skip
  the original-Killer check.
- At Final, 0–1 confirmed Killer kills gives City victory; 2+ enters secret vote.
  There is no 5+ automatic Killer win.
- Server scheduler and room RPCs evaluate time idempotently. Browser countdowns
  and notifications do not decide outcomes.

## Roles

- **Killer:** Killer Side, active, no Heart bar, immune to normal attacks. Bomber
  can kill them. Sees only survived/eliminated attack outcomes, not target secrets.
- **Wife:** Killer Side, one Heart. In current-rule rooms, the first approved
  hit awakens her as an active Killer without death while her current role stays
  Wife. Public learns only that a second Killer exists. Killers see each other
  after awakening and share quota/clock. The hit costs one attack, no kill; an
  explosion does not awaken her. Earlier 2.4 rooms instead change her current
  role to Killer.
- **Police:** two Hearts, no Vest; attacks damage normally. One public Reveal
  Badge per Active Police at/before Reveal deadline, without health/protection
  benefit. Sends normal ballot and secret tie ranking.
- **Detective:** two Hearts, no scan. Privately promotes when Police dies, with
  two Hearts, no Vest, own Reveal Badge and Police voting duties.
- **Reporter:** two Hearts; one inspection of another living player's initial
  role before cutoff, only while more than half of the starting players remain
  alive (10 players requires 6 alive; 9 requires 5). Transformed Wife reports
  Wife, successor reports Detective.
  Result private; public sees only ability-use announcement.
- **Bomber:** two Hearts. Killer-caused death reveals Bomber and pauses resolution.
  Host chooses 0–1 living victim by judging the evidence image. Explosion ignores
  hearts, does not chain and does not transform Wife.
- **Athlete:** three Hearts; normal City voting and survival rules.
- **Doctor:** two Hearts; heal another living player +1, capped at role max.
  No self-heal, revive or transform reversal; no protection reset/extension.
  Four activations, 90-minute cooldown from activation. Full-HP/active-Killer
  targets still consume charge/cooldown. An accepted heal becomes a no-op if
  actor or target died at an earlier effective time. Public sees only
  `Doctor treated [name]`; Doctor never learns whether health was restored.
  Mechanical result is Host-only telemetry.
- **Villager:** two Hearts; observe, survive, discuss and vote.

## Secret vote

- Current-rule rooms freeze living voter IDs and require every living player,
  including Killer Side, to submit one ballot choosing exactly one other living
  player. Host/dead players cannot vote. City wins when that nominee is the
  living original Killer. If round one selects the Wife, publicly reveal her as
  Wife, remove her from voters and candidates without killing her, then open a
  final round-two ballot for three minutes. Round two may only win for City by
  selecting the original Killer; there is no third round.
- Earlier 2.4 rooms freeze both living voter IDs and active Killer count K (one
  or two). Each ballot chooses exactly K distinct other living players, and City
  wins only when the nominees equal the complete living active-Killer set.
- Submission is immutable within its ballot; retries cannot replace it. Missing
  ballots abstain. Each main round has its own Police ranking.
  Players cannot see other ballots, live scores or fallback ranking.
- Each selected name earns one point. The top required number of names become
  nominees: one in current-rule rooms, or K in earlier 2.4 rooms.
- New games (`tieRunoffRules=true`): Police ranks every other eligible living
  player with their main ballot. For a highest-score tie, use that ranking only
  when submitted and Police is not among the tied candidates. Otherwise open
  one 60-second runoff among the tied candidates, with the same voters and no
  self-voting. Communication Lock stays in force. Discard the earlier scores;
  count only runoff ballots. A unique winner is selected normally; any remaining
  tie (including all abstaining) gives Killer Side victory, without a nominee.
  Police ranking is not used in a runoff. No random fallback decides new games.
- Each main round permits at most one runoff. Selecting Wife in the first main
  round or its runoff reveals and excludes her, then starts main round two for
  three minutes, with its own possible runoff. There is no third main round.
- Games already started retain the previous tie rule: use Police ranking within
  tied scores, or a private random permutation committed before voting if absent.
  Police occupies their fallback position, preserving other ranked names' order.
- Host sees ballots for moderation. Communication after lock can receive a
  recorded warning, without automatic ballot invalidation or voting extension.
- Publish nominees/winner at deadline. Post-game role summary remains available
  to authenticated room members after closure.

## Privacy and persistence

- Supabase owns state; actions, ballots, secrets, timestamps and results survive
  refresh/reconnect with the same session. Public avatars never encode private roles.
- Players see only own hearts/protection/ability counters/ballot. Killer team
  receives permitted shared progress and Hunt/quota metadata. Host sees evidence.
  Private tables are inaccessible directly to client roles.
- In current-rule rooms, after cutoff and until the game ends, a living player
  cannot view attack-related history or timestamps. Host and eliminated players
  retain their permitted views.
- Realtime emits harmless room signals and recipient-specific generic notices.
  Lock-screen push cannot expose roles, targets, health or inspection information.
- Existing close-room flow removes evidence images; summaries remain accessible.

## Defaults beyond the source document

User-selected: configurable composition/duration with fixed cooldowns; retain
legacy rooms; Host judges Bomber proximity from the evidence image; absent voters abstain;
new-game ties use the Police/runoff procedure above. Engineering defaults: two-minute ordering watermark,
stable same-time ordering, minimum three players, maximum 48-hour duration and
a full three-minute vote after delayed Host resolution. These are explicit
handling rules, not claims from the document's balance experiments.
