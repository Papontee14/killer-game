"use client";
/* The room credential bootstrap intentionally runs once per room code. */
/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Camera, Check, ChevronLeft, Clock3, DoorOpen, Download, Eye, Heart, Hourglass, Radio, Shield, Skull, Trophy, X } from "lucide-react";
import { approveEvidence, closeRoom, createOrLoadRoom, heartbeat, joinOrCreateDemo, loadRoom, rejectEvidence, reporterAbility, resolveBomb, resolvePoliceCheck, setAccusationAt, startGame, submitEvidence } from "@/src/room-store";
import { getSupabaseBrowser } from "@/src/supabase-browser";
import { readRoomCredentials, rememberRoomCredentials } from "@/src/room-session";
import { captureLivePhoto } from "@/src/camera";
import { DEFAULT_ROLE_COUNTS, ROLE_HEARTS, ROLE_LABELS, type PrivatePlayerState, type Role, type RoomState } from "@/src/types";
import { downloadEvidenceArchive } from "@/src/evidence-download";

let latestRoom: RoomState | null = null;
function useRoom(code: string) {
  const [room, setRoom] = useState<RoomState | null>(null);
  const replaceRoom = (next: RoomState | null) => { latestRoom = next; setRoom(next); };
  const refresh = () => loadRoom(code).then(replaceRoom).catch(() => undefined);
  useEffect(() => {
    let stopped = false;
    const refreshIfLive = () => loadRoom(code).then((next) => { if (!stopped) replaceRoom(next); }).catch(() => undefined);
    refreshIfLive();
    const timer = window.setInterval(refreshIfLive, 15000);
    const supabase = getSupabaseBrowser();
    const channel = supabase?.channel(`room-signal-${code}`).on("postgres_changes", { event: "*", schema: "public", table: "room_signals" }, refreshIfLive).subscribe();
    return () => { stopped = true; window.clearInterval(timer); if (channel) supabase?.removeChannel(channel); };
  }, [code]);
  const run = (operation: Promise<RoomState>) => operation.then(replaceRoom);
  return [room, refresh, run, replaceRoom] as const;
}

function Header({ code, label, back = false, action }: { code: string; label: string; back?: boolean; action?: ReactNode }) {
  return <header className="topbar"><a className="back-link" href={back ? "/" : undefined}>{back ? <ChevronLeft size={17} /> : <Radio size={17} />}</a><span className="topbar-title">{label}</span><div className="topbar-actions">{action}<span className="room-chip">ROOM <b>{code}</b></span></div></header>;
}
function ErrorBanner({ error }: { error: string }) { return error ? <div className="error-banner"><AlertTriangle size={16} /> {error}</div> : null; }
function Hearts({ count, max }: { count: number; max: number }) { return <span className="hearts">{Array.from({ length: max }, (_, index) => <Heart key={index} size={15} fill={index < count ? "currentColor" : "none"} />)}</span>; }
function PlayerCard({ player, state, host }: { player: RoomState["players"][number]; state?: PrivatePlayerState; host?: boolean }) {
  const visibleState = host && state;
  return <div className={`player-card ${player.health === "dead" ? "is-dead" : ""}`}><span className="avatar">{player.name.slice(0, 1).toUpperCase()}</span><div className="player-meta"><strong>{player.name}</strong><small>{visibleState ? ROLE_LABELS[state.currentRole] : player.health === "dead" ? "กำจัดแล้ว" : "ผู้เล่น"}</small></div>{visibleState ? <Hearts count={state.hearts} max={state.maxHearts} /> : <span className={`status-pill ${player.isOnline ? "online" : "offline"}`}>{player.isOnline ? "ONLINE" : "OFFLINE"}</span>}</div>;
}
function Events({ room, playerId }: { room: RoomState | boolean; playerId?: string }) {
  const resolvedRoom = typeof room === "boolean" ? latestRoom : room;
  if (!resolvedRoom) return null;
  const visible = playerId ? resolvedRoom.events.filter((event) => !event.playerId || event.playerId === playerId) : resolvedRoom.events;
  return <div className="event-feed">{visible.slice(0, 10).map((event) => <div className={`event-row event-${event.type}`} key={event.id}><span className="event-mark">{event.type === "warning" || event.type === "bomb" ? <AlertTriangle size={14} /> : event.type === "winner" ? <Shield size={14} /> : <Radio size={14} />}</span><div><p>{event.message}</p><time>{new Date(event.createdAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" })}</time></div></div>)}</div>;
}
function Ended({ room, host = false, winner }: { room: RoomState | boolean; host?: boolean; winner?: boolean }) {
  const resolvedRoom = typeof room === "boolean" ? latestRoom : room;
  if (!resolvedRoom || resolvedRoom.phase !== "ended") return null;
  return <div className={`game-ended-notice outcome-${host ? "winner" : winner ? "winner" : "loser"}`}><Trophy size={30} /><div><span className="section-kicker">GAME OVER</span><h2>{host ? "เกมจบแล้ว" : winner ? "คุณชนะ" : "คุณแพ้"}</h2><p>{resolvedRoom.winner === "city" ? "ฝ่ายเมืองชนะ" : "ฝ่าย Killer ชนะ"}</p></div></div>;
}
function Waiting({ room }: { room: RoomState }) { return <main className="lobby-waiting-screen"><div className="waiting-grid" /><Skull className="waiting-skull" size={56} /><div className="waiting-copy"><span className="section-kicker">KILLER // ROOM {room.code}</span><h1>KILLER</h1><p>รอ Host แจกบทบาทอยู่...</p><div className="waiting-status"><span /> WAITING FOR HOST</div></div></main>; }

export function HostRoom({ code, name, pin, playerPin }: { code: string; name?: string; pin?: string; playerPin?: string }) {
  const router = useRouter();
  const [room, , run, setRoom] = useRoom(code);
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState(false);
  const [counts, setCounts] = useState(DEFAULT_ROLE_COUNTS);
  const [bombSelection, setBombSelection] = useState<string[]>([]);
  const [accusationAt, setAccusationAtInput] = useState("");
  const hostCredentials = readRoomCredentials(`host:${code}`);
  const hostName = name || hostCredentials?.name || "Host";
  const hostPin = pin || hostCredentials?.pin || "";
  const sharedPlayerPin = playerPin || hostCredentials?.playerPin || "";
  useEffect(() => { if (!room && !leaving && hostPin && sharedPlayerPin) createOrLoadRoom(code, hostName, hostPin, sharedPlayerPin).then(setRoom).catch((e) => setError(e instanceof Error ? e.message : "เปิดห้องไม่ได้")); }, [room, code, hostName, hostPin, sharedPlayerPin, leaving, setRoom]);
  if (!room) return <main className="loading-screen"><Hourglass /> {error || "กำลังเชื่อมต่อห้อง..."}</main>;
  const act = (operation: Promise<RoomState>) => { setError(""); operation.catch((e) => setError(e instanceof Error ? e.message : "ดำเนินการไม่สำเร็จ")); };
  const pending = room.evidences.filter((evidence) => evidence.status === "pending");
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const adjust = (role: Role, delta: number) => setCounts((current) => ({ ...current, [role]: Math.max(role === "killer" || role === "police" ? 1 : 0, Math.min(role === "villager" ? 20 : 1, current[role] + delta)) }));
  const finish = async () => { if (!window.confirm("ดาวน์โหลด archive แล้วปิดห้องหรือไม่")) return; try { await downloadEvidenceArchive(room); setLeaving(true); await closeRoom(room.code); router.replace("/"); } catch (e) { setError(e instanceof Error ? e.message : "ปิดห้องไม่สำเร็จ"); } };
  const leave = async () => { if (!window.confirm("ปิดห้องนี้หรือไม่")) return; setLeaving(true); await closeRoom(room.code); router.replace("/"); };
  return <main className="app-shell"><Header code={room.code} label="CONTROL ROOM" action={room.phase === "lobby" ? <button className="topbar-btn danger" onClick={leave}><DoorOpen size={15} /> ปิดห้อง</button> : room.phase === "ended" ? <button className="topbar-btn danger" onClick={finish}><Download size={15} /> archive และปิด</button> : null} /><div className="host-layout"><section className="main-column"><div className="page-intro"><div><span className="section-kicker">{room.phase === "lobby" ? "LOBBY / SETUP" : "LIVE OPERATION"}</span><h1>{room.phase === "lobby" ? "ตั้งค่าเกม" : "ภาพรวมภารกิจ"}</h1></div><div className={`phase-badge phase-${room.phase}`}><span />{room.phase}</div></div><Ended room={room} host />{room.phase === "lobby" ? <div className="panel setup-panel"><div className="panel-heading"><div><span className="section-kicker">ROLE LOADOUT</span><h2>กำหนดบทบาท</h2></div><span className="count-total">{total} คน</span></div><div className="role-grid">{(Object.keys(DEFAULT_ROLE_COUNTS) as Role[]).map((role) => <div className="role-control" key={role}><div><strong>{ROLE_LABELS[role]}</strong><small>{ROLE_HEARTS[role] || "ไม่มี"} หัวใจ</small></div><div className="stepper"><button onClick={() => adjust(role, -1)}>-</button><b>{counts[role]}</b><button onClick={() => adjust(role, 1)}>+</button></div></div>)}</div><button className="primary-action start-btn" disabled={room.players.length !== total} onClick={() => act(startGame(room.code, counts))}>เริ่มแจกบทบาท ({room.players.length}/{total}) <Radio size={18} /></button></div> : <><div className="metric-grid"><div className="metric-card"><small>ผู้เล่น</small><strong>{room.players.length}</strong><span>คนในห้อง</span></div><div className="metric-card"><small>approved quota</small><strong>{Math.max(0, room.attackLimit - room.attacksThisHour)}<em>/{room.attackLimit}</em></strong><span>ภาพอนุมัติคงเหลือในชั่วโมง Bangkok</span></div><div className="metric-card"><small>หลักฐานรอตรวจ</small><strong className={pending.length ? "amber-text" : ""}>{pending.length}</strong><span>คิวตรวจรูป</span></div></div><div className="panel action-panel"><span className="section-kicker">POLICE SCHEDULE</span><h2>ตั้งเวลาตำรวจชี้ตัว</h2><input type="datetime-local" value={accusationAt} onChange={(e) => setAccusationAtInput(e.target.value)} /><button className="secondary-action" onClick={() => accusationAt && act(setAccusationAt(room.code, new Date(accusationAt).toISOString()))}>{room.policeCheckAt ? `ตั้งไว้ ${new Date(room.policeCheckAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}` : "บันทึกเวลา"}<Clock3 size={16} /></button></div>{room.phase === "bomb-resolution" && <div className="panel bomb-panel"><div className="panel-heading"><div><span className="section-kicker danger-kicker">BOMB PROTOCOL</span><h2>เลือกผู้เล่นใกล้ Bomber 0–2 คน</h2></div><Skull /></div><div className="bomb-grid">{room.players.filter((player) => player.health !== "dead").map((player) => <button className={bombSelection.includes(player.id) ? "selected" : ""} key={player.id} onClick={() => setBombSelection((current) => current.includes(player.id) ? current.filter((id) => id !== player.id) : current.length < 2 ? [...current, player.id] : current)}><span className="avatar">{player.name.slice(0, 1)}</span>{player.name}<Check size={16} /></button>)}</div><button className="danger-action" onClick={() => act(resolveBomb(room.code, bombSelection))}>ดำเนินการระเบิด <Skull size={16} /></button></div>}<div className="panel"><div className="panel-heading"><div><span className="section-kicker">EVIDENCE QUEUE</span><h2>คิวตรวจรูปโจมตี</h2></div><span className="queue-count">{pending.length} PENDING</span></div>{pending.length === 0 ? <div className="empty-state"><Camera size={25} /><p>ยังไม่มีหลักฐานรอตรวจ</p></div> : <div className="evidence-grid">{pending.map((item) => <div className="evidence-card" key={item.id}>{item.imageData && <img src={item.imageData} alt="หลักฐานการโจมตี" />}<div className="evidence-info"><div><strong>{room.players.find((p) => p.id === item.killerId)?.name}</strong><small>เป้าหมาย: {room.players.find((p) => p.id === item.targetId)?.name}</small></div><div className="evidence-actions"><button className="approve-action" onClick={() => act(approveEvidence(room.code, item.id))}><Check size={17} /> อนุมัติ</button><button className="reject-action" onClick={() => act(rejectEvidence(room.code, item.id))}><X size={17} /> ปฏิเสธ</button></div></div></div>)}</div>}</div><div className="panel"><div className="panel-heading"><h2>ผู้เล่นทั้งหมด</h2><span className="muted">Host เท่านั้นที่เห็น role/heart</span></div><div className="players-grid">{room.players.map((player) => <PlayerCard key={player.id} player={player} state={room.privateStates[player.id]} host />)}</div></div></>}</section><aside className="side-column"><div className="panel room-info"><span className="section-kicker">ROOM ACCESS</span><div className="big-code">{room.code}</div><p>แชร์รหัสห้องให้ผู้เล่น</p><div className="pin-row"><span>PIN ผู้เล่น</span><b>{playerPin}</b></div><div className="online-line"><span /> <b>{room.players.length}</b> คนในห้อง</div></div><div className="panel"><div className="panel-heading"><h2>บันทึกเหตุการณ์</h2><Clock3 size={16} className="muted" /></div><Events room /></div></aside></div><ErrorBanner error={error} /></main>;
}

export function PlayerRoom({ code, name = readRoomCredentials(`player:${code}`)?.name, pin = readRoomCredentials(`player:${code}`)?.pin }: { code: string; name?: string; pin?: string }) {
  const router = useRouter();
  const [room, refresh, run, setRoom] = useRoom(code);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const remembered = readRoomCredentials(`player:${code}`);
  const [loginName, setLoginName] = useState(name || remembered?.name || "");
  const [loginPin, setLoginPin] = useState(pin || remembered?.pin || "");
  const [targetId, setTargetId] = useState("");
  const [reportTarget, setReportTarget] = useState("");
  const [photo, setPhoto] = useState("");
  const [capturedAt, setCapturedAt] = useState("");
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);
  const join = async (event?: React.FormEvent) => { event?.preventDefault(); setJoining(true); try { rememberRoomCredentials(`player:${code}`, { name: loginName, pin: loginPin }); const joined = await joinOrCreateDemo(code, loginName, loginPin); setPlayerId(joined.playerId); setRoom(joined.room); } catch (e) { setError(e instanceof Error ? e.message : "เข้าห้องไม่ได้"); } finally { setJoining(false); } };
  useEffect(() => { if (loginName && loginPin) void join(); }, [code]);
  useEffect(() => { if (room?.phase === "ended") { const timer = window.setTimeout(() => router.replace("/"), 5000); return () => window.clearTimeout(timer); } }, [room, router]);
  useEffect(() => { if (!playerId) return; void heartbeat(code); const timer = window.setInterval(() => { void heartbeat(code); }, 30000); return () => window.clearInterval(timer); }, [code, playerId]);
  if (!name || !pin || (!playerId && !room && !joining)) return <main className="landing-shell"><section className="access-panel"><div className="access-heading"><span>RECLAIM SESSION</span><h2>เข้าห้อง</h2><p>PIN จะไม่ถูกใส่ใน URL หรือบันทึกลง browser</p></div><form onSubmit={join}><label>ชื่อผู้เล่น<input required value={loginName} onChange={(e) => setLoginName(e.target.value.slice(0, 24))} /></label><label>PIN<input required type="password" inputMode="numeric" value={loginPin} onChange={(e) => setLoginPin(e.target.value.replace(/\D/g, "").slice(0, 4))} /></label><button className="primary-action" disabled={joining}>เข้าห้อง <ArrowFallback /></button></form><ErrorBanner error={error} /></section></main>;
  if (!room || !playerId) return <main className="loading-screen"><Hourglass /> {error || "กำลังเชื่อมต่อห้อง..."}</main>;
  const me = room.privateStates[playerId];
  const mine = room.players.find((player) => player.id === playerId);
  if (!me) return <Waiting room={room} />;
  const isKiller = me.isActiveKiller;
  const quotaExhausted = isKiller && room.phase === "active" && room.attacksThisHour >= room.attackLimit;
  const act = (operation: Promise<RoomState>) => { setError(""); operation.then((next) => { setRoom(next); void refresh(); }).catch((e) => setError(e instanceof Error ? e.message : "ดำเนินการไม่สำเร็จ")); };
  const target = room.players.find((player) => player.id === targetId);
  const capture = async () => { try { const live = await captureLivePhoto(); setPhoto(live.dataUrl); setCapturedAt(live.capturedAt); } catch (e) { setError(e instanceof Error ? e.message : "เปิดกล้องไม่สำเร็จ"); } }; const choosePhoto = (file: File | undefined) => { if (!file) return; setCapturedAt(new Date().toISOString()); const reader = new FileReader(); reader.onload = () => setPhoto(String(reader.result)); reader.readAsDataURL(file); };
  const winner = room.winner ? (room.winner === "killers") === isKiller : undefined;
  return <main className="app-shell player-app"><Header code={room.code} label="FIELD DEVICE" back /><div className="player-layout"><section className="main-column"><div className="player-hero"><span className="section-kicker">IDENTITY CONFIRMED</span><h1>{ROLE_LABELS[me.currentRole]}</h1><p>{isKiller ? "คุณอยู่ฝ่ายลับ เลือกเป้าหมายและส่งภาพให้ Host" : "บทบาทของคุณเป็นความลับ"}</p><div className="identity-stamp">{me.team === "killers" ? "KILLER SIDE" : "CITY SIDE"}</div></div><Ended room winner={winner} />{isKiller && <div className="panel killer-alliance"><Skull size={19} /><strong>KILLER ALLIANCE</strong><p>คุณเห็นเฉพาะ Killer ที่ active และไม่เห็นข้อมูลหัวใจของเป้าหมาย</p></div>}{!isKiller && <div className="personal-health panel"><div><span className="section-kicker">YOUR HEARTS</span><h2>{me.hearts} <small>/ {me.maxHearts}</small></h2></div><Hearts count={me.hearts} max={me.maxHearts} /></div>}{quotaExhausted && <div className="quota-cooldown-notice"><Clock3 size={24} /><div><span className="section-kicker">APPROVED QUOTA LOCKED</span><strong>โควต้าภาพอนุมัติเต็มแล้ว</strong><p>จะรีเซ็ตเมื่อขึ้นชั่วโมงใหม่ตามเวลา Bangkok</p></div></div>}{isKiller && mine?.health !== "dead" && room.phase === "active" && <div className="panel action-panel"><div className="panel-heading"><div><span className="section-kicker">ATTACK CONSOLE</span><h2>เลือกเป้าหมาย</h2></div><span className="quota">{Math.max(0, room.attackLimit - room.attacksThisHour)} SHOTS LEFT</span></div><select value={targetId} onChange={(e) => setTargetId(e.target.value)} disabled={quotaExhausted}><option value="">เลือกผู้เล่น...</option>{room.players.filter((player) => player.id !== playerId && player.health !== "dead").map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select>{target && <div className="target-confirm"><span className="avatar">{target.name.slice(0, 1)}</span><div><strong>{target.name}</strong><small>ผลลัพธ์จะแสดงหลัง Host อนุมัติ</small></div><Eye size={17} /></div>}<label className="camera-drop"><Camera size={24} /><span>{photo ? "ภาพพร้อมส่งให้ Host ตรวจ" : "ถ่ายภาพสดเพื่อส่งหลักฐาน"}<small>ภาพต้องสดและอายุไม่เกิน 2 นาที</small></span><button type="button" className="secondary-action" onClick={capture}>เปิดกล้องสด</button><input type="file" accept="image/*" capture="environment" disabled={quotaExhausted} onChange={(e) => choosePhoto(e.target.files?.[0])} /></label><button className="primary-action" disabled={quotaExhausted || !targetId || !photo} onClick={() => { act(submitEvidence(room.code, targetId, photo, capturedAt)); setPhoto(""); setCapturedAt(""); }}>ส่งหลักฐานให้ Host <span>→</span></button></div>}{me.currentRole === "police" && mine?.health !== "dead" && room.phase === "police-check" && <div className="panel action-panel"><Shield size={19} /><h2>ชี้ตัว active Killer</h2><select value={targetId} onChange={(e) => setTargetId(e.target.value)}><option value="">เลือกผู้ต้องสงสัย...</option>{room.players.filter((player) => player.id !== playerId && player.health !== "dead").map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select><button className="danger-action" disabled={!targetId} onClick={() => act(resolvePoliceCheck(room.code, targetId))}>ยืนยันการชี้ตัว <Shield size={16} /></button></div>}{me.currentRole === "reporter" && !me.hasUsedAbility && mine?.health !== "dead" && room.phase === "active" && <div className="panel action-panel"><Eye size={19} /><h2>ตรวจ initial role</h2><select value={reportTarget} onChange={(e) => setReportTarget(e.target.value)}><option value="">เลือกผู้เล่น...</option>{room.players.filter((player) => player.id !== playerId && player.health !== "dead").map((player) => <option key={player.id} value={player.id}>{player.name}</option>)}</select><button className="secondary-action" disabled={!reportTarget} onClick={() => act(reporterAbility(room.code, reportTarget))}>ใช้ความสามารถ <Eye size={16} /></button></div>}{mine?.health === "dead" && <div className="dead-card"><Skull size={27} /><div><strong>คุณถูกกำจัดแล้ว</strong><p>รับชมเกมต่อได้ แต่ใช้ความสามารถไม่ได้</p></div></div>}<ErrorBanner error={error} /><div className="panel"><div className="panel-heading"><h2>ข่าวล่าสุด</h2></div><Events room playerId={playerId} /></div></section><aside className="side-column"><div className="panel privacy-note"><Shield size={19} /><strong>ข้อมูลส่วนตัว</strong><p>คุณเห็นเฉพาะ role และหัวใจของคุณเอง ระบบ projection ป้องกันข้อมูลคนอื่น</p></div></aside></div></main>;
}

function ArrowFallback() { return <span aria-hidden="true">→</span>; }
