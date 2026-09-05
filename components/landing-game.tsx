"use client";
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  Crown,
  DoorOpen,
  Fingerprint,
  LockKeyhole,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { makeRoomCode } from "@/src/game";
import { rememberRoomCredentials } from "@/src/room-session";
import { Brand, Rules } from "./game-ui";
export function LandingGame() {
  const router = useRouter();
  const [mode, setMode] = useState<"join" | "host">("join");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [token, setToken] = useState("");
  const [rules, setRules] = useState(false);
  const [busy, setBusy] = useState(false);
  function continueToRoom(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || busy) return;
    const roomCode =
      mode === "host" ? makeRoomCode() : code.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(roomCode)) return;
    setBusy(true);
    rememberRoomCredentials(
      `${mode === "host" ? "host" : "player"}:${roomCode}`,
      { name: name.trim(), reclaimToken: recovery ? token : undefined },
    );
    router.push(`/room/${roomCode}${mode === "host" ? "/host" : ""}`);
  }
  return (
    <main className="entry-page">
      <header className="entry-header">
        <a href="/" aria-label="KILLER หน้าหลัก">
          <Brand small />
        </a>
        <button className="text-button" onClick={() => setRules(true)}>
          <BookOpen size={17} /> วิธีเล่น <ChevronRight size={15} />
        </button>
      </header>
      <div className="entry-layout">
        <section className="entry-story">
          <div
            className="entry-art"
            role="img"
            aria-label="ตัวละครลึกลับท่ามกลางเมืองยามค่ำคืน"
          />
          <div className="entry-story-content">
            <span className="eyebrow">
              <i /> เกมปาร์ตี้บทบาทลับ
            </span>
            <h1>
              <Brand />
            </h1>
            <h2>
              ทริปบางแสนนี้…
              <br />
              <span>พี่ไว้ใจใครได้บ้าง?</span>
            </h2>
            <p>
              เมื่อคนใกล้ตัวอาจเป็น Killer
              <br />
              ความลับของคุณ คือกุญแจของเกมนี้
            </p>
            <div className="story-tags">
              <span>
                <Users size={16} /> เล่นกับเพื่อนในชีวิตจริง
              </span>
              <span>
                <LockKeyhole size={16} /> คนละเครื่อง · คนละความลับ
              </span>
            </div>
          </div>
          <span className="art-caption">ค่ำคืนนี้ ทุกคนมีบางอย่างซ่อนอยู่</span>
        </section>
        <section className="entry-access">
          <div className="access-panel">
            <div
              className="mode-switch"
              role="tablist"
              aria-label="รูปแบบการเข้าเล่น"
            >
              <button
                role="tab"
                aria-selected={mode === "join"}
                className={mode === "join" ? "active" : ""}
                onClick={() => {
                  setMode("join");
                  setRecovery(false);
                }}
              >
                <DoorOpen size={18} /> เข้าร่วมเกม
              </button>
              <button
                role="tab"
                aria-selected={mode === "host"}
                className={mode === "host" ? "active" : ""}
                onClick={() => {
                  setMode("host");
                  setRecovery(false);
                }}
              >
                <Crown size={18} /> สร้างห้อง
              </button>
            </div>
            <div className="access-heading">
              <div className="access-icon">
                {recovery ? (
                  <Fingerprint size={24} />
                ) : mode === "host" ? (
                  <Crown size={24} />
                ) : (
                  <DoorOpen size={24} />
                )}
              </div>
              <span>ความลับกำลังรอคุณอยู่</span>
              <h2>
                {recovery
                  ? "กลับมาเป็นคุณคนเดิม"
                  : mode === "host"
                    ? "เริ่มเกมของคุณ"
                    : "เข้าห้องของเพื่อน"}
              </h2>
              <p>
                {recovery
                  ? "ใช้รหัสห้อง ชื่อเดิม และรหัสกู้คืนที่บันทึกไว้"
                  : mode === "host"
                    ? "คุณคือ Host ผู้ดูแลเกม ตั้งค่าบทบาทและตรวจหลักฐาน"
                    : "รับรหัสจาก Host แล้วเข้าร่วมความลับครั้งนี้"}
              </p>
            </div>
            <form onSubmit={continueToRoom}>
              {mode === "join" && (
                <label>
                  รหัสห้อง <small>6 ตัวอักษรหรือตัวเลข</small>
                  <input
                    aria-label="รหัสห้อง"
                    className="room-code-input"
                    required
                    minLength={6}
                    maxLength={6}
                    value={code}
                    onChange={(e) =>
                      setCode(
                        e.target.value
                          .replace(/[^a-z0-9]/gi, "")
                          .toUpperCase()
                          .slice(0, 6),
                      )
                    }
                    placeholder="เช่น K9P2MX"
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
              )}
              <label>
                {mode === "host" ? "ชื่อ Host" : "ชื่อผู้เล่น"}
                <input
                  aria-label={mode === "host" ? "ชื่อ Host" : "ชื่อผู้เล่น"}
                  required
                  maxLength={24}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={
                    mode === "host"
                      ? "ชื่อที่ผู้เล่นจะเห็น"
                      : "ชื่อที่เพื่อนเรียกคุณ"
                  }
                />
                <span className="input-hint">
                  ใช้ชื่อที่เพื่อนรู้จัก <span>{name.length}/24</span>
                </span>
              </label>
              {recovery && (
                <label>
                  รหัสกู้คืน
                  <input
                    required
                    value={token}
                    onChange={(e) => setToken(e.target.value.trim())}
                    autoComplete="off"
                    placeholder="รหัสที่บันทึกตอนเข้าร่วมครั้งแรก"
                  />
                </label>
              )}
              <button className="primary-action" type="submit" disabled={busy}>
                <span>
                  {busy
                    ? "กำลังเข้าห้อง…"
                    : recovery
                      ? "กู้คืนตัวละคร"
                      : mode === "host"
                        ? "สร้างห้อง"
                        : "เข้าสู่เกม"}
                </span>
                <ArrowRight size={19} />
              </button>
            </form>
            {mode === "join" && (
              <button
                className="recovery-link"
                onClick={() => setRecovery(!recovery)}
              >
                <Fingerprint size={16} />
                {recovery
                  ? "กลับไปเข้าร่วมเกม"
                  : "เคยเข้าร่วมแล้ว? กู้คืนตัวละคร"}
              </button>
            )}
            <div className="access-reassurance">
              <ShieldCheck size={18} />
              <p>
                ไม่ต้องสมัครบัญชี · ไม่ต้องใช้อีเมล
                <br />
                <span>แค่มีเพื่อนและโทรศัพท์ ก็เริ่มเกมได้</span>
              </p>
            </div>
          </div>
        </section>
      </div>
      <footer className="entry-footer">
        <span>
          <span className="live-dot" /> ความลับเริ่มต้น เมื่อทุกคนพร้อม
        </span>
        <span>
          9 บทบาท <i /> 1 เมือง <i /> ไม่มีใครน่าไว้ใจ
        </span>
      </footer>
      {rules && <Rules onClose={() => setRules(false)} />}
    </main>
  );
}
