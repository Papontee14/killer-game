"use client";

import { ArrowRight, Crown, DoorOpen, ShieldCheck, Users } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { makeRoomCode } from "@/src/game";
import { rememberRoomCredentials } from "@/src/room-session";

export function LandingGame() {
  const router = useRouter();
  const [mode, setMode] = useState<"join" | "host">("join");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  function continueToRoom(event: React.FormEvent) {
    event.preventDefault();
    const roomCode = code.trim().toUpperCase();
    if (mode === "join" && roomCode.length !== 6) return;
    const identity = name.trim() || (mode === "host" ? "Host" : "ผู้เล่น");
    if (mode === "host") {
      const roomCode = makeRoomCode();
      rememberRoomCredentials(`host:${roomCode}`, { name: identity });
      router.push(`/room/${roomCode}/host`);
    } else {
      rememberRoomCredentials(`player:${roomCode}`, { name: identity });
      router.push(`/room/${roomCode}`);
    }
  }
  return <main className="landing-shell">
    <section className="brand-panel"><div className="brand-lockup"><span className="brand-kicker"><span className="live-dot" /> LIVE PARTY GAME</span><h1>KILLER</h1><p>จับภาพให้ได้ก่อนที่ทุกคนจะรู้ตัว<br />เกมลับที่เกิดขึ้นรอบตัวคุณ</p></div><div className="signal-grid" aria-hidden="true"><span>K</span><span>12</span><span>?</span><span>02</span></div><div className="feature-strip"><span><ShieldCheck size={16} /> บทบาทเป็นความลับ</span><span><Users size={16} /> เล่นพร้อมกันหลายเครื่อง</span></div></section>
    <section className="access-panel"><div className="mode-switch" role="tablist" aria-label="รูปแบบการเข้าเล่น"><button className={mode === "join" ? "active" : ""} onClick={() => setMode("join")}><DoorOpen size={17} /> เข้าร่วม</button><button className={mode === "host" ? "active" : ""} onClick={() => setMode("host")}><Crown size={17} /> Host</button></div><div className="access-heading"><span>{mode === "host" ? "CONTROL ROOM" : "JOIN THE HUNT"}</span><h2>{mode === "host" ? "สร้างและควบคุมเกม" : "เข้าห้องของเพื่อน"}</h2><p>{mode === "host" ? "รหัสห้องจะถูกสุ่มให้อัตโนมัติ ตั้งค่าบทบาท ตรวจรูป และประกาศเหตุการณ์" : "กรอกรหัสห้องและชื่อผู้เล่น"}</p></div><form onSubmit={continueToRoom}>{mode === "join" && <label>รหัสห้อง<input required value={code} onChange={(e) => setCode(e.target.value.replace(/[^a-z0-9]/gi, "").slice(0, 6))} placeholder="เช่น K9P2MX" autoCapitalize="characters" /></label>}<label>{mode === "host" ? "ชื่อ Host" : "ชื่อผู้เล่น"}<input required value={name} onChange={(e) => setName(e.target.value.slice(0, 24))} placeholder={mode === "host" ? "ผู้ดูแลเกม" : "ชื่อที่เพื่อนเรียกคุณ"} /></label><button className="primary-action" type="submit"><span>{mode === "host" ? "เปิดห้องควบคุม" : "เข้าสู่เกม"}</span><ArrowRight size={19} /></button></form><p className="demo-note">ใช้รหัสห้องเพื่อเข้าร่วมเกม ชื่อผู้เล่นใช้สำหรับแสดงในห้องเท่านั้น</p></section>
  </main>;
}
