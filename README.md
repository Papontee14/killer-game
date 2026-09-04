# Killer Mobile

เว็บเกม Killer แบบหลายเครื่องสำหรับ Host และผู้เล่นบนมือถือคนละเครื่อง

## เริ่มใช้งาน

```bash
npm install
npm run dev
```

หน้า Host สร้างห้องจาก `/` แล้วแชร์รหัสห้องและ PIN ผู้เล่นให้เพื่อน เส้นทางเกมคือ `/room/[code]` และ `/room/[code]/host` ระบบ demo ซิงก์ระหว่างแท็บด้วย `localStorage` และ event ของเบราว์เซอร์ เพื่อให้ทดสอบ flow ได้ทันทีโดยไม่ต้องมี backend

## Supabase production

ตั้งค่า `NEXT_PUBLIC_SUPABASE_URL` และ `NEXT_PUBLIC_SUPABASE_ANON_KEY` แล้วรัน [supabase/schema.sql](./supabase/schema.sql) ใน Supabase SQL Editor จากนั้นเปลี่ยน room adapter ใน `src/room-store.ts` เป็นการอ่านเขียนผ่าน Supabase client และเรียก `approve_evidence` สำหรับ transaction ฝั่ง server ส่วนรูปควรอัปโหลดไป private Storage bucket แล้วสร้าง signed URL ให้ Host เท่านั้น

โมเดลข้อมูลแยก `rooms`, `players`, `player_secrets`, `evidence` และ `room_events` พร้อม RLS ไม่ให้ผู้เล่นอ่านบทบาทหรือหัวใจของคนอื่น
