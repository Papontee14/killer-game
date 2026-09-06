"use client";
import {
  BookOpen,
  ChevronRight,
  Fingerprint,
  QrCode,
  ShieldCheck,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { PixelButton, PixelIcon } from "./pixel-ui";
import { useRouter } from "next/navigation";
import { makeRoomCode } from "@/src/game";
import { rememberRoomCredentials } from "@/src/room-session";
import { Brand, Rules } from "./game-ui";
import { QrScannerDialog } from "./qr-scanner-dialog";
export function LandingGame({ initialCode = "" }: { initialCode?: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<"join" | "host">("join");
  const [view, setView] = useState<"home" | "join" | "host">(initialCode ? "join" : "home");
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState("");
  const [recovery, setRecovery] = useState(false);
  const [token, setToken] = useState("");
  const [rules, setRules] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const sync = () => {
      const screen = window.location.hash.slice(1);
      const next = screen === "join" || screen === "host" ? screen : initialCode && screen !== "home" ? "join" : "home";
      setView(next);
      if (next !== "home") setMode(next);
      setRecovery(false);
      setScannerOpen(false);
      setBusy(false);
    };
    sync();
    window.addEventListener("popstate", sync);
    window.addEventListener("hashchange", sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener("hashchange", sync);
    };
  }, [initialCode]);
  useEffect(() => { headingRef.current?.focus(); }, [view]);
  function openView(next: "home" | "join" | "host") {
    window.history.pushState({ ...window.history.state, killerEntry: true }, "", `#${next}`);
    setView(next);
    if (next !== "home") setMode(next);
    setRecovery(false);
    setBusy(false);
  }
  function backToHome() {
    if (window.history.state?.killerEntry && view !== "home") window.history.back();
    else openView("home");
  }
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
    <main className={`entry-page entry-${view}`}>
      <header className="entry-header">
        <a href="/" aria-label="KILLER หน้าหลัก">
          <Brand small />
        </a>
        <button className="text-button" onClick={() => setRules(true)}>
          <BookOpen size={17} /> วิธีเล่น <ChevronRight size={15} />
        </button>
      </header>
      <div className="entry-layout">
        {view === "home" ? <>
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
            <h1 ref={headingRef} tabIndex={-1}>
              <Brand />
            </h1>
            <h2>
              ในกลุ่มเพื่อนนี้…
              <br />
              <span>คุณไว้ใจใครได้บ้าง?</span>
            </h2>
            <p>
              รับบทบาทลับ เล่นกับเพื่อนรอบตัว
              <br />
              Killer แอบถ่ายเป้าหมาย ส่วนฝ่ายเมืองช่วยกันหาตัวคนร้าย
            </p>
          </div>
        </section>
        <section className="entry-menu" aria-label="เริ่มเล่น KILLER">
          <span className="eyebrow">TRUST NO ONE</span>
          <h2>พร้อมเข้าร่วม<br /><span>ความลับครั้งนี้?</span></h2>
          <p>เพื่อนกลุ่มเดิม…<br />แต่ทุกคนมีความลับของตัวเอง</p>
          <PixelButton variant="primary" onClick={() => openView("join")}><PixelIcon name="users" /><span>เข้าร่วมเกม</span><PixelIcon name="arrow" /></PixelButton>
          <PixelButton onClick={() => openView("host")}><PixelIcon name="crown" /><span>สร้างห้อง</span><PixelIcon name="arrow" /></PixelButton>
          <PixelButton onClick={() => setRules(true)}><PixelIcon name="book" /><span>วิธีเล่น</span><PixelIcon name="arrow" /></PixelButton>
          <div className="entry-menu-note"><span className="live-dot" /> ไม่ต้องสมัครบัญชี แค่มีเพื่อนก็เริ่มได้</div>
        </section>
        </> : <section className="entry-access">
          <div className="access-panel">
            <div className="entry-form-header"><button type="button" className="icon-button" aria-label="กลับหน้าหลัก" onClick={backToHome}><PixelIcon name="back" /></button><h1 ref={headingRef} tabIndex={-1}>{mode === "host" ? "สร้างห้อง" : "เข้าร่วมเกม"}</h1><span aria-hidden="true">{mode === "host" ? "01" : "02"}</span></div>
            <div className={`entry-form-art art-${mode}`} role="img" aria-label={mode === "host" ? "โต๊ะจัดเกมท่ามกลางเมืองกลางคืนแบบ pixel" : "ตัวละครถือโทรศัพท์ในตรอกเมืองแบบ pixel"} />
            <div className="entry-form-body">
            <div className="access-heading">
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
                  <span className="room-code-label-row">
                    <span>รหัสห้อง <small>6 ตัวอักษรหรือตัวเลข</small></span>
                    <button
                      type="button"
                      className="scan-qr-btn"
                      onClick={() => setScannerOpen(true)}
                      aria-label="สแกน QR เพื่อเข้าห้อง"
                    >
                      <QrCode size={16} /> สแกน QR
                    </button>
                  </span>
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
                  ref={nameInputRef}
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
                  ใช้ชื่อที่เพื่อนรู้จัก · ไม่เกิน 24 ตัวอักษร
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
                <PixelIcon name="arrow" size={24} />
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
          </div>
        </section>}
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
      {scannerOpen && (
        <QrScannerDialog
          onScanSuccess={(scannedCode) => {
            setCode(scannedCode);
            setScannerOpen(false);
            setTimeout(() => {
              nameInputRef.current?.focus();
            }, 100);
          }}
          onClose={() => setScannerOpen(false)}
        />
      )}
    </main>
  );
}
