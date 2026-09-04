# Killer Game Rules

This file is the source of truth for game behavior. Before changing game logic,
UI visibility, database access, or notifications, verify that the change follows
every applicable rule below. If a proposed feature conflicts with this file, do
not implement it without an explicit rule update.

## Terms

- **Host**: The non-playing game moderator. The Host validates evidence and
  resolves special events.
- **Public**: Information every player may see.
- **Private**: Information visible only to the authorized player or the Host.
- **Approved attack**: A photo that the Host has accepted. A submitted or
  pending photo has no game effect.
- **Kill**: A player reaching zero hearts through approved attacks. Deaths from
  a Bomber explosion are not counted as kills for the hourly quota.

## Standard Setup

- The standard room contains one Host and twelve players.
- Default player roles are: one Killer, one Killer's Wife, one Police, one
  Reporter, one Bomber, one Detective, one Athlete, one Sumo Wrestler, and four
  Villagers.
- A Host may disable any special role except Killer and Police, and may change
  the Villager count.
- A room MUST always have exactly one initial Killer and at least one Police.
- Roles are random and private when the Host starts the game.
- The Host may see all roles, hearts, evidence, and event history. Players may
  not see another player's role or hearts unless a rule below explicitly says so.

## Hearts, Evidence, and Visibility

- Killer has no photo-based heart bar. Killer can die only through a Bomber
  explosion.
- Killer's Wife starts on the city side with two hearts. If she transforms into
  a Killer, her heart bar is no longer shown to her.
- Villager, Police, Reporter, Bomber, Detective, and Killer's Wife start with
  two hearts.
- Athlete starts with three hearts. Sumo Wrestler starts with four hearts.
- Every approved photo removes exactly one heart from the chosen target.
- A non-Killer player MUST see only their own current and maximum hearts in
  realtime. They MUST NOT see another player's hearts.
- Immediately after the Host approves an attack, the affected non-Killer player
  MUST receive a private warning that they were attacked and see their updated
  hearts.
- A player MUST NOT receive an attack warning, lose a heart, or see a health
  change before Host approval.
- A Killer MUST see only either `target is still alive` or `elimination
  confirmed` after approval. Killer MUST NOT see a target's current hearts,
  maximum hearts, or role.
- There is intentionally no cooldown, protection window, attack lock, or
  restriction on switching targets after an approved attack.

## Evidence and Hourly Quota

- Killer submits a live camera photo and selects a target. The Host validates
  the evidence before any game state changes.
- The final photo that eliminates a target MUST be freshly captured, not a
  pre-existing stock photo.
- The initial Killer team may have at most two **approved attacks** during each
  calendar hour in the `Asia/Bangkok` timezone.
- Every photo approved by the Host consumes one shared quota unit, whether it is
  lethal or non-lethal. Pending and rejected photos consume no quota.
- The quota resets exactly when the Bangkok calendar hour changes. For example,
  an approval at 08:50 counts in the 08:00-08:59 bucket; a new quota begins at
  09:00. A full quota prevents further approvals until that boundary.
- A Bomber explosion consumes no quota; the approved Bomber-killing photo still
  consumes one quota unit because it is an approved attack.
- If an approval would exceed the quota, it MUST be rejected atomically and no
  damage or quota change may be applied.

## Killer's Wife

- When Killer's Wife receives her second approved attack, she does not remain a
  normal dead spectator. She becomes the second Killer.
- Publicly announce only: `Killer has eliminated Killer's Wife. There are now
  two Killers.` Do not announce her name or mark her as dead in the public
  roster.
- After transformation, both Killers see each other, share evidence progress,
  and may cooperate on the same target.
- After transformation, the Killer team has a shared quota of three approved
  attacks per calendar hour.
- The transformed player remains eligible to die in a Bomber explosion.

## Reporter

- A living Reporter may use their ability exactly once per game.
- Reporter selects one other player and privately learns that player's initial
  role. A transformed Killer's Wife still returns `Killer's Wife`; a promoted
  Detective still returns `Detective`.
- Publicly announce only: `Reporter has used an ability.` Do not reveal the
  Reporter's identity, the inspected target, or the result.
- The inspected player receives a private notification that they were inspected
  but MUST NOT learn who the Reporter is.

## Bomber

- When a Bomber dies, the game MUST publicly announce that player's name and
  Bomber role immediately.
- Bomber resolution begins automatically and pauses other death confirmations.
- The Host chooses zero, one, or two living players nearest to the Bomber.
- Chosen players die immediately regardless of remaining hearts.
- Explosion deaths are announced by name but do not reveal roles, except for
  the original Bomber announcement.
- Bomber explosions never create another Bomber explosion or trigger Killer's
  Wife transformation. No chain reactions exist.
- A Killer killed by a Bomber is announced only as a dead player; the public
  MUST NOT learn that they were a Killer.
- If all Killers are dead, the city team wins immediately.

## Police, Detective, and Victory

- The Host sets the final accusation date and time. The standard event uses
  22:00 on the agreed game date, typically the 12th.
- At the final time, normal attacks stop and the current Police chooses one
  player as the suspected Killer.
- If Police identifies any active Killer, the city team wins. Otherwise, the
  Killer team wins.
- If Police dies, a living Detective becomes Police privately.
- If Police dies while no living Detective remains, the Killer team wins
  immediately.
- If Detective dies before Police, the game continues; however, the Killer team
  wins immediately if Police later dies with no Detective available to promote.

## Public Events and Privacy

- Normal deaths announce the player's name but not their role.
- The only mandatory role reveals are a dead Bomber and the final game result if
  the Host elects to show it.
- Notifications shown on a locked phone MUST be generic and must not leak role,
  target, heart, or inspection information. Full details appear only after the
  player opens the authenticated game view.
- Evidence images are private: Host may view them; other players may not.
- The Host deletes all evidence images when closing a room. Event summaries may
  remain after closure.

## Durable Multi-Day Room Requirements

- A game may run for one to two days. Room state, player identity, role,
  hearts, evidence decisions, events, and quota state MUST survive refreshes,
  browser restarts, network loss, and an overnight gap.
- Browser `localStorage` is not an authoritative store and cannot be the only
  persistence mechanism.
- Players must be able to return on the same device automatically through a
  secure session.
- Players must be able to reclaim their existing player identity on a new device
  with the room code and their name. Reclaiming MUST preserve role, hearts, and
  game history.
- A disconnected player becomes offline; they are never automatically removed,
  reset, or killed for disconnecting.

## Compliance Checklist

Before shipping a rule-related change, confirm all applicable items:

- [ ] Damage and warnings occur only after Host approval.
- [ ] Players see only their own hearts; Killer sees no numeric target health.
- [ ] Hourly kill quota resets at the exact Bangkok calendar-hour boundary.
- [ ] Every approved photo, including non-lethal damage, consumes one quota unit;
      pending/rejected photos do not.
- [ ] Killer's Wife transformation hides her identity from public events and
      increases the shared killer quota to three.
- [ ] Reporter result is private and reports the target's initial role only.
- [ ] Bomber is publicly revealed, Host selects zero to two victims, and no
      chain reaction occurs.
- [ ] Killer can die from a Bomber without public Killer-role disclosure.
- [ ] Police/Detective succession and all city/Killer win paths are preserved.
- [ ] Private roles, hearts, evidence, and notifications are protected by both
      UI behavior and backend authorization.
- [ ] A player can safely reconnect after a one-to-two-day interruption.
