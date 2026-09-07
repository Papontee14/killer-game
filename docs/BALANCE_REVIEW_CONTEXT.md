# Killer Game — Balance Review Context

เอกสารนี้เป็น snapshot สำหรับนำไปถาม ChatGPT เรื่องความสมดุลของเกม
ไม่ใช่ source of truth ใหม่ และไม่ควรใช้แทน `GAME_RULES.md` หากมีข้อความขัดกัน

## วิธีใช้งาน

แนบไฟล์นี้พร้อม `GAME_RULES.md` ใน Project ChatGPT แล้วใช้ prompt ท้ายเอกสาร
ถ้าต้องการวิเคราะห์ตาม implementation จริง ให้แนบ `src/types.ts` และ
`supabase/schema.sql` เพิ่มด้วย

## Source of truth และไฟล์อ้างอิง

- `GAME_RULES.md` — กฎเกมปัจจุบันและ privacy/gameplay contract หลัก
- `src/types.ts` — role, heart, phase, outcome และ data model ที่แอปใช้
- `supabase/schema.sql` — กติกาที่บังคับใช้จริงใน RPC/database สำหรับ fresh install
- `supabase/migrations/20260905_role_rules.sql` — role rules และ privacy rollout
- `supabase/migrations/20260907_kill_quota_and_police_protection.sql` — quota และ Police protection
- `supabase/migrations/20260907_killer_wife_side.sql` — Wife อยู่ Killer Side ตั้งแต่เริ่มเกม
- `supabase/migrations/20260907_end_game_timeline.sql` — end-game result/timeline
- `docs/ROLE_RULES_ROLLOUT.md` — deployment/acceptance notes และ behavior ที่ต้องทดสอบ
- `tests/rules.test.mjs` — scenario tests ของกฎสำคัญ

## เกมโดยสรุป

KILLER เป็นเกม hidden-role แบบ asynchronous สำหรับเล่นผ่านโทรศัพท์หลายเครื่อง
มี Host เป็นผู้ควบคุมการตรวจหลักฐานและ resolve เหตุการณ์พิเศษ เกมหนึ่งเกมเล่นได้
ประมาณหนึ่งถึงสองวัน ไม่มีรอบกลางวัน/กลางคืนแบบตายตัว การโจมตีเกิดจาก Killer
ถ่ายรูปด้วยกล้องสด เลือกเป้าหมาย แล้วส่งให้ Host อนุมัติ

Room state, role, hearts, evidence, event history และ quota อยู่ใน Supabase ซึ่งเป็น
authoritative store; ผู้เล่นเห็นข้อมูลตามสิทธิ์ของ role ไม่ใช่ข้อมูลทั้งห้อง

## Standard setup

- Host 1 คน ไม่ใช่ผู้เล่น
- ผู้เล่นมาตรฐาน 12 คน
- บทบาทมาตรฐาน:
  - Killer 1
  - Killer's Wife 1
  - Police 1
  - Reporter 1
  - Bomber 1
  - Detective 1
  - Athlete 1
  - Sumo Wrestler 1
  - Villager 4
- Role ถูกสุ่มและเป็นความลับเมื่อ Host เริ่มเกม
- Host ปิด special role ใดก็ได้ ยกเว้น Killer และ Police และปรับจำนวน Villager ได้
- ห้องต้องมี initial Killer exactly 1 และ Police อย่างน้อย 1
- ใน implementation ปัจจุบัน special role แต่ละชนิดมีได้ไม่เกิน 1 คน และ Villager มีได้ไม่เกิน 20 คน
- Killer's Wife อยู่ Killer Side ตั้งแต่เริ่มเกม แม้ยังไม่ใช่ active Killer

## Hearts และการโจมตี

| Role | Hearts เริ่มต้น | หมายเหตุ |
|---|---:|---|
| Killer | ไม่มี | ตายได้จาก Bomber explosion เท่านั้น |
| Killer's Wife | 2 | ถ้าถูกโจมตีครบ 2 ครั้ง จะ transform เป็น Killer คนที่สอง |
| Police | 2 | ถ้าตาย Detective ที่ยังมีชีวิตจะขึ้นแทน |
| Reporter | 2 | ใช้ ability ได้ครั้งเดียว |
| Bomber | 2 | เมื่อตายจะเปิดเผยบทบาทและเข้า bomb resolution |
| Detective | 2 | ถ้าตายก่อน Police เกมยังดำเนินต่อ |
| Athlete | 3 | ไม่มี active ability เพิ่มในกฎปัจจุบัน |
| Sumo Wrestler | 4 | ไม่มี active ability เพิ่มในกฎปัจจุบัน |
| Villager | 2 | ไม่มี active ability |

- Approved photo แต่ละครั้งลดหัวใจเป้าหมาย 1 ดวง
- Pending/rejected photo ไม่มีผลต่อเกม
- หลักฐานต้องถ่ายจาก live camera และส่งภายใน 2 นาทีหลังถ่าย
- หลังส่งแล้ว pending evidence ไม่หมดอายุระหว่างรอ Host review
- ไม่มี cooldown, protection window, attack lock หรือข้อจำกัดการเปลี่ยนเป้าหมาย
- การโจมตีแบบปกติทำได้เฉพาะเป้าหมายที่มีชีวิตและไม่ใช่ active Killer/ally
- การโจมตีที่ไม่ถึงตายไม่กิน kill quota
- Killer ไม่เห็นตัวเลขหัวใจของเป้าหมาย เห็นเพียง `target is still alive` หรือ
  `elimination confirmed`

## Hourly kill quota

- ใช้เวลา calendar hour ของ `Asia/Bangkok`
- initial Killer team มี quota สำหรับ kills สูงสุด 2 kills ต่อชั่วโมง
- นับเฉพาะ approved attack ที่ทำให้เป้าหมายเหลือ 0 hearts
- Non-lethal approval, pending และ rejected evidence ไม่กิน quota
- Quota reset ตรงต้นชั่วโมงกรุงเทพฯ ไม่ใช่ rolling 60 minutes
- ถ้า quota เต็ม จะปฏิเสธเฉพาะ approval ที่จะทำให้เกิด kill ใหม่
- การฆ่า Bomber ด้วย approved attack กิน 1 quota
- Bomber explosion ไม่กิน quota
- ถ้า approval จะเกิน quota ต้อง reject แบบ atomic โดยไม่ทำ damage

### Killer's Wife transformation

- Wife มี 2 hearts และการโจมตีครั้งที่สองที่ได้รับการ approve จะทำให้เธอ
  transform เป็น active Killer คนที่สอง ไม่ได้กลายเป็นศพ spectator
- การโจมตีครั้งที่ transform กิน 1 kill quota unit
- เมื่อ transform แล้ว shared Killer quota เพิ่มเป็น 3 kills ต่อชั่วโมง
  โดยไม่ reset จำนวนที่ใช้ไปแล้วในชั่วโมงนั้น
- หลัง transform Killers ทั้งสองเห็นกันเอง แชร์ evidence progress และร่วมโจมตีเป้าหมายเดียวกันได้
- Wife ที่ transform แล้วไม่มี heart bar และยังถูก Bomber explosion ฆ่าได้
- Public announcement ต้องบอกเพียงว่ามี Killer คนที่สองเกิดขึ้น ห้ามเปิดเผยชื่อ Wife

## Role abilities และเหตุการณ์พิเศษ

### Reporter

- ใช้ได้ครั้งเดียวต่อเกม โดยต้องเป็น Reporter ที่ยังมีชีวิต
- เลือกผู้เล่นอื่นที่ยังมีชีวิต แล้วรู้ initial role ของเป้าหมายนั้นแบบ private
- ถ้าเป้าหมายเป็น Wife ที่ transform แล้ว ยังรายงานว่า initial role คือ Wife
- ถ้า Detective ถูก promote เป็น Police ยังรายงานว่า initial role คือ Detective
- ใช้ได้ระหว่าง active play, bomb resolution และ police accusation
- ใช้ไม่ได้ก่อนเริ่มเกมหรือหลังเกมจบ
- การเลือกตัวเอง/คนตาย/เป้าหมายที่ไม่ valid ไม่กิน ability

### Bomber

- เมื่อ Bomber ตายจาก approved attack เกมหยุดการยืนยันการตายอื่นชั่วคราว
- ชื่อและบทบาท Bomber ถูกประกาศต่อสาธารณะทันที
- Host เลือกผู้เล่นที่ยังมีชีวิตและอยู่ใกล้ Bomber ที่สุด 0, 1 หรือ 2 คน
- ผู้ถูกเลือกตายทันที ไม่ว่ามีหัวใจเหลือเท่าไร
- ไม่มี chain reaction และ explosion ไม่ทำให้ Wife transform
- Explosion ที่ฆ่า Killer ห้ามเปิดเผยว่าเหยื่อเป็น Killer
- ถ้า explosion ฆ่า active Killers ครบ City ชนะทันที
- ถ้า explosion ฆ่า Police และไม่มี Detective ที่มีชีวิตให้ promote Killer ชนะทันที
- ผู้ถูกเลือกทั้งหมดใน explosion เดียวกันต้องถูก resolve พร้อมกันก่อนตรวจ victory/succession

### Police และ Detective

- Police ที่ยังมีชีวิตเลือก accuse ผู้เล่นที่ยังมีชีวิตได้ระหว่าง active play
- ถ้า target เป็น active Killer, City ชนะ
- ถ้า target ไม่ใช่ active Killer, Killer Side ชนะ
- เมื่อถึง final accusation time การโจมตีปกติหยุด และห้องเข้า `police-check`
- Standard event ใช้เวลา 22:00 ของวันที่ตกลงกัน โดยมักเป็นวันที่ 12
- ถ้า Police ถูก approved attack เกมจบและ City ชนะทันที โดย Police ไม่เสียหัวใจ
  และหลักฐานนั้นไม่กิน quota
- ถ้า Police ตาย จะ promote Detective ที่ยังมีชีวิตเป็น Police แบบ private
- ถ้า Police ตายและไม่มี Detective ที่ยังมีชีวิต Killer Side ชนะทันที
- Detective ตายก่อน Police ไม่ทำให้เกมจบทันที

## Victory conditions

City ชนะเมื่อ:

1. Police accuse active Killer ได้ถูกต้อง
2. Police ถูก approved attack
3. Bomber explosion ฆ่า active Killers ครบ
4. Host จบเกมเอง (ผลเชิง gameplay เป็น null)

Killer Side ชนะเมื่อ:

1. Police accuse ผิด
2. Police ตายและไม่มี Detective เหลือให้ promote
3. Bomber explosion ฆ่า Police และไม่มี Detective เหลือ

Killer ไม่ถูกฆ่าด้วย normal attack; วิธีฆ่า Killer คือ Bomber explosion หรือ
Police accusation ที่ถูกต้อง

## Information / privacy ที่มีผลต่อ balance

- ผู้เล่นเห็น role ของตัวเองเท่านั้นระหว่างเกม
- ผู้เล่น non-Killer เห็นเฉพาะหัวใจของตัวเอง
- Killer เห็นผลลัพธ์เชิง binary ของ evidence ของตัวเอง และหลัง Wife transform
  เห็น Killer อีกคนกับ progress ร่วมกัน
- Host เห็นทุก role, hearts, evidence และ event history
- Public death ปกติประกาศชื่อแต่ไม่เปิด role
- Bomber เป็น role ปกติที่เปิดเผยเมื่อตาย
- Approved attack มี public announcement แบบ anonymous แต่ผู้ถูกโจมตีจะได้รับ private warning
- หลังจบเกม ผู้เล่นที่ได้รับอนุญาตเห็น end-game summary ของ initial/current role และ team

## Implementation context ที่ควรบอกผู้วิเคราะห์

- เกมไม่มี turn/round structure และไม่มีการบังคับจำนวน action ต่อชั่วโมงนอกจาก lethal quota
- ความเร็วเกมจึงขึ้นกับการเดิน/ถ่ายรูปจริง, Host review latency, จำนวนผู้เล่น online,
  และเวลาที่ตกลงกัน
- `nearest` ของ Bomber เป็นการตัดสินใจของ Host ยังไม่ได้มี distance model ในกฎกลาง
- Host สามารถกำหนด role composition ได้ ทำให้จำนวนผู้เล่นและจำนวน special role แตกต่างจาก standard setup
- Quota เป็น quota ของ “kills” ไม่ใช่จำนวนรูปหรือจำนวนการโจมตี
- Wife transformation ต้องผ่าน quota เดียวกับ kill ปกติ และ quota ใหม่ 3 ยังนับ usage เดิมในชั่วโมงนั้น
- การตายของ Bomber ทำให้เกิดช่วง pause และ Host มีอำนาจเลือกเหยื่อ 0–2 คน
- ระบบเป็น asynchronous/multi-day จึงควรประเมินทั้ง game length, idle time และผลของเวลาที่เริ่มเกม

## สิ่งที่ยังควรถือเป็นสมมติฐาน/คำถามเปิด

1. ระยะทางหรือคำว่า “ใกล้ที่สุด” ของ Bomber ใช้เกณฑ์อะไรในการเล่นจริง
2. ผู้เล่นเคลื่อนที่ได้อิสระแค่ไหน และมีข้อจำกัดเรื่องการอยู่สถานที่เดียวกันหรือไม่
3. โดยเฉลี่ย Host ใช้เวลากี่นาทีในการ approve/reject evidence
4. ผู้เล่นมีโอกาสถ่ายรูปและส่งหลักฐานได้กี่ครั้งต่อชั่วโมงในทางปฏิบัติ
5. เวลาจริงที่ผู้เล่นเริ่มเกมและ final accusation date/time ของแต่ละ session
6. ผู้เล่นรู้หรือไม่ว่า quota เหลือเท่าไร และรู้หรือไม่ว่า Wife ยังไม่ transform
7. หลัง Wife transform ผู้เล่นฝั่ง City รู้ข้อมูลอะไรเกี่ยวกับการมี Killer คนที่สองบ้าง
8. ต้องการ balance แบบ win-rate ใกล้ 50/50 หรือยอมให้ side ใด side หนึ่งได้เปรียบ
   เพื่อแลกกับความสนุก/ความตึงเครียด

## Prompt สำหรับ Project ChatGPT

คุณเป็น game balance designer ช่วยวิเคราะห์เกม hidden-role ชื่อ KILLER จากบริบทในเอกสารนี้
และไฟล์ `GAME_RULES.md` โดยถือ `GAME_RULES.md` เป็นกฎที่ authoritative ที่สุด

เป้าหมายคือหาความไม่สมดุลเชิงระบบ ไม่ใช่แค่เสนอไอเดีย role ใหม่ ขอให้วิเคราะห์ดังนี้:

1. ประเมินความได้เปรียบของ City, Killer Side และแต่ละ role ใน standard setup 12 คน
2. แยกวิเคราะห์กรณีเกมสั้น 4–8 ชั่วโมง, เกมข้ามคืน 1 วัน และเกมยาว 2 วัน
3. วิเคราะห์ผลของ lethal quota 2/ชั่วโมง, quota 3 หลัง Wife transform,
   quota ที่นับเฉพาะ kill, และการ reset ตามเวลา Bangkok
4. วิเคราะห์ว่า 2 hearts ของ role ส่วนใหญ่, 3 ของ Athlete, 4 ของ Sumo,
   และ Wife ที่ transform เมื่อโดนโจมตีครั้งที่สอง สร้าง breakpoint หรือกลยุทธ์ dominant หรือไม่
5. วิเคราะห์ผลของการไม่มี cooldown/protection/attack lock และการที่ non-lethal attack
   ไม่กิน quota โดยเฉพาะ spam pressure, target switching และการบังคับให้ Host review
6. วิเคราะห์ความแข็งแรงของ Police + Detective succession เทียบกับ Killer + Wife
7. วิเคราะห์ Bomber ในกรณีเลือกเหยื่อ 0, 1 หรือ 2 คน โดยแยกกรณีฆ่า Killer,
   Police, Detective, Wife ที่ transform แล้ว และผู้เล่น City ทั่วไป
8. วิเคราะห์ Reporter ว่าคุ้มค่าพอหรืออ่อน/แรงเกินไป เมื่อรู้ initial role แบบ private
9. เสนอ role composition ที่ควรใช้สำหรับจำนวนผู้เล่น 8, 10, 12, 14 และ 16 คน
   โดยยังเคารพข้อจำกัดว่า initial Killer exactly 1 และ Police อย่างน้อย 1
10. เสนอการปรับตัวเลขหรือกติกาอย่างน้อย 3 ระดับ:
    - minimal change: กระทบน้อยและแก้ง่าย
    - moderate change: ปรับ pacing/interaction อย่างชัดเจน
    - experimental: เปลี่ยนโครงสร้างเพื่อทดสอบ
11. ทุกข้อเสนอให้ระบุผลกระทบต่อ City, Killer Side, Police, Detective, Wife,
    Bomber, Reporter, Athlete, Sumo และ Villager
12. ห้ามสมมติว่ามี mechanics ที่เอกสารไม่ได้ระบุ ถ้าข้อมูลไม่พอให้บอกว่า
    ต้องเก็บ playtest data อะไรเพิ่ม

ขอผลลัพธ์ในรูปแบบ:

- Executive summary: ปัญหาสมดุลที่สำคัญที่สุด 3–5 ข้อ
- Assumptions และข้อมูลที่ยังขาด
- Role-by-role balance analysis
- Timing/quota analysis
- Scenario matrix ของ standard setup
- Recommended changes เรียงตาม priority พร้อมเหตุผลและ trade-off
- Playtest plan ที่ระบุ sample size, metrics, และเกณฑ์ตัดสินใจ

อย่าให้คำแนะนำแบบกว้าง ๆ เช่น “เพิ่ม/ลดพลัง” โดยไม่ระบุตัวเลขหรือเงื่อนไข
และแยกให้ชัดว่าอะไรคือข้อสรุปจากกฎที่มีอยู่ กับอะไรคือสมมติฐานหรือ inference
