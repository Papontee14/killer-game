import { ROLE_LABELS, type Role } from "./types";

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
  villager: "/pixel/role-villager.webp",
};

export const HOST_ART = "/pixel/role-host.webp";

export function roleArtAlt(role: Role) {
  return `ภาพประกอบบทบาท ${ROLE_LABELS[role]}`;
}
