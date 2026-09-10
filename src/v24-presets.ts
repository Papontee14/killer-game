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
 * Reviewed with Reporter's strict living-majority limit (2026-09-10).
 * Keep Detective for lineage protection; introduce Wife at eight players.
 * Durations conservatively preserve a City voting majority if Final is reached,
 * even with one extra City death from Bomber. This does not ensure correct votes.
 * Selection method, limitations and playtest plan: docs/V24_BALANCE_REVIEW.md.
 */
export const V24_GAME_PRESETS = {
  5: {
    playerCount: 5,
    durationMinutes: 180,
    roleCounts: { ...baseRoles, villager: 2 },
    note: "ทดลองห้องเล็ก: ไม่มี Reporter; ต้องสืบจากการสังเกต หลังสอง kill เหลือ City 2 ต่อ Killer 1 หากยังไม่จบจาก Police",
  },
  6: {
    playerCount: 6,
    durationMinutes: 210,
    roleCounts: { ...baseRoles, reporter: 1, villager: 2 },
    note: "ชุด playtest: Reporter ต้องเหลืออย่างน้อย 4/6 คน; อาจเสียสิทธิ์หลัง kill ที่สาม ควรใช้ก่อนถึงจุดนั้น",
  },
  7: {
    playerCount: 7,
    durationMinutes: 270,
    roleCounts: { ...baseRoles, reporter: 1, villager: 3 },
    note: "ชุด playtest: Killer คนเดียว; Reporter ต้องเหลืออย่างน้อย 4/7 คน และอาจเสียสิทธิ์หลัง kill ที่สี่",
  },
  8: {
    playerCount: 8,
    durationMinutes: 210,
    roleCounts: { ...baseRoles, "killer-wife": 1, reporter: 1, villager: 3 },
    note: "ชุด playtest: เริ่ม Wife แต่ลดเวลา จำกัด kill ปกติไม่เกิน 3; Reporter ต้องเหลือ 5/8 คน จับตาการให้ Wife ออกล่าแทน",
  },
  9: {
    playerCount: 9,
    durationMinutes: 270,
    roleCounts: { ...baseRoles, "killer-wife": 1, reporter: 1, athlete: 1, villager: 3 },
    note: "ชุด playtest: Reporter ต้องเหลือ 5/9 คน; Athlete เพิ่มต้นทุนเฉพาะเมื่อถูกเลือกเป็นเป้า ไม่ถือว่าปกป้องคนอื่น",
  },
  10: {
    playerCount: 10,
    durationMinutes: 330,
    roleCounts: { ...baseRoles, "killer-wife": 1, reporter: 1, athlete: 1, doctor: 1, villager: 3 },
    note: "ชุด playtest: Reporter ต้องเหลือ 6/10 คน อาจเสียสิทธิ์หลัง kill ที่ห้า; เก็บผลฮีลจริงและการแพ้ Hunt",
  },
  11: {
    playerCount: 11,
    durationMinutes: 330,
    roleCounts: { ...baseRoles, "killer-wife": 1, reporter: 1, athlete: 1, doctor: 1, bomber: 1, villager: 3 },
    note: "ชุด playtest: Reporter ต้องเหลือ 6/11 คน; เผื่อระเบิดทำให้ City ตายเพิ่มหนึ่งและปิดสิทธิ์สแกน ตกลงเกณฑ์ Bomber ก่อนเริ่ม",
  },
  12: {
    playerCount: 12,
    durationMinutes: 390,
    roleCounts: { ...baseRoles, "killer-wife": 1, reporter: 1, athlete: 1, doctor: 1, bomber: 1, villager: 4 },
    note: "ชุดบทบาทมาตรฐานแต่ใช้เวลาทดลอง 6.5 ชั่วโมง; Reporter ต้องเหลือ 7/12 คน เผื่อ City ตายเพิ่มจากระเบิดหนึ่งคน",
  },
} satisfies Record<V24PresetPlayerCount, V24GamePreset>;

/** Starting points for a casual office game. They assume the Killer can find an
 * opportunity roughly every 45–60 minutes; Hunt Clock still runs continuously.
 * These recommendations are deliberately separate from V24_GAME_PRESETS, whose
 * durations were derived for continuous-play balance analysis. */
export const V24_OFFICE_PRESETS = {
  5: {
    playerCount: 5,
    durationMinutes: 240,
    roleCounts: { ...baseRoles, villager: 2 },
    note: "Killer, Police และ Detective; ห้องเล็กไม่มี Reporter",
  },
  6: {
    playerCount: 6,
    durationMinutes: 240,
    roleCounts: { ...baseRoles, reporter: 1, villager: 2 },
    note: "เพิ่ม Reporter; ต้องใช้ก่อนผู้เล่นมีชีวิตเหลือ 4 คน",
  },
  7: {
    playerCount: 7,
    durationMinutes: 300,
    roleCounts: { ...baseRoles, reporter: 1, villager: 3 },
    note: "Killer คนเดียว; Reporter ต้องเหลือผู้เล่น 4 คน",
  },
  8: {
    playerCount: 8,
    durationMinutes: 300,
    roleCounts: { ...baseRoles, "killer-wife": 1, reporter: 1, villager: 3 },
    note: "เริ่มใช้ Wife; Reporter ต้องเหลือผู้เล่น 5 คน",
  },
  9: {
    playerCount: 9,
    durationMinutes: 360,
    roleCounts: { ...baseRoles, "killer-wife": 1, reporter: 1, villager: 4 },
    note: "เพิ่ม Villager เพื่อให้ City มีข้อมูลและเสียงมากขึ้น",
  },
  10: {
    playerCount: 10,
    durationMinutes: 360,
    roleCounts: { ...baseRoles, "killer-wife": 1, reporter: 1, villager: 5 },
    note: "พักบทบาทที่ต้องติดตามหลายจังหวะระหว่างเวลางาน",
  },
  11: {
    playerCount: 11,
    durationMinutes: 420,
    roleCounts: { ...baseRoles, "killer-wife": 1, reporter: 1, villager: 6 },
    note: "เพิ่มเวลาเพื่อมีโอกาสพบกันระหว่างงาน; Reporter ต้องเหลือ 6 คน",
  },
} satisfies Record<Exclude<V24PresetPlayerCount, 12>, V24GamePreset>;

/** The established 12-player, 10-hour composition. It is not an Office preset. */
export const V24_STANDARD_12_PRESET: V24GamePreset = {
  playerCount: 12,
  durationMinutes: 600,
  roleCounts: { ...baseRoles, "killer-wife": 1, reporter: 1, bomber: 1, athlete: 1, doctor: 1, villager: 4 },
  note: "ชุดมาตรฐาน 12 คน / 10 ชั่วโมงตามแผนเดิม",
};
