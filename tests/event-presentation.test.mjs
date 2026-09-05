import { test } from "node:test";
import assert from "node:assert/strict";
import { presentEvent } from "../src/event-presentation.ts";
const labels = {
  killer: "Killer",
  "killer-wife": "Killer's Wife",
  police: "Police",
  reporter: "Reporter",
  bomber: "Bomber",
  detective: "Detective",
  athlete: "Athlete",
  sumo: "Sumo",
  villager: "Villager",
};
const cases = [
  [
    "system",
    "ห้องถูกสร้างแล้ว รอผู้เล่นเข้าร่วม",
    "สร้างห้องแล้ว รอผู้เล่นเข้าร่วม",
    "neutral",
    "door",
  ],
  [
    "system",
    "เกมเริ่มแล้ว บทบาทถูกแจกเรียบร้อย",
    "เกมเริ่มแล้ว ทุกคนได้รับบทบาทส่วนตัวแล้ว",
    "success",
    "play",
  ],
  [
    "warning",
    "ถึงเวลาตำรวจชี้ตัวแล้ว",
    "ถึงเวลาตำรวจชี้ตัวแล้ว พักการโจมตีระหว่างรอผล",
    "warning",
    "shield",
  ],
  [
    "warning",
    "หลักฐานถูกปฏิเสธ",
    "Host ปฏิเสธหลักฐานการโจมตีของคุณ",
    "warning",
    "reject",
  ],
  [
    "attack",
    "target is still alive",
    "Host อนุมัติหลักฐานแล้ว — เป้าหมายยังมีชีวิต",
    "success",
    "check",
  ],
  [
    "attack",
    "elimination confirmed",
    "Host อนุมัติหลักฐานแล้ว — กำจัดเป้าหมายสำเร็จ",
    "danger",
    "skull",
  ],
  [
    "warning",
    "คุณถูกโจมตีและเสียหัวใจ 1 ดวง",
    "คุณถูกโจมตี เสียหัวใจ 1 ดวง",
    "danger",
    "heart",
  ],
  [
    "attack",
    "มีคนถูกโจมตีจาก Killer",
    "มีคนถูกโจมตีจาก Killer",
    "danger",
    "heart",
  ],
  ["warning", "นนท์ ถูกกำจัด", "นนท์ถูกกำจัดแล้ว", "danger", "skull"],
  [
    "ability",
    "Reporter has used an ability.",
    "นักข่าวใช้ความสามารถแล้ว",
    "info",
    "search",
  ],
  [
    "ability",
    "บทบาทเริ่มต้นของ นนท์ คือ killer-wife",
    "บทบาทเริ่มต้นของนนท์คือ Killer's Wife",
    "info",
    "search",
  ],
  [
    "ability",
    "คุณถูกตรวจบทบาท",
    "มีผู้ใช้ความสามารถตรวจบทบาทเริ่มต้นของคุณแล้ว",
    "warning",
    "eye",
  ],
  [
    "ability",
    "คุณกลายเป็น Killer แล้ว",
    "คุณเปลี่ยนเป็น Killer แล้ว ขณะนี้คุณอยู่ฝ่าย Killer",
    "danger",
    "mask",
  ],
  [
    "ability",
    "Killer has eliminated Killer's Wife. There are now two Killers.",
    "Killer กำจัดเมีย Killer แล้ว ขณะนี้มี Killer 2 คน",
    "danger",
    "mask",
  ],
  [
    "ability",
    "ตำรวจคนใหม่ได้รับตำแหน่งแบบส่วนตัว",
    "คุณได้รับตำแหน่งตำรวจแล้ว เก็บบทบาทใหม่เป็นความลับ",
    "info",
    "shield",
  ],
  [
    "bomb",
    "ต้น ถูกกำจัด — Bomber",
    "ต้นถูกกำจัดแล้ว และมีบทบาทเป็น Bomber — รอ Host จัดการระเบิด",
    "warning",
    "bomb",
  ],
  ["bomb", "นนท์ ถูกกำจัดจากระเบิด", "นนท์ถูกกำจัดจากระเบิด", "danger", "bomb"],
  ["winner", "ฝ่ายเมืองชนะ", "เกมจบแล้ว — ฝ่ายเมืองชนะ", "success", "trophy"],
  [
    "winner",
    "ฝ่าย Killer ชนะ",
    "เกมจบแล้ว — ฝ่าย Killer ชนะ",
    "danger",
    "trophy",
  ],
  [
    "system",
    "Host สั่งจบเกม",
    "Host จบเกมแล้ว โดยไม่มีผู้ชนะ",
    "neutral",
    "stop",
  ],
];
for (const [type, stored, message, tone, icon] of cases)
  test(`event presentation: ${stored}`, () =>
    assert.deepEqual(presentEvent({ type, message: stored }, labels), {
      message,
      tone,
      icon,
    }));
test("Host wording names the recipient without claiming the Host was attacked", () => {
  assert.equal(
    presentEvent(
      { type: "warning", message: "คุณถูกโจมตีและเสียหัวใจ 1 ดวง" },
      labels,
      "นนท์",
    ).message,
    "นนท์ถูกโจมตี เสียหัวใจ 1 ดวง",
  );
});
test("role translation preserves names including embedded delimiters and HTML", () => {
  const name = "มิน คือ <b>Killer</b>";
  const event = {
    type: "ability",
    message: `บทบาทเริ่มต้นของ ${name} คือ detective`,
  };
  assert.equal(
    presentEvent(event, labels).message,
    `บทบาทเริ่มต้นของ${name}คือ Detective`,
  );
  assert.equal(event.message, `บทบาทเริ่มต้นของ ${name} คือ detective`);
});
test("unknown events and unknown role tokens remain neutral and unchanged", () => {
  for (const event of [
    { type: "system", message: "คุณกลายเป็น Killer แล้ว" },
    { type: "ability", message: "บทบาทเริ่มต้นของ นนท์ คือ unknown" },
    { type: "warning", message: "เหตุการณ์ใหม่" },
  ])
    assert.deepEqual(presentEvent(event, labels), {
      message: event.message,
      tone: "neutral",
      icon: "radio",
    });
});
