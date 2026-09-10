export type Role =
  | "killer"
  | "killer-wife"
  | "police"
  | "reporter"
  | "bomber"
  | "detective"
  | "athlete"
  | "sumo"
  | "doctor"
  | "villager";
export type RoomPhase =
  | "lobby"
  | "active"
  | "resolution"
  | "final-discussion"
  | "secret-vote"
  | "police-check"
  | "bomb-resolution"
  | "ended";
export type HealthState = "alive" | "critical" | "dead";
export type EvidenceStatus = "pending" | "approved" | "rejected";
export type WinningTeam = "city" | "killers" | null;
export type Team = "city" | "killers";

export type EndGameReason =
  | "hunt-clock-expired"
  | "all-killers-eliminated"
  | "original-killer-eliminated"
  | "police-lineage-eliminated"
  | "final-low-kills"
  | "final-vote"
  | "police-accusation-correct"
  | "police-accusation-wrong"
  | "police-attacked"
  | "police-eliminated-no-successor"
  | "bomb-eliminated-all-killers"
  | "bomb-eliminated-police-no-successor"
  | "host-ended";

export type EndGameResult = {
  reason: EndGameReason;
  occurredAt: string;
  actorPlayerId?: string | null;
  targetPlayerId?: string | null;
  affectedPlayerIds: string[];
};

/** Public, post-game-only milestones that explain how the result was reached. */
export type EndGameTimelineEntry = {
  kind: "detective-eliminated" | "detective-promoted" | "police-attacked" | "game-ended";
  occurredAt: string;
  actorPlayerId?: string | null;
  targetPlayerId?: string | null;
};

/** Role reveal for authorized room members after the game has ended. */
export type EndGamePlayerSummary = {
  playerId: string;
  initialRole: Role | null;
  currentRole: Role | null;
  team: Team | null;
};

/** A post-game-only audit entry. Player ids keep personal filtering reliable. */
export type EndGameStoryEntry = {
  id: string;
  kind: "game-start" | "attack" | "heal" | "ability" | "bomb" | "winner" | "system" | "event" | "milestone" | "vote-summary" | "game-ended";
  occurredAt: string;
  actorPlayerId: string | null;
  targetPlayerId: string | null;
  affectedPlayerIds: string[];
  result: {
    message?: string;
    storagePath?: string;
    capturedAt?: string;
    decisionAt?: string;
    result?: string | null;
    healed?: boolean;
    counts?: Record<string, number>;
    reason?: EndGameReason;
    [key: string]: unknown;
  };
};

export type EndGameStory = {
  entries: EndGameStoryEntry[];
  incomplete: boolean;
};

export type PrivatePlayerState = {
  protectionUntil?: string;
  doctorUses?: number;
  doctorReadyAt?: string;
  badgeRevealed?: boolean;
  playerId: string;
  initialRole: Role;
  currentRole: Role;
  team: Team;
  isActiveKiller: boolean;
  hearts: number;
  maxHearts: number;
  hasUsedAbility: boolean;
};

export type Player = {
  id: string;
  name: string;
  /** Null while the player has not chosen their public lobby character. */
  avatarId: string | null;
  joinedAt: string;
  isOnline: boolean;
  health: HealthState;
  heartsVisibleToHost: number;
  maxHearts: number;
};

export type Evidence = {
  id: string;
  killerId: string;
  targetId: string;
  storagePath: string;
  /** Local-only preview; never persisted by the repository. */
  imageData?: string;
  capturedAt: string;
  createdAt: string;
  status: EvidenceStatus;
  decisionAt?: string;
};

export type RoomEvent = {
  id: string;
  type: "system" | "warning" | "attack" | "ability" | "bomb" | "winner";
  message: string;
  createdAt: string;
  playerId?: string;
};

/** Shared metadata only; images and storage paths are Host-only. */
export type KillerEvidenceProgress = Pick<
  Evidence,
  | "id"
  | "killerId"
  | "targetId"
  | "capturedAt"
  | "createdAt"
  | "status"
  | "decisionAt"
> & {
  result: "target is still alive" | "elimination confirmed" | null;
};

/** Approved attack evidence visible only to the Host and eliminated players. */
export type AttackActivity = {
  id: string;
  killerId: string;
  targetId: string;
  storagePath: string;
  capturedAt: string;
  decisionAt?: string;
  result: "target is still alive" | "elimination confirmed" | null;
};

export type RoomState = {
  rulesVersion?: "legacy" | "2.4";
  v24?: V24State;
  viewerRole: "host" | "player";
  playerId?: string;
  code: string;
  hostName: string;
  phase: RoomPhase;
  createdAt: string;
  closedAt?: string;
  killLimit: number;
  killsThisHour: number;
  quotaWindowStart: string;
  policeCheckAt?: string;
  players: Player[];
  privateStates: Record<string, PrivatePlayerState>;
  evidences: Evidence[];
  canViewAttackActivity: boolean;
  /** Attack-related history is temporarily unavailable to a living player. */
  attackActivityHidden: boolean;
  attackActivity: AttackActivity[];
  killerEvidenceProgress: KillerEvidenceProgress[];
  events: RoomEvent[];
  winner: WinningTeam;
  /** Immutable, public-to-members explanation captured when the game ended. */
  endGameResult?: EndGameResult;
  endGameTimeline: EndGameTimelineEntry[];
  endGameSummary: EndGamePlayerSummary[];
  bombTargets: string[];
  pendingBomberId?: string;
};

export const ROLE_LABELS: Record<Role, string> = {
  killer: "Killer",
  "killer-wife": "Killer's Wife",
  police: "Police",
  reporter: "Reporter",
  doctor: "Doctor",
  bomber: "Bomber",
  detective: "Detective",
  athlete: "Athlete",
  sumo: "Sumo",
  villager: "Villager",
};

export const ROLE_HEARTS: Record<Role, number> = {
  doctor: 2,
  killer: 0,
  "killer-wife": 2,
  police: 2,
  reporter: 2,
  bomber: 2,
  detective: 2,
  athlete: 3,
  sumo: 4,
  villager: 2,
};

export const DEFAULT_ROLE_COUNTS: Record<Role, number> = {
  killer: 1,
  "killer-wife": 1,
  police: 1,
  reporter: 1,
  doctor: 1,
  bomber: 1,
  detective: 1,
  athlete: 1,
  sumo: 0,
  villager: 4,
};

export type V24Action = { id: string; actor_id: string; target_id: string; kind: "attack" | "heal"; effective_at: string; evidence_id?: string; status: "pending" | "approved" | "rejected"; lethal: boolean; healed: boolean };
export type V24State = {
  durationMinutes?: number; startedAt?: string; cutoffAt?: string;
  finalAt?: string; revealEndsAt?: string; voteEndsAt?: string; serverNow: string;
  huntDeadline?: string; huntPending?: boolean; attacksUsed?: number; killsUsed?: number; pendingAttacks?: number;
  /** Active target protection, exposed only to the Host and active Killers. */
  targetProtectionUntil?: Record<string, string>;
  nomineeCount?: number; nominees?: string[]; actions?: V24Action[];
  myBallot?: { nominees: string[]; ranking: string[]; submittedAt: string } | null;
  ballots?: { voter_id: string; nominees: string[]; ranking: string[] }[];
  /** Present only for games started after the final-vote rule change. */
  finalVoteRules?: boolean;
};

export function healthState(hearts: number, maxHearts: number): HealthState {
  if (hearts <= 0) return "dead";
  if (hearts === 1 || hearts / maxHearts <= 0.34) return "critical";
  return "alive";
}
