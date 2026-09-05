import { ROLE_LABELS, type Role } from "./types";

/** Canonical artwork used for private role surfaces and post-game reveals. */
export const ROLE_ART: Record<Role, string> = {
  killer: "/roles/killer.png",
  "killer-wife": "/roles/killer-wife.png",
  police: "/roles/police.png",
  reporter: "/roles/reporter.png",
  bomber: "/roles/bomber.png",
  detective: "/roles/detective.png",
  athlete: "/roles/athlete-male.png",
  sumo: "/roles/sumo-male.png",
  villager: "/roles/villager-1-male.png",
};

export const HOST_ART = "/roles/host.png";

export function roleArtAlt(role: Role) {
  return `ภาพประกอบบทบาท ${ROLE_LABELS[role]}`;
}
