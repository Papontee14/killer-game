"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Camera, Check, ChevronLeft, Clock3, DoorOpen, Eye, Heart, Hourglass, Radio, Shield, Skull, Trophy, X } from "lucide-react";
import { approveEvidence, beginPoliceCheck, rejectEvidence, resolveBomb, resolvePoliceCheck, startGame, submitEvidence, syncClock, useReporter } from "@/src/game";
import { createOrLoadRoom, deleteRoom, joinOrCreateDemo, loadRoom, saveRoom } from "@/src/room-store";
import { DEFAULT_ROLE_COUNTS, ROLE_HEARTS, ROLE_LABELS, type PrivatePlayerState, type Role, type RoomState } from "@/src/types";

function useRoom(code: string) {
  const [room, setRoom] = useState<RoomState | null>(null);
  useEffect(() => {
    const refresh = () => setRoom(loadRoom(code));
    refresh();
    const handler = (event: Event) => { if ((event as CustomEvent).detail === code) refresh(); };
    window.addEventListener("storage", refresh);
    window.addEventListener("killer-room-update", handler);
    const timer = window.setInterval(() => { const current = loadRoom(code); if (!current) return; const next = syncClock(current); if (next.attackHour !== current.attackHour) saveRoom(next); else setRoom(current); }, 10000);
    return () => { window.removeEventListener("storage", refresh); window.removeEventListener("killer-room-update", handler); window.clearInterval(timer); };
  }, [code]);
  function update(fn: (current: RoomState) => RoomState) { if (!room) return; const next = fn(room); saveRoom(next); setRoom(next); }
  return [room, update] as const;
}

function Header({ code, label, back = false, action }: { code: string; label: string; back?: boolean; action?: ReactNode }) {
  return <header className="topbar"><a className="back-link" href={back ? "/" : undefined}>{back ? <ChevronLeft size={17} /> : <Radio size={17} />}</a><span className="topbar-title">{label}</span><div className="topbar-actions">{action}<span className="room-chip">ROOM <b>{code}</b></span></div></header>;
}
function Events({ room, limit = 6, viewerId, viewerIsKiller = false }: { room: RoomState; limit?: number; viewerId?: string; viewerIsKiller?: boolean }) {
  const visible = viewerId ? room.events.filter((item) => !item.playerId || item.playerId === viewerId || (viewerIsKiller && item.type === "attack")).slice(0, limit) : room.events.slice(0, limit);
  return <div className="event-feed">{visible.map((item) => <div className={`event-row event-${item.type}`} key={item.id}><span className="event-mark">{item.type === "warning" || item.type === "bomb" ? <AlertTriangle size={14} /> : item.type === "winner" ? <Shield size={14} /> : <Radio size={14} />}</span><div><p>{viewerId && item.type === "attack" ? (room.players.find((player) => player.id === item.playerId)?.health === "dead" ? "กำจัดสำเร็จ" : "เป้าหมายยังไม่ตาย") : item.message}</p><time>{new Date(item.createdAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}</time></div></div>)}</div>;
}
function Hearts({ count, max, muted = false }: { count: number; max: number; muted?: boolean }) {
  return <span className={`hearts ${muted ? "muted-hearts" : ""}`}>{Array.from({ length: max }, (_, index) => <Heart key={index} size={15} fill={index < count ? "currentColor" : "none"} />)}</span>;
}
function PlayerCard({ player, state, reveal = true }: { player: RoomState["players"][number]; state?: PrivatePlayerState; reveal?: boolean }) {
  return <div className={`player-card ${player.health === "dead" ? "is-dead" : ""}`}><span className="avatar">{player.name.slice(0, 1).toUpperCase()}</span><div className="player-meta"><strong>{player.name}</strong><small>{reveal && state ? ROLE_LABELS[state.role] : player.health === "dead" ? "กำจัดแล้ว" : "ผู้เล่น"}</small></div>{reveal && state ? <Hearts count={state.hearts} max={state.maxHearts} /> : <span className={`status-pill ${player.isOnline ? "online" : "offline"}`}>{player.isOnline ? "ONLINE" : "OFFLINE"}</span>}</div>;
}
function ErrorBanner({ error }: { error: string }) { return error ? <div className="error-banner"><AlertTriangle size={16} /> {error}</div> : null; }
function LobbyWaitingScreen({ room }: { room: RoomState }) {
  return <main className="lobby-waiting-screen"><div className="waiting-grid" /><div className="waiting-stage" aria-hidden="true"><div className="waiting-ring waiting-ring-one" /><div className="waiting-ring waiting-ring-two" /><div className="waiting-crosshair" /><Skull className="waiting-skull" size={56} /></div><div className="waiting-copy"><span className="section-kicker">KILLER // ROOM {room.code}</span><h1>KILLER</h1><p>รอ Host แจกบทบาทอยู่...</p><div className="waiting-status"><span /> WAITING FOR HOST</div></div></main>;
}
function QuotaCooldownNotice({ minutes }: { minutes: number }) {
  return <div className="quota-cooldown-notice" role="status" aria-live="polite"><Clock3 size={24} /><div><span className="section-kicker">KILL QUOTA LOCKED</span><strong>ใช้โควต้าการคิลครบแล้ว</strong><p>รอประมาณ {minutes} นาที โควต้าจะรีเซตและส่งหลักฐานได้อีกครั้ง</p></div></div>;
}
function GameEndedNotice({ room, isWinner, hostView = false }: { room: RoomState; isWinner?: boolean; hostView?: boolean }) {
  if (room.phase !== "ended") return null;
  const winner = room.winner === "city" ? "ฝ่ายเมือง" : room.winner === "killers" ? "ฝ่าย Killer" : null;
  const outcome = hostView ? (room.winner === "killers" ? "loser" : room.winner === "city" ? "winner" : "neutral") : isWinner === true ? "winner" : isWinner === false ? "loser" : winner ? "winner" : "neutral";
  const heading = hostView ? "เกมจบแล้ว" : isWinner === true ? "คุณชนะ" : isWinner === false ? "คุณแพ้" : "เกมจบแล้ว";
  return <div className={`game-ended-notice outcome-${outcome}`} role="alert" aria-live="assertive"><Trophy size={30} /><div><span className="section-kicker">GAME OVER</span><h2>{heading}</h2>{winner ? <p className="game-winner"><span>{isWinner === false ? "ฝ่ายที่ชนะ" : "ผู้ชนะ"}</span>{winner}</p> : <p>ผลการแข่งขันสรุปแล้ว</p>}</div></div>;
}

export function HostRoom({ code, name, pin }: { code: string; name: string; pin: string }) {
  const router = useRouter();
  const [room, update] = useRoom(code);
  const [error, setError] = useState("");
  const [isLeaving, setIsLeaving] = useState(false);
  const [counts, setCounts] = useState(DEFAULT_ROLE_COUNTS);
  const [bombSelection, setBombSelection] = useState<string[]>([]);
  useEffect(() => { if (!room && !isLeaving) { try { saveRoom(createOrLoadRoom(code, name, pin, "1234")); } catch (e) { setError(e instanceof Error ? e.message : "เปิดห้องไม่ได้"); } } }, [room, code, name, pin, isLeaving]);
  if (!room) return <main className="loading-screen"><Hourglass /> {error || "กำลังเปิดห้อง..."}</main>;
  const pending = room.evidences.filter((item) => item.status === "pending");
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const adjust = (role: Role, delta: number) => setCounts((current) => ({ ...current, [role]: Math.max(role === "killer" || role === "police" ? 1 : 0, Math.min(role === "villager" ? 20 : 1, current[role] + delta)) }));
  const act = (fn: () => RoomState) => { try { setError(""); update(() => fn()); } catch (e) { setError(e instanceof Error ? e.message : "เกิดข้อผิดพลาด"); } };
  const leaveRoom = () => {
    if (!window.confirm("ต้องการออกจากห้องนี้ใช่หรือไม่ ห้องจะถูกปิดและผู้เล่นจะเข้าร่วมไม่ได้อีก")) return;
    setIsLeaving(true);
    deleteRoom(room.code);
    router.replace("/");
  };
  const finishGame = () => {
    if (!window.confirm("ต้องการจบเกมและปิดห้องนี้ใช่หรือไม่")) return;
    setIsLeaving(true);
    deleteRoom(room.code);
    router.replace("/");
  };
  const hostAction = room.phase === "lobby"
    ? <button type="button" className="topbar-btn danger" onClick={leaveRoom}><DoorOpen size={15} /> ออกจากห้อง</button>
    : room.phase === "ended"
      ? <button type="button" className="topbar-btn danger" onClick={finishGame}><Check size={15} /> จบเกม</button>
      : null;
  return <main className="app-shell"><Header code={room.code} label="CONTROL ROOM" action={hostAction} /><div className="host-layout"><section className="main-column"><div className="page-intro"><div><span className="section-kicker">{room.phase === "lobby" ? "LOBBY / SETUP" : "LIVE OPERATION"}</span><h1>{room.phase === "lobby" ? "ตั้งค่าเกม" : "ภาพรวมภารกิจ"}</h1></div><div className={`phase-badge phase-${room.phase}`}><span />{room.phase === "lobby" ? "รอเริ่มเกม" : room.phase === "ended" ? "จบเกม" : room.phase === "bomb-resolution" ? "จัดการระเบิด" : "กำลังเล่น"}</div></div>
    <GameEndedNotice room={room} hostView />
    {room.phase === "lobby" ? <div className="panel setup-panel"><div className="panel-heading"><div><span className="section-kicker">ROLE LOADOUT</span><h2>กำหนดบทบาท</h2></div><span className="count-total">{total} คน</span></div><div className="role-grid">{(Object.keys(DEFAULT_ROLE_COUNTS) as Role[]).map((role) => <div className="role-control" key={role}><div><strong>{ROLE_LABELS[role]}</strong><small>{ROLE_HEARTS[role] || "ไม่มีหัวใจ"} หัวใจ</small></div><div className="stepper"><button onClick={() => adjust(role, -1)}>-</button><b>{counts[role]}</b><button onClick={() => adjust(role, 1)}>+</button></div></div>)}</div><button className="primary-action start-btn" disabled={room.players.length !== total} onClick={() => act(() => startGame(room, counts))}><span>เริ่มแจกบทบาท ({room.players.length}/{total})</span><Radio size={18} /></button></div> : <>
      <div className="metric-grid"><div className="metric-card"><small>ผู้เล่น</small><strong>{room.players.length}</strong><span>คนในห้อง</span></div><div className="metric-card"><small>โควต้าชั่วโมงนี้</small><strong>{room.attackLimit - room.attacksThisHour}<em>/{room.attackLimit}</em></strong><span>การโจมตีคงเหลือ</span></div><div className="metric-card"><small>หลักฐานรอตรวจ</small><strong className={pending.length ? "amber-text" : ""}>{pending.length}</strong><span>คิวตรวจรูป</span></div></div>
      {room.phase === "active" && <button className="secondary-action police-trigger" onClick={() => act(() => beginPoliceCheck(room))}>หยุดเกมเพื่อให้ตำรวจชี้ตัว <Shield size={16} /></button>}
      {room.phase === "police-check" && <div className="panel bomb-panel"><div className="panel-heading"><div><span className="section-kicker danger-kicker">FINAL CHECK</span><h2>รอตำรวจชี้ตัว</h2></div><Shield className="danger-icon" /></div><p className="muted">ตำรวจจะเห็นหน้าจอชี้ตัวบนเครื่องของตนเอง</p></div>}
      {room.phase === "bomb-resolution" && <div className="panel bomb-panel"><div className="panel-heading"><div><span className="section-kicker danger-kicker">BOMB PROTOCOL</span><h2>เลือกผู้เล่นใกล้ที่สุด 0–2 คน</h2></div><Skull className="danger-icon" /></div><p className="muted">ผู้ถูกเลือกจะตายทันที ไม่มีเอฟเฟกต์ลูกโซ่</p><div className="bomb-grid">{room.players.filter((p) => p.health !== "dead").map((player) => <button className={bombSelection.includes(player.id) ? "selected" : ""} key={player.id} onClick={() => setBombSelection((current) => current.includes(player.id) ? current.filter((id) => id !== player.id) : current.length < 2 ? [...current, player.id] : current)}><span className="avatar">{player.name.slice(0, 1)}</span>{player.name}<Check size={16} /></button>)}</div><button className="danger-action" onClick={() => act(() => resolveBomb(room, bombSelection))}>ดำเนินการระเบิด <Skull size={16} /></button></div>}
      <div className="panel"><div className="panel-heading"><div><span className="section-kicker">EVIDENCE QUEUE</span><h2>คิวตรวจรูปโจมตี</h2></div><span className="queue-count">{pending.length} PENDING</span></div>{pending.length === 0 ? <div className="empty-state"><Camera size={25} /><p>ยังไม่มีหลักฐานรอการตรวจ</p><small>เมื่อ Killer ส่งรูป รายการจะปรากฏที่นี่ทันที</small></div> : <div className="evidence-grid">{pending.map((item) => <div className="evidence-card" key={item.id}><img src={item.imageData} alt="หลักฐานการโจมตี" /><div className="evidence-info"><div><strong>{room.players.find((p) => p.id === item.killerId)?.name}</strong><small>เลือกเป้าหมาย: {room.players.find((p) => p.id === item.targetId)?.name}</small></div><div className="evidence-actions"><button className="approve-action" onClick={() => act(() => approveEvidence(room, item.id))}><Check size={17} /> อนุมัติ</button><button className="reject-action" onClick={() => act(() => rejectEvidence(room, item.id))}><X size={17} /> ปฏิเสธ</button></div></div></div>)}</div>}</div>
      <div className="panel"><div className="panel-heading"><div><span className="section-kicker">PLAYER MONITOR</span><h2>ผู้เล่นทั้งหมด</h2></div><span className="muted">Host เห็นข้อมูลทั้งหมด</span></div><div className="players-grid">{room.players.map((player) => <PlayerCard key={player.id} player={player} state={room.privateStates[player.id]} />)}</div></div>
    </>}
    <ErrorBanner error={error} />
  </section><aside className="side-column"><div className="panel room-info"><span className="section-kicker">ROOM ACCESS</span><div className="big-code">{room.code}</div><p>แชร์รหัสนี้ให้ผู้เล่น</p><div className="pin-row"><span>PIN ผู้เล่น</span><b>{room.playerPin}</b></div><div className="online-line"><span /> <b>{room.players.length}</b> คนในห้อง</div></div><div className="panel"><div className="panel-heading"><h2>บันทึกเหตุการณ์</h2><Clock3 size={16} className="muted" /></div><Events room={room} /></div></aside></div></main>;
}

export function PlayerRoom({ code, name, pin }: { code: string; name: string; pin: string }) {
  const [room, update] = useRoom(code);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState("");
  const [reportTarget, setReportTarget] = useState("");
  const [photo, setPhoto] = useState("");
  const [error, setError] = useState("");
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => { const timer = window.setInterval(() => setClock(new Date()), 30000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { try { const joined = joinOrCreateDemo(code, name, pin); if (joined) setPlayerId(joined.playerId); else setError("ไม่พบห้องนี้ หรือ Host ยังไม่ได้เปิดห้อง"); } catch (e) { setError(e instanceof Error ? e.message : "เข้าใช้ห้องไม่ได้"); } }, [code, name, pin]);
  if (!room || !playerId) return <main className="loading-screen"><Hourglass /> {error || (playerId ? "ห้องนี้ถูกปิดโดย Host แล้ว" : "กำลังเชื่อมต่อห้อง...")}</main>;
  const me = room.privateStates[playerId];
  const myPlayer = room.players.find((p) => p.id === playerId);
  if (!me) return <LobbyWaitingScreen room={room} />;
  const act = (fn: () => RoomState) => { try { setError(""); update(() => fn()); } catch (e) { setError(e instanceof Error ? e.message : "เกิดข้อผิดพลาด"); } };
  const isKiller = me.isKillerSide;
  const quotaExhausted = isKiller && myPlayer?.health !== "dead" && room.phase === "active" && room.attackHour === clock.getHours() && room.attacksThisHour >= room.attackLimit;
  const minutesUntilReset = Math.max(1, Math.ceil((60 * 60 - (clock.getMinutes() * 60 + clock.getSeconds())) / 60));
  const target = room.players.find((p) => p.id === targetId);
  return <main className="app-shell player-app"><Header code={room.code} label="FIELD DEVICE" back /><div className="player-layout"><section className="main-column"><div className="player-hero"><span className="section-kicker">IDENTITY CONFIRMED</span><h1>{ROLE_LABELS[me.role]}</h1><p>{isKiller ? "คุณอยู่ฝ่ายลับ เลือกเป้าหมายและส่งหลักฐานให้ Host" : "บทบาทของคุณเป็นความลับ อย่าให้ใครเห็นหน้าจอนี้"}</p><div className="identity-stamp">{isKiller ? "KILLER SIDE" : "CITY SIDE"}</div></div>
    <GameEndedNotice room={room} isWinner={room.winner ? (room.winner === "killers") === isKiller : undefined} />
    {!isKiller && <>
    <div className="personal-health panel">{isKiller ? <><div><span className="section-kicker">STATUS</span><h2>ภารกิจยังดำเนินต่อ</h2></div><span className="status-pill online">NO HEART BAR</span></> : <><div><span className="section-kicker">YOUR HEARTS</span><h2 className={me.hearts <= 1 ? "danger-text" : ""}>{me.hearts} <small>/ {me.maxHearts}</small></h2></div><Hearts count={me.hearts} max={me.maxHearts} /></>}</div>
    </>}
    {quotaExhausted && <QuotaCooldownNotice minutes={minutesUntilReset} />}
    {isKiller && myPlayer?.health !== "dead" && <div className="panel action-panel"><div className="panel-heading"><div><span className="section-kicker">ATTACK CONSOLE</span><h2>เลือกเป้าหมาย</h2></div><span className="quota">{Math.max(0, room.attackLimit - room.attacksThisHour)} SHOTS LEFT</span></div><select value={targetId} onChange={(e) => setTargetId(e.target.value)} disabled={quotaExhausted}><option value="">เลือกผู้เล่น...</option>{room.players.filter((p) => p.id !== playerId && p.health !== "dead").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>{target && <div className="target-confirm"><span className="avatar">{target.name.slice(0, 1)}</span><div><strong>{target.name}</strong><small>ผลลัพธ์จะแสดงหลัง Host อนุมัติ</small></div><Eye size={17} /></div>}<label className="camera-drop"><Camera size={24} /><span>{photo ? "ภาพพร้อมส่งให้ Host ตรวจ" : "ถ่ายภาพสดเพื่อส่งหลักฐาน"}<small>ยังไม่เกิดความเสียหายจนกว่า Host จะอนุมัติ</small></span><input type="file" accept="image/*" capture="environment" disabled={quotaExhausted} onChange={(e) => { const file = e.target.files?.[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => setPhoto(String(reader.result)); reader.readAsDataURL(file); }} /></label><button className="primary-action" disabled={quotaExhausted || !targetId || !photo} onClick={() => { act(() => submitEvidence(room, playerId, targetId, photo)); setPhoto(""); }}>ส่งหลักฐานให้ Host <span>→</span></button></div>}
    {!isKiller && me.role === "police" && myPlayer?.health !== "dead" && room.phase === "police-check" && <div className="panel action-panel"><div className="panel-heading"><div><span className="section-kicker danger-kicker">POLICE CHECK</span><h2>ชี้ตัว Killer</h2></div><Shield size={19} /></div><p className="muted">เลือกผู้เล่นหนึ่งคน การตัดสินใจนี้จบเกมทันที</p><select value={targetId} onChange={(e) => setTargetId(e.target.value)}><option value="">เลือกผู้ต้องสงสัย...</option>{room.players.filter((p) => p.id !== playerId && p.health !== "dead").map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button className="danger-action" disabled={!targetId} onClick={() => act(() => resolvePoliceCheck(room, playerId, targetId))}>ยืนยันการชี้ตัว <Shield size={16} /></button></div>}
    {!isKiller && me.role === "reporter" && !me.hasUsedAbility && <div className="panel action-panel"><div className="panel-heading"><div><span className="section-kicker">REPORTER ABILITY</span><h2>ตรวจบทบาทเริ่มต้น</h2></div><Eye size={19} /></div><p className="muted">ใช้ได้ครั้งเดียว เป้าหมายจะรู้ว่าถูกตรวจ แต่ไม่รู้ว่าเป็นนักข่าว</p><select value={reportTarget} onChange={(e) => setReportTarget(e.target.value)}><option value="">เลือกผู้เล่น...</option>{room.players.filter((p) => p.id !== playerId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button className="secondary-action" disabled={!reportTarget} onClick={() => { const selected = room.privateStates[reportTarget]; act(() => useReporter(room, playerId, reportTarget)); window.alert(`บทบาทเริ่มต้นของ ${room.players.find((p) => p.id === reportTarget)?.name} คือ ${selected ? ROLE_LABELS[selected.role] : "ไม่ทราบ"}`); }}>ใช้ความสามารถ <Eye size={16} /></button></div>}
    {myPlayer?.health === "dead" && <div className="dead-card"><Skull size={27} /><div><strong>คุณถูกกำจัดแล้ว</strong><p>รับชมเกมต่อได้ แต่ไม่สามารถใช้ความสามารถได้</p></div></div>}
    <ErrorBanner error={error} /><div className="panel"><div className="panel-heading"><div><span className="section-kicker">LATEST SIGNALS</span><h2>ข่าวล่าสุด</h2></div></div><Events room={room} limit={8} viewerId={playerId} viewerIsKiller={isKiller} /></div>
  </section><aside className="side-column"><div className="panel privacy-note"><Shield size={19} /><strong>ข้อมูลส่วนตัว</strong><p>คุณเห็นหัวใจและบทบาทของคุณเท่านั้น ข้อมูลเป้าหมายจะไม่แสดงบนเครื่องนี้</p></div>{isKiller && <div className="panel killer-note"><Skull size={19} /><strong>สถานะเป้าหมาย</strong><p>หลัง Host อนุมัติ จะแจ้งเพียงว่าเป้าหมายยังไม่ตายหรือกำจัดสำเร็จ</p></div>}</aside></div></main>;
}
