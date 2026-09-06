import { ROLE_LABELS, type Role } from "./types";

/** Four deterministic civilian portraits keep villagers visually distinct without exposing role data. */
export const VILLAGER_ART = [
  "/pixel/role-villager-1.webp",
  "/pixel/role-villager-2.webp",
  "/pixel/role-villager-3.webp",
  "/pixel/role-villager-4.webp",
] as const;

/** Canonical artwork used for private role surfaces and post-game reveals. */
export const ROLE_ART: Record<Role, string> = {
  killer: "/pixel/role-killer.webp",
  "killer-wife": "/pixel/role-killer-wife.webp",
  police: "/pixel/role-police.webp",
  reporter: "/pixel/role-reporter.webp",
  bomber: "/pixel/role-bomber.webp",
  detective: "/pixel/role-detective.webp",
  athlete: "/pixel/role-athlete.webp",
  sumo: "/pixel/role-sumo.webp",
  villager: VILLAGER_ART[0],
};

export const HOST_ART = "/pixel/role-host.webp";

/** Pick a stable villager portrait from a player identifier; every other role keeps its canonical art. */
export function roleArtForPlayer(role: Role, playerKey?: string) {
  if (role !== "villager" || !playerKey) return ROLE_ART[role];
  let hash = 0;
  for (let index = 0; index < playerKey.length; index += 1) {
    hash = (hash * 31 + playerKey.charCodeAt(index)) >>> 0;
  }
  return VILLAGER_ART[hash % VILLAGER_ART.length];
}

export function roleArtAlt(role: Role) {
  return `ภาพประกอบบทบาท ${ROLE_LABELS[role]}`;
}
