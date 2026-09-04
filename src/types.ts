export type Role = "killer" | "killer-wife" | "police" | "reporter" | "bomber" | "detective" | "athlete" | "sumo" | "villager";
export type RoomPhase = "lobby" | "active" | "police-check" | "bomb-resolution" | "ended";
export type HealthState = "alive" | "critical" | "dead";
export type EvidenceStatus = "pending" | "approved" | "rejected";
export type WinningTeam = "city" | "killers" | null;

export type PrivatePlayerState = {
  playerId: string;
  role: Role;
  hearts: number;
  maxHearts: number;
  hasUsedAbility: boolean;
  isKillerSide: boolean;
};

export type Player = {
  id: string;
  name: string;
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
  imageData: string;
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

export type RoomState = {
  code: string;
  hostName: string;
  hostPin: string;
  playerPin: string;
  phase: RoomPhase;
  createdAt: string;
  attackLimit: number;
  attacksThisHour: number;
  attackHour: number;
  policeCheckAt?: string;
  players: Player[];
  privateStates: Record<string, PrivatePlayerState>;
  evidences: Evidence[];
  events: RoomEvent[];
  winner: WinningTeam;
  bombTargets: string[];
};

export const ROLE_LABELS: Record<Role, string> = {
  killer: "Killer",
  "killer-wife": "เมีย Killer",
  police: "ตำรวจ",
  reporter: "นักข่าว",
  bomber: "Bomber",
  detective: "นักสืบ",
  athlete: "นักกีฬา",
  sumo: "ซูโม่",
  villager: "ชาวบ้าน",
};

export const ROLE_HEARTS: Record<Role, number> = {
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
  bomber: 1,
  detective: 1,
  athlete: 1,
  sumo: 1,
  villager: 4,
};

export function healthState(hearts: number, maxHearts: number): HealthState {
  if (hearts <= 0) return "dead";
  if (hearts === 1 || hearts / maxHearts <= 0.34) return "critical";
  return "alive";
}
