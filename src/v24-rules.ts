import type { Role } from "./types";
export const V24_ROLE_DETAILS: Record<Role, string> = {
  killer:
    "ใช้กล้องสด ส่งภาพภายใน 2 นาที · ทีมแชร์ 3 attacks และ 1 kill ต่อ rolling 60 นาที · kill แรกภายใน 120 นาทีและ kill ถัดไปห่างไม่เกิน 120 นาที · ไม่มี Heart bar",
  "killer-wife":
    "Killer Side · 1 Heart · approved hit แรกเปลี่ยนเป็น Killer ทันที ไม่ตาย ไม่ใช้ kill quota และไม่ reset Hunt Clock · ก่อนเปลี่ยนร่างไม่รู้ว่า Killer คือใคร",
  police:
    "2 Hearts ไม่มี Vest · Reveal ได้ครั้งเดียวก่อนเส้นตาย โดยไม่เพิ่ม Heart หรือ protection · ส่ง ranking ลับพร้อม Final ballot · ถ้า Police lineage หมด Killer Side ชนะ",
  detective:
    "2 Hearts · เมื่อ Police ตาย คุณรับตำแหน่งแบบ private พร้อม 2 Hearts และ Reveal Badge ของตนเอง · ไม่มี scan",
  reporter:
    "2 Hearts · ตรวจ initial role ของคนอื่นที่ยังมีชีวิตได้ 1 ครั้งก่อน cutoff · ผลเป็นความลับ",
  bomber:
    "2 Hearts · เมื่อถูก Killer ฆ่า เปิดเผย Bomber และเกิดระเบิด · เหยื่อ 0–1 คนตาม proximity rule ที่ล็อกก่อนเริ่ม · ไม่เกิด chain reaction",
  athlete: "3 Hearts · City Side · เอาตัวรอด สังเกต และร่วมโหวตลับ",
  doctor:
    "2 Hearts · รักษาคนอื่น +1 Heart ไม่เกิน Max HP · 4 ครั้งต่อเกม / cooldown 90 นาที · ห้าม self-heal · ใช้ charge แม้ไม่มีผล และไม่บอกผลสำเร็จ · ไม่ต่อ protection หรือชุบชีวิต",
  villager: "2 Hearts · City Side · เอาตัวรอด สังเกต และร่วมโหวตลับ",
  sumo: "ใช้เฉพาะห้องกฎเดิม",
};
export const V24_RULES = [
  "ค่าเริ่มต้น 13 คน / 10 ชั่วโมง · Doctor แทน Sumo · Host ปรับจำนวนและเวลาก่อนเริ่มได้",
  "approved normal attack ลด 1 Heart และให้ protection 45 นาที · ภาพ pending/rejected ไม่ทำ damage",
  "3 attacks และ 1 elimination ต่อ rolling 60 นาทีร่วมทั้งทีม · pending สูงสุด 2 ต่อ Killer",
  "Hunt Clock: kill แรก ≤120 นาที แล้ว kill ใหม่ทุก ≤120 นาที · transform/ระเบิดไม่นับ · ตรวจถึง cutoff และรอ Host เคลียร์หลักฐานก่อนตัดสิน",
  "cutoff ก่อนจบ 30 นาที · discussion 10 นาทีสุดท้าย · Communication Lock เมื่อเริ่มโหวตลับ 3 นาที",
  "ไม่มี active Killer → City ชนะ · ไม่มี living Police หลัง succession → Killer Side ชนะ · 0–1 kills ณ Final → City ชนะ · 2+ → Secret Vote ไม่มี 5+ auto-win",
  "คนเป็นทุกฝ่ายโหวต 1 ใบ เลือกคนอื่นครบจำนวน active Killers (1 หรือ 2) · City ต้องจับครบทุกคน · ส่งแล้วแก้ไม่ได้ คนไม่ส่งงดออกเสียง",
  "Police ranking ตัดสินคะแนนเสมอ · ลำดับสุ่มลับก่อนโหวตเป็นตัวสำรองเมื่อ ranking ใช้ไม่ได้ · warning ไม่ตัด ballot อัตโนมัติ",
];
