# Killer Mobile

เว็บเกม Killer แบบหลายเครื่องสำหรับ Host และผู้เล่นบนมือถือคนละเครื่อง

รุ่นปัจจุบันใช้กติกา **v2.4 Hunt Clock** สำหรับห้องใหม่: ค่าเริ่มต้น 13 คน,
Doctor, protection 45 นาที, rolling quotas และ Final Vote แบบลับ ห้องที่เล่นอยู่
ก่อนอัปเกรดยังใช้กฎ legacy จนจบ ดู [กติกาปัจจุบัน](GAME_RULES.md) และ
[ลำดับ migration, scheduler และ rollout](docs/V24_ROLLOUT.md) ก่อนเผยแพร่
ข้อความด้านล่างที่กล่าวถึง Police ชี้ตัวและ quota แบบต้นชั่วโมงใช้กับห้อง legacy เท่านั้น

## เริ่มใช้งาน

```bash
npm install
npm run dev
```

หน้า Host สร้างห้องจาก `/` แล้วแชร์รหัสห้องให้เพื่อน ผู้เล่นเข้าด้วยรหัสห้องและชื่อที่ใช้แสดงในเกม เส้นทางเกมคือ `/room/[code]` และ `/room/[code]/host` ระบบ production ใช้ Supabase เป็น authoritative store, Realtime signal และ RPC transaction เท่านั้น ไม่มีการย้ายห้อง demo เดิมจาก `localStorage`

## Supabase production

ตั้งค่า `NEXT_PUBLIC_SUPABASE_URL` และ `NEXT_PUBLIC_SUPABASE_ANON_KEY` ให้ครบใน Vercel Production แล้วรัน [supabase/schema.sql](./supabase/schema.sql) ใน Supabase SQL Editor รูปถูกอัปโหลดไป private Storage และ Host ได้ signed URL อายุสั้นเท่านั้น ทุก mutation เรียก security-definer RPC. เมื่อถึงเวลาชี้ตัว ระบบจะเปลี่ยนห้องจาก `active` เป็น `police-check` ตอนที่สมาชิกห้องโหลดสถานะจาก Supabase โดยใช้เวลาจากฐานข้อมูล จึงไม่ต้องใช้ Vercel Cron หรือ service-role key.

โมเดลข้อมูลแยก `rooms`, `players`, `player_secrets`, `evidence` และ `room_events` พร้อม RLS ไม่ให้ผู้เล่นอ่านบทบาทหรือหัวใจของคนอื่น

สำหรับฐานข้อมูลเดิม ให้รัน migration ตามลำดับจนถึง `supabase/migrations/20260905_end_game_summary.sql` ก่อนเผยแพร่หน้าเว็บรุ่นที่มีหน้าสรุปเกม (migration นี้ต้องตามหลัง `20260905_anonymous_attack_events.sql`) สมาชิกห้องจะอ่านเฉลยบทบาทและฝ่ายได้เฉพาะเมื่อเกมจบ รวมถึงหลัง Host ปิดห้อง โดยรูปหลักฐานและข้อมูลส่วนตัวอื่นยังใช้สิทธิ์เดิม

หน้าเว็บรองรับ RPC รุ่นเดิมที่ไม่ส่ง `endGameSummary` ผ่าน `POST /api/room/summary` ด้วย โดยต้องตั้ง `SUPABASE_SERVICE_ROLE_KEY` ใน environment ของเซิร์ฟเวอร์ (ห้ามใช้ prefix `NEXT_PUBLIC_`) เส้นทางนี้ตรวจสมาชิกและสถานะจบเกมด้วย RPC ภายใต้ token ของผู้เรียกก่อนอ่านเฉพาะบทบาทและฝ่าย ไม่มีการเปิดเผยหัวใจหรือหลักฐาน และไม่ cache ผลตอบกลับ หากโหลดไม่สำเร็จ หน้าเว็บจะลองใหม่ในการรีเฟรชสถานะห้องรอบถัดไป

## Server notification queue

รัน `supabase/migrations/20260907_server_notification_queue.sql` หลัง migration ปัจจุบัน แล้ว deploy ก่อนเปิดใช้งาน queue. ตั้งค่า Vercel server environment: `SUPABASE_SERVICE_ROLE_KEY`, `WEB_PUSH_PRIVATE_KEY`, `NEXT_PUBLIC_WEB_PUSH_PUBLIC_KEY`, `PUSH_DISPATCH_SECRET` และ `NEXT_PUBLIC_SITE_URL`.

เมื่อ route `/api/push/dispatch` พร้อมแล้ว ให้ตั้งค่า Supabase database settings `app.notification_queue_enabled=on`, `app.push_dispatch_url=https://<origin>/api/push/dispatch` และ `app.push_dispatch_secret` ให้ตรงกับ Vercel จากนั้นเรียก `select public.install_notification_cron();` เพียงครั้งเดียว. Cron จะตรวจ deadline และเรียก worker ทุกวินาที; `cron.job_run_details` ใช้ตรวจงานที่ผิดพลาดได้. ปิด queue ได้ทันทีด้วย `app.notification_queue_enabled=off` โดยข้อมูลเกมและคิวเดิมไม่ถูกลบ.

เมื่ออัปเดตกฎห้ามส่งรูปขณะโควต้าเต็ม ให้รัน `supabase/migrations/20260905_submission_quota.sql` หลัง migration ข้างต้น ก่อนเผยแพร่เว็บ โควต้ายังคงนับเฉพาะภาพที่ Host อนุมัติและรีเซ็ตเมื่อขึ้นชั่วโมงใหม่ตามเวลาไทย

หากหน้า Host เรียก `POST /rest/v1/rpc/end_game` แล้วได้ `404 Not Found` ให้รัน `supabase/migrations/20260905_restore_end_game_rpc.sql` ใน Supabase SQL Editor ของ production หลัง migration ก่อนหน้า ไฟล์นี้สร้าง/รีเฟรช `end_game` แบบรันซ้ำได้ กำหนดสิทธิ์ให้ผู้ใช้ที่ล็อกอินแล้ว และสั่ง PostgREST reload schema cache ทันที

ก่อนเผยแพร่หน้าสรุปผลที่อธิบายสาเหตุและลำดับเหตุการณ์จบเกม ให้รัน `supabase/migrations/20260907_kill_quota_and_police_protection.sql` แล้วตามด้วย `supabase/migrations/20260907_end_game_timeline.sql` และ `supabase/migrations/20260907_killer_wife_side.sql` ตามลำดับ. ไฟล์หลังเพิ่ม payload `endGameResult` และ `endGameTimeline` เฉพาะห้องที่จบแล้ว และกำหนดให้ Killer's Wife อยู่ Killer Side ตั้งแต่เริ่มเกม; เกมเก่าที่ไม่มีผลลัพธ์ที่บันทึกไว้จะแสดงว่าไม่มีข้อมูลเหตุผล แทนการอนุมานจากเหตุการณ์เดิม
