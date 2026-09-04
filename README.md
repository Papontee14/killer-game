# Killer Mobile

เว็บเกม Killer แบบหลายเครื่องสำหรับ Host และผู้เล่นบนมือถือคนละเครื่อง

## เริ่มใช้งาน

```bash
npm install
npm run dev
```

หน้า Host สร้างห้องจาก `/` แล้วแชร์รหัสห้องให้เพื่อน ผู้เล่นเข้าด้วยรหัสห้องและชื่อที่ใช้แสดงในเกม เส้นทางเกมคือ `/room/[code]` และ `/room/[code]/host` ระบบ production ใช้ Supabase เป็น authoritative store, Realtime signal และ RPC transaction เท่านั้น ไม่มีการย้ายห้อง demo เดิมจาก `localStorage`

## Supabase production

ตั้งค่า `NEXT_PUBLIC_SUPABASE_URL` และ `NEXT_PUBLIC_SUPABASE_ANON_KEY` ให้ครบใน Vercel Production แล้วรัน [supabase/schema.sql](./supabase/schema.sql) ใน Supabase SQL Editor รูปถูกอัปโหลดไป private Storage และ Host ได้ signed URL อายุสั้นเท่านั้น ทุก mutation เรียก security-definer RPC. เมื่อถึงเวลาชี้ตัว ระบบจะเปลี่ยนห้องจาก `active` เป็น `police-check` ตอนที่สมาชิกห้องโหลดสถานะจาก Supabase โดยใช้เวลาจากฐานข้อมูล จึงไม่ต้องใช้ Vercel Cron หรือ service-role key.

โมเดลข้อมูลแยก `rooms`, `players`, `player_secrets`, `evidence` และ `room_events` พร้อม RLS ไม่ให้ผู้เล่นอ่านบทบาทหรือหัวใจของคนอื่น
