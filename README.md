# Killer Mobile

เว็บเกม Killer แบบหลายเครื่องสำหรับ Host และผู้เล่นบนมือถือคนละเครื่อง

## เริ่มใช้งาน

```bash
npm install
npm run dev
```

หน้า Host สร้างห้องจาก `/` แล้วแชร์รหัสห้องและ PIN ผู้เล่นให้เพื่อน เส้นทางเกมคือ `/room/[code]` และ `/room/[code]/host` ระบบ production ใช้ Supabase เป็น authoritative store, Realtime signal และ RPC transaction เท่านั้น ไม่มีการย้ายห้อง demo เดิมจาก `localStorage`

## Supabase production

ตั้งค่า `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` และ `CRON_SECRET` แล้วรัน [supabase/schema.sql](./supabase/schema.sql) ใน Supabase SQL Editor รูปถูกอัปโหลดไป private Storage และ Host ได้ signed URL อายุสั้นเท่านั้น ทุก mutation เรียก security-definer RPC; ตั้ง HTTP cron ทุก 1 นาทีไปที่ `/api/cron/accusation` พร้อม `Authorization: Bearer <CRON_SECRET>`

โมเดลข้อมูลแยก `rooms`, `players`, `player_secrets`, `evidence` และ `room_events` พร้อม RLS ไม่ให้ผู้เล่นอ่านบทบาทหรือหัวใจของคนอื่น
