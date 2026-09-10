import type { Role } from "./types";

export type V24PresetPlayerCount = 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

export type V24GamePreset = {
  /** Players only; the Host is additional. */
  playerCount: V24PresetPlayerCount;
  /** Start to scheduled Final; includes the 30-minute attack cutoff period.
   * Secret voting adds three minutes and Host resolution can delay it further. */
  durationMinutes: number;
  roleCounts: Record<Role, number>;
  note: string;
};

const baseRoles: Record<Role, number> = {
  killer: 1,
  "killer-wife": 0,
  police: 1,
  detective: 1,
  reporter: 0,
  bomber: 0,
  athlete: 0,
  doctor: 0,
  villager: 0,
  sumo: 0,
};

/** Playtest recommendations for v2.4 with finalVoteRules=true, not measured
 * win-rate guarantees or automatically applied lobby defaults.
 * Assumes continuous play without overnight breaks; Hunt remains 120 minutes.
 * Keep Detective for lineage protection; introduce Wife at eight players to
 * avoid a two-player Killer team dominating the smallest voting pools.
 */
export const V24_GAME_PRESETS = {
  5: {
    playerCount: 5,
    durationMinutes: 180,
    roleCounts: { ...baseRoles, villager: 2 },
    note: "ห้องเล็กสำหรับทดลอง: Killer คนเดียว มี Detective สำรอง Police; หลังสอง kill เหลือผู้โหวตเพียงสามคน",
  },
  6: {
    playerCount: 6,
    durationMinutes: 240,
    roleCounts: { ...baseRoles, reporter: 1, villager: 2 },
    note: "เพิ่ม Reporter เพื่อสร้างข้อมูลสืบสวน; ยังไม่มี Wife และพลังรักษา",
  },
  7: {
    playerCount: 7,
    durationMinutes: 300,
    roleCounts: { ...baseRoles, reporter: 1, villager: 3 },
    note: "เพิ่ม Villager ให้มีผู้ต้องสงสัยและเสียง City มากขึ้นก่อนเพิ่ม Killer Side คนที่สอง",
  },
  8: {
    playerCount: 8,
    durationMinutes: 360,
    roleCounts: { ...baseRoles, "killer-wife": 1, reporter: 1, villager: 3 },
    note: "เริ่มใช้ Wife; จับตาเสียงสองคนของ Killer Side และการให้ Wife ออกล่าแทน",
  },
  9: {
    playerCount: 9,
    durationMinutes: 420,
    roleCounts: { ...baseRoles, "killer-wife": 1, reporter: 1, athlete: 1, villager: 3 },
    note: "เพิ่ม Athlete ให้ Killer ต้องเลือกเป้าหมายตามต้นทุนการโจมตี",
  },
  10: {
    playerCount: 10,
    durationMinutes: 480,
    roleCounts: { ...baseRoles, "killer-wife": 1, reporter: 1, athlete: 1, doctor: 1, villager: 3 },
    note: "เพิ่ม Doctor; เก็บผลฮีลจริงและเกมที่จบเพราะ Hunt เพื่อดูแรงกดดันฝั่ง Killer",
  },
  11: {
    playerCount: 11,
    durationMinutes: 540,
    roleCounts: { ...baseRoles, "killer-wife": 1, reporter: 1, athlete: 1, doctor: 1, bomber: 1, villager: 3 },
    note: "ครบทุกบทบาทพิเศษ; ตกลงเกณฑ์ระยะและการเลือกเหยื่อ Bomber ก่อนเริ่ม",
  },
  12: {
    playerCount: 12,
    durationMinutes: 600,
    roleCounts: { ...baseRoles, "killer-wife": 1, reporter: 1, athlete: 1, doctor: 1, bomber: 1, villager: 4 },
    note: "ชุดมาตรฐานตาม GAME_RULES.md สำหรับใช้เป็นฐานเปรียบเทียบ playtest",
  },
} satisfies Record<V24PresetPlayerCount, V24GamePreset>;
