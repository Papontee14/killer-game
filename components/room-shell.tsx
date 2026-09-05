"use client";
/* The room credential bootstrap intentionally runs once per room code. */
/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @next/next/no-img-element */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  Bomb,
  CircleX,
  CircleStop,
  Search,
  VenetianMask,
  Play,
  AlertTriangle,
  Bell,
  BellOff,
  Camera,
  Check,
  ChevronLeft,
  Clock3,
  DoorOpen,
  Download,
  Eye,
  Heart,
  Hourglass,
  Radio,
  Shield,
  Skull,
  Trophy,
  X,
} from "lucide-react";
import {
  approveEvidence,
  closeRoom,
  createOrLoadRoom,
  endGame,
  heartbeat,
  joinOrCreateDemo,
  loadRoom,
  rejectEvidence,
  reporterAbility,
  resolveBomb,
  resolvePoliceCheck,
  setAccusationAt,
  startGame,
  submitEvidence,
} from "@/src/room-store";
import { getSupabaseBrowser } from "@/src/supabase-browser";
import {
  clearActiveRoom,
  forgetRoomCredentials,
  readRoomCredentials,
  rememberActiveRoom,
  rememberRoomCredentials,
} from "@/src/room-session";
import {
  DEFAULT_ROLE_COUNTS,
  ROLE_HEARTS,
  ROLE_LABELS,
  type PrivatePlayerState,
  type Role,
  type RoomState,
} from "@/src/types";
import { ROLE_ART, roleArtAlt } from "@/src/role-art";
import { downloadEvidenceArchive } from "@/src/evidence-download";
import {
  getNotificationPermission,
  requestNotificationPermission,
  showGenericNotification,
  subscribeToWebPush,
  notifyRoomParticipants,
} from "@/src/notifications";

import { NativeCamera } from "./native-camera";
import { KillerProgress } from "./killer-progress";
import {
  Brand,
  ConnectionStatus,
  Dialog,
  GameNavigation,
  PHASE_LABELS,
  RecoveryCard,
  RoleReveal,
  ROLE_DETAILS,
  Rules,
} from "./game-ui";

import { presentEvent, type EventIcon } from "@/src/event-presentation";
const EVENT_ICONS: Record<EventIcon, typeof Radio> = {
  door: DoorOpen,
  play: Play,
  shield: Shield,
  reject: CircleX,
  check: Check,
  skull: Skull,
  heart: Heart,
  search: Search,
  eye: Eye,
  mask: VenetianMask,
  bomb: Bomb,
  trophy: Trophy,
  stop: CircleStop,
  radio: Radio,
};

let latestRoom: RoomState | null = null;
function useRoom(code: string) {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (room?.closedAt) clearActiveRoom();
  }, [room?.closedAt]);
  const replaceRoom = useCallback((next: RoomState | null) => {
    latestRoom = next;
    setRoom(next);
  }, []);
  const refresh = useCallback(
    () =>
      loadRoom(code)
        .then((next) => {
          replaceRoom(next);
          setStale(false);
        })
        .catch(() => setStale(true)),
    [code, replaceRoom],
  );
  useEffect(() => {
    let stopped = false;
    let lastEventCount: number | null = null;
    let lastPhase: string | null = null;

    const refreshIfLive = async (isSignal = false) => {
      try {
        const next = await loadRoom(code);
        if (!stopped) {
          // If backgrounded or updated via signal with new event or phase change, notify mobile user generically
          if (isSignal && next) {
            const hasNewEvent =
              lastEventCount !== null && next.events.length > lastEventCount;
            const hasNewPhase = lastPhase !== null && next.phase !== lastPhase;
            if (hasNewEvent || hasNewPhase) {
              void showGenericNotification();
            }
          }
          if (next) {
            lastEventCount = next.events.length;
            lastPhase = next.phase;
          }
          replaceRoom(next);
          setStale(false);
        }
      } catch {
        if (!stopped) setStale(true);
      } finally {
        if (!stopped) setInitialLoadComplete(true);
      }
    };
    refreshIfLive(false);
    const timer = window.setInterval(() => void refreshIfLive(false), 15000);
    const supabase = getSupabaseBrowser();
    const channel = supabase
      ?.channel(`room-signal-${code}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_signals" },
        () => void refreshIfLive(true),
      )
      .subscribe();
    return () => {
      stopped = true;
      window.clearInterval(timer);
      if (channel) supabase?.removeChannel(channel);
    };
  }, [code, replaceRoom]);
  const run = useCallback(
    (operation: Promise<RoomState>) => operation.then(replaceRoom),
    [replaceRoom],
  );
  return [room, refresh, run, replaceRoom, initialLoadComplete, stale] as const;
}

function NotificationToggle({ code }: { code: string }) {
  const [permission, setPermission] = useState<string>("default");

  const setupWebPush = useCallback(async () => {
    try {
      const supabase = getSupabaseBrowser();
      const session = await supabase?.auth.getSession();
      const token = session?.data.session?.access_token;
      if (token && code) {
        await subscribeToWebPush(code, token);
      }
    } catch {
      // non-blocking
    }
  }, [code]);

  useEffect(() => {
    const current = getNotificationPermission();
    setPermission(current);
    if (current === "granted") {
      void setupWebPush();
    }
  }, [setupWebPush]);

  if (permission === "unsupported")
    return <span className="muted">เบราว์เซอร์ไม่รองรับการแจ้งเตือน</span>;

  const handleToggle = async () => {
    const next = await requestNotificationPermission();
    setPermission(next);
    if (next === "granted") {
      void setupWebPush();
      void showGenericNotification("เปิดการแจ้งเตือนสำเร็จ");
    }
  };

  return (
    <button
      className={`topbar-btn ${permission === "granted" ? "" : "notice"}`}
      onClick={() => void handleToggle()}
      title={
        permission === "granted"
          ? "เปิดการแจ้งเตือนแล้ว"
          : "กดเพื่อเปิดการแจ้งเตือนบนมือถือ"
      }
      type="button"
    >
      {permission === "granted" ? <Bell size={15} /> : <BellOff size={15} />}
      <span className="notif-label">
        {permission === "granted"
          ? "แจ้งเตือนเปิดแล้ว"
          : permission === "denied"
            ? "ถูกปฏิเสธ · เปิดในการตั้งค่าเบราว์เซอร์"
            : "เปิดแจ้งเตือน"}
      </span>
    </button>
  );
}

function Header({
  code,
  label,
  back = false,
  onLeave,
  action,
}: {
  code: string;
  label: string;
  back?: boolean;
  onLeave?: () => void;
  action?: ReactNode;
}) {
  return (
    <header className="topbar">
      {onLeave ? (
        <button
          type="button"
          className="back-link"
          onClick={onLeave}
          title="ออกจากเกม"
          aria-label="ออกจากเกม"
          style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 0,
          }}
        >
          <ChevronLeft size={17} />
        </button>
      ) : (
        <a className="back-link" href={back ? "/" : undefined}>
          {back ? <ChevronLeft size={17} /> : <Radio size={17} />}
        </a>
      )}
      <Brand small />
      <span className="topbar-title">{label}</span>
      <div className="topbar-actions">
        <NotificationToggle code={code} />
        {action}
        <span className="room-chip">
          ห้อง <b>{code}</b>
        </span>
      </div>
    </header>
  );
}
function errorMessage(error: unknown, fallback: string) {
  const raw =
    error && typeof error === "object" && "message" in error
      ? String(error.message)
      : "";
  const labels: Record<string, string> = {
    "reporter ability unavailable":
      "ใช้ความสามารถไม่ได้ เป้าหมายหรือสถานะเกมอาจเปลี่ยนแล้ว กรุณาตรวจสอบและลองใหม่",
    "police accusation unavailable":
      "ชี้ตัวไม่ได้ เป้าหมายหรือช่วงเกมอาจเปลี่ยนแล้ว กรุณาเลือกใหม่",
    "player name is already in use; enter reclaim token":
      "ชื่อนี้อยู่ในห้องแล้ว กรุณาใส่รหัสกู้คืนให้ถูกต้องเพื่อกลับเป็นผู้เล่นเดิม",
    "invalid room or host cannot play":
      "ไม่พบห้อง ห้องถูกปิด หรือคุณเป็น Host ซึ่งไม่สามารถร่วมเป็นผู้เล่นได้",
    "game already started":
      "เกมเริ่มแล้ว ใช้ชื่อเดิมและรหัสกู้คืนเพื่อกลับเข้าตัวละครเดิม",
    "not allowed":
      "ดำเนินการไม่ได้ สิทธิ์หรือสถานะเกมอาจเปลี่ยนแล้ว กรุณาตรวจสอบและลองใหม่",
    "target is dead": "เป้าหมายถูกกำจัดแล้ว กรุณาเลือกผู้เล่นใหม่",
    "evidence is no longer pending":
      "หลักฐานนี้ถูกจัดการแล้ว หรือเกมเปลี่ยนช่วง กรุณาตรวจสอบคิวอีกครั้ง",
    "hourly approved attack quota reached":
      "โควต้าอนุมัติเต็มแล้ว รอขึ้นชั่วโมงใหม่เวลาไทย",
    "killer ability unavailable": "ใช้ความสามารถ Killer ไม่ได้ในสถานะปัจจุบัน",
    "killer is not active": "ผู้ส่งหลักฐานไม่สามารถโจมตีได้แล้ว",
    "evidence is not allowed, missing, or stale":
      "รูปหมดอายุหรือเป้าหมายเปลี่ยนสถานะ กรุณาตรวจสอบแล้วถ่ายใหม่",
    "invalid bomb targets":
      "เลือกผู้เล่นที่ยังมีชีวิตได้ 0–2 คน กรุณาทบทวนรายชื่อ",
    "invalid player count or required roles":
      "จำนวนบทบาทต้องตรงกับผู้เล่น และต้องมี Killer กับตำรวจ",
    "room not found or closed": "ไม่พบห้องหรือห้องถูกปิดแล้ว",
    "room cannot close yet": "กรุณาจบเกมก่อนปิดห้อง",
    "Failed to fetch": "เชื่อมต่อไม่สำเร็จ กรุณาตรวจสอบเครือข่ายแล้วลองใหม่",
  };
  return (
    labels[raw] ||
    (/[ก-๙]/.test(raw) ? raw : fallback + " กรุณาตรวจสอบและลองใหม่")
  );
}
function ErrorBanner({ error }: { error: string }) {
  return error ? (
    <div className="error-banner" role="alert">
      <AlertTriangle size={16} /> {error}
    </div>
  ) : null;
}

function LeaveConfirmModal({
  expectedName,
  isOpen,
  onClose,
  onConfirm,
}: {
  expectedName: string;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [typedName, setTypedName] = useState("");
  const [error, setError] = useState("");
  if (!isOpen) return null;
  const close = () => {
    setTypedName("");
    setError("");
    onClose();
  };
  return (
    <Dialog title="ออกจากเกม" onClose={close}>
      <p>
        พิมพ์ชื่อ <strong>{expectedName}</strong> เพื่อยืนยัน
        ตัวละครของคุณยังอยู่ในเกม
        การกลับจากอุปกรณ์ใหม่หรือหลังล้างข้อมูลต้องใช้รหัสกู้คืน
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (typedName.trim() !== expectedName.trim()) {
            setError("ชื่อไม่ตรงกับชื่อในเกม กรุณาลองใหม่");
            return;
          }
          onConfirm();
        }}
      >
        <label className="dialog-field">
          ยืนยันชื่อในเกม
          <input
            autoFocus
            required
            value={typedName}
            onChange={(e) => {
              setTypedName(e.target.value);
              setError("");
            }}
            placeholder={expectedName}
          />
        </label>
        <ErrorBanner error={error} />
        <button className="danger-action" type="submit">
          ยืนยันออก
        </button>
        <button className="secondary-action" type="button" onClick={close}>
          ยกเลิก
        </button>
      </form>
    </Dialog>
  );
}
function Hearts({ count, max }: { count: number; max: number }) {
  return (
    <span className="hearts" aria-label={`${count} จาก ${max} หัวใจ`}>
      {Array.from({ length: max }, (_, index) => (
        <Heart
          key={index}
          size={15}
          fill={index < count ? "currentColor" : "none"}
        />
      ))}
    </span>
  );
}
function PlayerCard({
  player,
  state,
  host,
}: {
  player: RoomState["players"][number];
  state?: PrivatePlayerState;
  host?: boolean;
}) {
  const visibleState = host && state;
  return (
    <div className={`player-card ${player.health === "dead" ? "is-dead" : ""}`}>
      <span className="avatar">{player.name.slice(0, 1)}</span>
      {visibleState && (
        <img
          className="role-thumb role-thumb-player"
          src={ROLE_ART[state.currentRole]}
          alt={roleArtAlt(state.currentRole)}
        />
      )}
      <div className="player-meta">
        <strong>{player.name}</strong>
        <small>
          {player.health === "dead" ? "✕ ถูกกำจัด" : "✓ มีชีวิต"} ·{" "}
          {player.isOnline ? "● ออนไลน์" : "○ ออฟไลน์"}
        </small>
        {visibleState && (
          <small>
            เริ่มต้น: {ROLE_LABELS[state.initialRole]} · ปัจจุบัน:{" "}
            {ROLE_LABELS[state.currentRole]}
            <br />
            {state.team === "killers" ? "ฝ่าย Killer" : "ฝ่ายเมือง"}
          </small>
        )}
      </div>
      {visibleState &&
        (state.isActiveKiller ? (
          <span className="muted">ไม่มีแถบหัวใจ</span>
        ) : (
          <Hearts count={state.hearts} max={state.maxHearts} />
        ))}
    </div>
  );
}

function Events({
  room,
  playerId,
}: {
  room: RoomState | boolean;
  playerId?: string;
}) {
  const resolvedRoom = typeof room === "boolean" ? latestRoom : room;
  if (!resolvedRoom) return null;
  const visible = playerId
    ? resolvedRoom.events.filter(
        (event) => !event.playerId || event.playerId === playerId,
      )
    : resolvedRoom.events;
  return (
    <>
      {resolvedRoom.viewerRole === "host" && resolvedRoom.phase === "lobby" && (
        <LobbyPlayers room={resolvedRoom} />
      )}
      <div className="event-feed">
        {visible.length === 0 && (
          <div className="empty-state">
            <Radio size={24} />
            <p>ยังไม่มีข่าวสาร</p>
            <small>อัปเดตใหม่จะแสดงที่นี่</small>
          </div>
        )}
        {visible.map((event) => {
          const recipientName =
            resolvedRoom.viewerRole === "host" && event.playerId
              ? (resolvedRoom.players.find(
                  (player) => player.id === event.playerId,
                )?.name ?? "ไม่ทราบชื่อ")
              : undefined;
          const presentation = presentEvent(event, ROLE_LABELS, recipientName);
          const Icon = EVENT_ICONS[presentation.icon];
          return (
            <div
              className={`event-row event-tone-${presentation.tone}`}
              key={event.id}
            >
              <span className="event-mark" aria-hidden="true">
                <Icon size={18} />
              </span>
              <div className="event-content">
                <small className="event-visibility">
                  {event.playerId
                    ? recipientName
                      ? `ส่วนตัวถึง: ${recipientName}`
                      : "เฉพาะคุณ · ส่วนตัว"
                    : "ประกาศห้อง"}
                </small>
                <p>{presentation.message}</p>
                <time dateTime={event.createdAt}>
                  {new Date(event.createdAt).toLocaleString("th-TH", {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Asia/Bangkok",
                  })}
                </time>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
function Ended({
  room,
  host = false,
  winner,
}: {
  room: RoomState | boolean;
  host?: boolean;
  winner?: boolean;
}) {
  const resolvedRoom = typeof room === "boolean" ? latestRoom : room;
  if (!resolvedRoom || resolvedRoom.phase !== "ended") return null;
  return (
    <div
      className={`game-ended-notice outcome-${!resolvedRoom.winner ? "neutral" : host || winner ? "winner" : "loser"}`}
    >
      <Trophy size={30} />
      <div>
        <span className="section-kicker">จบเกม</span>
        <h2>
          {host || !resolvedRoom.winner
            ? "เกมจบแล้ว"
            : winner === undefined
              ? "เกมจบแล้ว"
              : winner
                ? "คุณชนะ"
                : "คุณแพ้"}
        </h2>
        <p>
          {resolvedRoom.winner === "city"
            ? "ฝ่ายเมืองชนะ"
            : resolvedRoom.winner === "killers"
              ? "ฝ่าย Killer ชนะ"
              : "จบเกมโดยไม่มีผู้ชนะ"}
        </p>
      </div>
    </div>
  );
}
function PlayerEndGameSummary({
  room,
  playerId,
  onLeave,
}: {
  room: RoomState;
  playerId: string | null;
  onLeave: () => void;
}) {
  const summaries = new Map(
    room.endGameSummary.map((entry) => [entry.playerId, entry]),
  );
  const myTeam = playerId ? summaries.get(playerId)?.team : null;
  return (
    <main className="app-shell player-app">
      <Header code={room.code} label="สรุปผลเกม" onLeave={onLeave} />
      <div className="end-game-summary">
        <Ended
          room={room}
          winner={room.winner && myTeam ? room.winner === myTeam : undefined}
        />
        <section className="panel" aria-labelledby="end-game-roster-title">
          <div className="panel-heading">
            <div>
              <span className="section-kicker">เฉลยบทบาท</span>
              <h2 id="end-game-roster-title">บทบาทของผู้เล่นทุกคน</h2>
              <p className="muted">
                ผู้เล่นทั้งหมด {room.players.length} คน · แสดงบทบาทเริ่มต้นของทุกคน
              </p>
            </div>
          </div>
          <ul className="end-game-roster">
            {room.players.map((player) => {
              const summary = summaries.get(player.id);
              return (
                <li key={player.id} className="end-game-player">
                  {summary?.initialRole && (
                    <img
                      className="role-thumb role-thumb-endgame"
                      src={ROLE_ART[summary.initialRole]}
                      alt={roleArtAlt(summary.initialRole)}
                    />
                  )}
                  <div className="end-game-player-details">
                    <strong>
                      {player.name}{player.id === playerId ? " (คุณ)" : ""}
                    </strong>
                    <span>
                      {summary?.initialRole ? (
                        <>
                          <small className="end-game-role-caption">เริ่มต้น</small>
                          <span className="end-game-role-value">
                            {ROLE_LABELS[summary.initialRole]}
                            {summary.currentRole && summary.initialRole !== summary.currentRole
                              ? ` → ${ROLE_LABELS[summary.currentRole]}`
                              : ""}
                          </span>
                        </>
                      ) : summary?.currentRole ? (
                        ROLE_LABELS[summary.currentRole]
                      ) : summary ? "ยังไม่ได้รับบทบาท" : "ยังไม่มีข้อมูลเฉลยบทบาท"}
                    </span>
                  </div>
                  <span className={`end-game-team team-${summary?.team ?? "none"}`}>
                    {summary?.team === "killers"
                      ? "ฝ่าย Killer"
                      : summary?.team === "city"
                        ? "ฝ่ายเมือง"
                        : "ยังไม่มีฝ่าย"}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
        <div className="end-game-exit">
          <p className="muted">
            {room.closedAt ? "Host ปิดห้องแล้ว คุณยังอ่านสรุปนี้ได้" : "อ่านสรุปได้จนกว่าคุณจะพร้อมออก"}
          </p>
          <button className="primary-action" onClick={onLeave}>
            กลับหน้าแรก <ArrowFallback />
          </button>
        </div>
      </div>
    </main>
  );
}
function LobbyPlayers({
  room,
  waiting = false,
}: {
  room: RoomState;
  waiting?: boolean;
}) {
  return (
    <section
      className={waiting ? "waiting-roster" : "panel lobby-roster-panel"}
      aria-live="polite"
    >
      <div className="lobby-roster-heading">
        <div>
          <span className="section-kicker">สมาชิกในห้อง</span>
          <h2>ผู้เล่นในห้อง</h2>
        </div>
        <strong>{room.players.length} คน</strong>
      </div>
      {room.players.length === 0 ? (
        <div className="empty-state">
          <p>ยังไม่มีผู้เล่นเข้าห้อง</p>
        </div>
      ) : (
        <div className="players-grid">
          {room.players.map((player) => (
            <PlayerCard key={player.id} player={player} />
          ))}
        </div>
      )}
    </section>
  );
}
function Waiting({ room, onLeave }: { room: RoomState; onLeave?: () => void }) {
  return (
    <main className="lobby-waiting-screen">
      {onLeave && (
        <div style={{ position: "absolute", top: 16, left: 20, zIndex: 10 }}>
          <button
            type="button"
            className="back-link"
            onClick={onLeave}
            title="ออกจากเกม"
            aria-label="ออกจากเกม"
            style={{
              background: "rgba(0,0,0,0.4)",
              border: "1px solid var(--line)",
              borderRadius: "6px",
              cursor: "pointer",
              color: "var(--acid)",
              display: "grid",
              placeItems: "center",
              width: 36,
              height: 36,
            }}
          >
            <ChevronLeft size={20} />
          </button>
        </div>
      )}
      <div className="waiting-grid" />
      <Skull className="waiting-skull" size={56} />
      <div className="waiting-copy">
        <span className="section-kicker">KILLER · ห้อง {room.code}</span>
        <h1>KILLER</h1>
        <p>Host {room.hostName} กำลังเตรียมเกม</p>
        <p className="muted">ปิดเว็บหรือหลุดจากเครือข่าย ไม่ถือว่าถูกกำจัด</p>
        <ConnectionStatus />
        <div className="waiting-status">
          <span /> รอ Host เริ่มเกม
        </div>
        <LobbyPlayers room={room} waiting />
      </div>
    </main>
  );
}

export function HostRoom({ code, name }: { code: string; name?: string }) {
  const router = useRouter();
  const [room, refresh, run, setRoom, initialLoadComplete, stale] =
    useRoom(code);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState(false);
  const creationAttemptForCode = useRef<string | null>(null);
  const [tab, setTab] = useState("home");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [confirmation, setConfirmation] = useState<{
    title: string;
    detail: string;
    action: () => void;
    alternateAction?: () => void;
  } | null>(null);
  const [largeImage, setLargeImage] = useState("");
  const [archiveReady, setArchiveReady] = useState(false);
  const [counts, setCounts] = useState(DEFAULT_ROLE_COUNTS);
  const [bombSelection, setBombSelection] = useState<string[]>([]);
  const [accusationAt, setAccusationAtInput] = useState("");
  const hostCredentials = readRoomCredentials(`host:${code}`);
  const hostName = name || hostCredentials?.name || "";
  useEffect(() => {
    setMounted(true);
  }, []);
  useEffect(() => {
    if (mounted && initialLoadComplete && !room && !hostName && !leaving) {
      setError(
        "อุปกรณ์นี้ไม่มีสิทธิ์ Host กรุณากลับไปใช้เบราว์เซอร์ที่สร้างห้อง",
      );
      clearActiveRoom();
    }
  }, [mounted, initialLoadComplete, room, hostName, leaving]);
  useEffect(() => {
    if (
      !mounted ||
      room ||
      leaving ||
      !hostName ||
      creationAttemptForCode.current === code
    )
      return;
    creationAttemptForCode.current = code;
    createOrLoadRoom(code, hostName)
      .then((loaded) => {
        setRoom(loaded);
        rememberActiveRoom({ role: "host", code, name: hostName });
      })
      .catch((e) => {
        const msg = errorMessage(e, "เปิดห้องไม่ได้");
        setError(msg);
        if (
          msg.includes("closed") ||
          msg.includes("ไม่อยู่") ||
          msg.includes("ไม่พบ")
        ) {
          clearActiveRoom();
        }
      });
  }, [mounted, room, code, hostName, leaving, setRoom]);
  if (!mounted || !room)
    return (
      <main className="loading-screen">
        <Hourglass /> {error || "กำลังเชื่อมต่อห้อง..."}
        {error && (
          <a className="secondary-action" href="/">
            กลับหน้าแรก
          </a>
        )}
      </main>
    );
  if (room.closedAt)
    return (
      <main className="loading-screen">
        <DoorOpen size={32} />
        <h1>ห้องถูกปิดแล้ว</h1>
        <p>ห้องนี้ไม่สามารถเข้าร่วมได้อีก</p>
        <a className="secondary-action" href="/">
          กลับหน้าแรก
        </a>
      </main>
    );
  if (room.viewerRole !== "host")
    return (
      <main className="loading-screen">
        <Shield size={24} /> เฉพาะผู้สร้างห้องเท่านั้นที่เข้าถึงหน้าควบคุมได้
        <a className="secondary-action" href="/">
          กลับหน้าแรก
        </a>
      </main>
    );
  const act = (operation: () => Promise<RoomState>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    void run(operation())
      .catch((e) => setError(errorMessage(e, "ดำเนินการไม่สำเร็จ")))
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
        void refresh();
      });
  };
  const pending = room.evidences.filter(
    (evidence) => evidence.status === "pending",
  );
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const adjust = (role: Role, delta: number) =>
    setCounts((current) => ({
      ...current,
      [role]: Math.max(
        role === "killer" || role === "police" ? 1 : 0,
        Math.min(role === "villager" ? 20 : 1, current[role] + delta),
      ),
    }));
  const closeEndedRoom = (downloadImages: boolean) => {
    void (async () => {
      if (busyRef.current) return;
      busyRef.current = true;
      setBusy(true);
      setError("");
      try {
        if (downloadImages && !archiveReady) {
          await downloadEvidenceArchive(room);
          setArchiveReady(true);
        }
        await closeRoom(room.code);
        setLeaving(true);
        clearActiveRoom();
        forgetRoomCredentials(`host:${room.code}`);
        router.replace("/");
      } catch (e) {
        setError(
          errorMessage(
            e,
            downloadImages
              ? "ดาวน์โหลดหรือปิดห้องไม่สำเร็จ กรุณาลองใหม่"
              : "ปิดห้องไม่สำเร็จ กรุณาลองใหม่",
          ),
        );
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    })();
  };
  const finish = () =>
    setConfirmation({
      title: "ปิดห้องหลังจบเกม",
      detail:
        "เลือกดาวน์โหลดบันทึกเกมพร้อมรูปหลักฐาน หรือปิดห้องทันทีโดยไม่ดาวน์โหลดรูปก็ได้ รูปหลักฐานในห้องจะถูกลบหลังปิดห้อง",
      action: () => closeEndedRoom(true),
      alternateAction: () => closeEndedRoom(false),
    });
  const leave = () =>
    setConfirmation({
      title: "ปิดห้องนี้หรือไม่",
      detail: "ผู้เล่นจะไม่สามารถกลับเข้าห้องนี้ได้",
      action: () => {
        void (async () => {
          if (busyRef.current) return;
          busyRef.current = true;
          setBusy(true);
          setError("");
          try {
            await closeRoom(room.code);
            setLeaving(true);
            clearActiveRoom();
            forgetRoomCredentials(`host:${room.code}`);
            router.replace("/");
          } catch (e) {
            setError(errorMessage(e, "ปิดห้องไม่สำเร็จ กรุณาลองใหม่"));
          } finally {
            busyRef.current = false;
            setBusy(false);
          }
        })();
      },
    });
  const endCurrentGame = () =>
    setConfirmation({
      title: "จบเกมโดยไม่มีผู้ชนะ",
      detail:
        "ผู้เล่นทุกคนจะเห็นผลจบเกมและเฉลยบทบาท จนกว่าจะกดกลับหน้าแรกเอง คุณยังดาวน์โหลดข้อมูลได้",
      action: () => act(() => endGame(room.code)),
    });
  return (
    <main className={`app-shell host-app host-tab-${tab}`}>
      <Header
        code={room.code}
        label="ศูนย์ควบคุม Host"
        action={
          room.phase === "ended" ? (
            <button className="topbar-btn danger" onClick={finish}>
              <Download size={15} /> ดาวน์โหลดข้อมูลและปิดห้อง
            </button>
          ) : (
            <>
              <button className="topbar-btn danger" onClick={endCurrentGame}>
                <Skull size={15} /> จบเกม
              </button>
              {room.phase === "lobby" && (
                <button className="topbar-btn danger" onClick={leave}>
                  <DoorOpen size={15} /> ปิดห้อง
                </button>
              )}
            </>
          )
        }
      />
      <GameNavigation
        host
        active={tab}
        onChange={setTab}
        pending={pending.length}
      />
      <ConnectionStatus />
      {stale && (
        <div className="error-banner" role="status">
          ข้อมูลอาจยังไม่อัปเดต{" "}
          <button className="text-button" onClick={() => void refresh()}>
            เชื่อมต่อใหม่
          </button>
        </div>
      )}
      <div className="host-layout">
        <section className="main-column">
          <div className="page-intro">
            <div>
              <span className="section-kicker">
                {room.phase === "lobby"
                  ? "เตรียมความพร้อม"
                  : "สถานการณ์ปัจจุบัน"}
              </span>
              <h1>
                {tab === "home"
                  ? room.phase === "lobby"
                    ? "ตั้งค่าเกม"
                    : "ภาพรวมภารกิจ"
                  : (
                      {
                        evidence: "ตรวจหลักฐาน",
                        players: "ผู้เล่นทั้งหมด",
                        events: "บันทึกเหตุการณ์",
                        settings: "ตั้งค่าห้อง",
                      } as Record<string, string>
                    )[tab]}
              </h1>
            </div>
            <div className={`phase-badge phase-${PHASE_LABELS[room.phase]}`}>
              <span />
              {PHASE_LABELS[room.phase]}
            </div>
          </div>
          <Ended room={room} host />
          {room.phase === "lobby" && tab === "players" && (
            <LobbyPlayers room={room} />
          )}
          {room.phase === "lobby" && tab === "evidence" && (
            <div className="panel empty-state">
              <Camera size={28} />
              <h2>ยังไม่มีหลักฐานรอตรวจ</h2>
              <p>คิวหลักฐานจะเริ่มเมื่อ Host แจกบทบาทแล้ว</p>
            </div>
          )}
          {room.phase === "lobby" ? (
            <div className="panel setup-panel" data-host-section="settings">
              <div className="panel-heading">
                <div>
                  <span className="section-kicker">จัดสรรบทบาท</span>
                  <h2>กำหนดบทบาท</h2>
                </div>
                <span className="count-total">{total} คน</span>
              </div>
              <div className="role-grid">
                {(Object.keys(DEFAULT_ROLE_COUNTS) as Role[]).map((role) => (
                  <div className="role-control" key={role}>
                    <img
                      className="role-thumb role-thumb-control"
                      src={ROLE_ART[role]}
                      alt=""
                      aria-hidden="true"
                    />
                    <div>
                      <strong>{ROLE_LABELS[role]}</strong>
                      <small>{ROLE_HEARTS[role] || "ไม่มี"} หัวใจ</small>
                    </div>
                    <div className="stepper">
                      <button
                        aria-label={`ลด ${ROLE_LABELS[role]}`}
                        disabled={
                          busy ||
                          role === "killer" ||
                          role === "police" ||
                          counts[role] === 0
                        }
                        onClick={() => adjust(role, -1)}
                      >
                        −
                      </button>
                      <b>{counts[role]}</b>
                      <button
                        aria-label={`เพิ่ม ${ROLE_LABELS[role]}`}
                        disabled={
                          busy || counts[role] >= (role === "villager" ? 20 : 1)
                        }
                        onClick={() => adjust(role, 1)}
                      >
                        +
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button
                className="primary-action start-btn"
                disabled={busy || room.players.length !== total}
                onClick={() => act(() => startGame(room.code, counts))}
              >
                เริ่มแจกบทบาท ({room.players.length}/{total}){" "}
                <Radio size={18} />
              </button>
              {room.players.length !== total && (
                <p className="muted">
                  จำนวนผู้เล่น {room.players.length} คน ต้องตรงกับบทบาท {total}{" "}
                  คน จึงจะเริ่มได้
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="metric-grid" data-host-section="home">
                <div className="metric-card">
                  <small>ผู้เล่น</small>
                  <strong>{room.players.length}</strong>
                  <span>คนในห้อง</span>
                </div>
                <div className="metric-card">
                  <small>โควต้าอนุมัติคงเหลือ</small>
                  <strong>
                    {Math.max(0, room.attackLimit - room.attacksThisHour)}
                    <em>/{room.attackLimit}</em>
                  </strong>
                  <span>ภาพในชั่วโมงนี้ · เวลาไทย</span>
                </div>
                <div className="metric-card">
                  <small>หลักฐานรอตรวจ</small>
                  <strong className={pending.length ? "amber-text" : ""}>
                    {pending.length}
                  </strong>
                  <span>คิวตรวจรูป</span>
                </div>
              </div>
              <div
                className="panel action-panel police-schedule-panel"
                data-host-section="settings"
              >
                <div className="schedule-heading">
                  <div className="schedule-icon">
                    <Clock3 size={19} />
                  </div>
                  <div>
                    <span className="section-kicker">เวลาตัดสิน</span>
                    <h2>ตั้งเวลาตำรวจชี้ตัว</h2>
                    <p>กำหนดช่วงเวลาที่ตำรวจจะตรวจสอบและชี้ตัว Killer</p>
                  </div>
                </div>
                <label className="schedule-field">
                  <span>วันและเวลา · เวลาไทย (UTC+7)</span>
                  <div className="schedule-input-wrap">
                    <Clock3 size={17} />
                    <input
                      aria-label="วันและเวลาตำรวจชี้ตัว"
                      type="datetime-local"
                      value={accusationAt}
                      onChange={(e) => setAccusationAtInput(e.target.value)}
                    />
                  </div>
                </label>
                <button
                  className="secondary-action schedule-save"
                  disabled={!accusationAt || busy || room.phase === "ended"}
                  onClick={() =>
                    accusationAt &&
                    act(() =>
                      setAccusationAt(
                        room.code,
                        new Date(`${accusationAt}:00+07:00`).toISOString(),
                      ),
                    )
                  }
                >
                  {room.policeCheckAt
                    ? "อัปเดตเวลานัดหมาย"
                    : "บันทึกเวลานัดหมาย"}
                  <Clock3 size={16} />
                </button>
                {room.policeCheckAt && (
                  <div className="schedule-status">
                    <span className="schedule-status-dot" />
                    <div>
                      <small>กำหนดไว้แล้ว</small>
                      <strong>
                        {new Date(room.policeCheckAt).toLocaleString("th-TH", {
                          timeZone: "Asia/Bangkok",
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </strong>
                    </div>
                    <span className="schedule-status-label">รอตรวจ</span>
                  </div>
                )}
              </div>
              {room.phase === "bomb-resolution" && (
                <div className="panel bomb-panel" data-host-section="urgent">
                  <div className="panel-heading">
                    <div>
                      <span className="section-kicker danger-kicker">
                        เหตุการณ์เร่งด่วน
                      </span>
                      <h2>เลือกผู้เล่นใกล้ Bomber 0–2 คน</h2>
                    </div>
                    <Skull />
                  </div>
                  <div className="bomb-grid">
                    {room.players
                      .filter((player) => player.health !== "dead")
                      .map((player) => (
                        <button
                          className={
                            bombSelection.includes(player.id) ? "selected" : ""
                          }
                          key={player.id}
                          onClick={() =>
                            setBombSelection((current) =>
                              current.includes(player.id)
                                ? current.filter((id) => id !== player.id)
                                : current.length < 2
                                  ? [...current, player.id]
                                  : current,
                            )
                          }
                        >
                          <span className="avatar">
                            {player.name.slice(0, 1)}
                          </span>
                          {player.name}
                          <Check size={16} />
                        </button>
                      ))}
                  </div>
                  <button
                    className="danger-action"
                    disabled={busy}
                    onClick={() =>
                      setConfirmation({
                        title: "ทบทวนผลระเบิด",
                        detail: bombSelection.length
                          ? `ผู้เล่นที่จะถูกกำจัดทันที: ${room.players
                              .filter((p) => bombSelection.includes(p.id))
                              .map((p) => p.name)
                              .join(" และ ")}`
                          : "ไม่เลือกผู้ได้รับผลระเบิด เกมจะดำเนินต่อหรือแสดงผลตามกติกา",
                        action: () =>
                          act(() => resolveBomb(room.code, bombSelection)),
                      })
                    }
                  >
                    ดำเนินการระเบิด <Skull size={16} />
                  </button>
                </div>
              )}
              <div className="panel" data-host-section="evidence">
                <div className="panel-heading">
                  <div>
                    <span className="section-kicker">
                      หลักฐานส่วนตัวสำหรับ Host
                    </span>
                    <h2>คิวตรวจรูปโจมตี</h2>
                  </div>
                  <span className="queue-count">
                    <Clock3 size={13} />
                    {pending.length} รอตรวจ
                  </span>
                </div>
                {room.attacksThisHour >= room.attackLimit && (
                  <p className="amber-text">
                    โควต้าเต็ม · รอขึ้นชั่วโมงใหม่เวลาไทยจึงอนุมัติได้
                  </p>
                )}
                {room.phase !== "active" && (
                  <p className="muted">
                    พักการอนุมัติระหว่าง{PHASE_LABELS[room.phase]}
                  </p>
                )}
                {pending.length === 0 ? (
                  <div className="empty-state">
                    <Camera size={25} />
                    <p>ยังไม่มีหลักฐานรอตรวจ</p>
                  </div>
                ) : (
                  <div className="evidence-grid">
                    {pending.map((item) => (
                      <div className="evidence-card" key={item.id}>
                        {!item.imageData && (
                          <div className="empty-state">
                            โหลดภาพไม่ได้{" "}
                            <button
                              className="text-button"
                              onClick={() => void refresh()}
                            >
                              ลองใหม่
                            </button>
                          </div>
                        )}
                        {item.imageData && (
                          <button
                            className="evidence-image-button"
                            onClick={() => setLargeImage(item.imageData!)}
                            aria-label="ขยายรูปหลักฐาน"
                          >
                            <img
                              src={item.imageData}
                              alt="หลักฐานการโจมตี"
                              onError={(e) => {
                                e.currentTarget.alt =
                                  "โหลดภาพไม่ได้ กรุณารีเฟรชเพื่อลองใหม่";
                              }}
                            />
                          </button>
                        )}
                        <div className="evidence-info">
                          <div>
                            <strong>
                              {
                                room.players.find((p) => p.id === item.killerId)
                                  ?.name
                              }
                            </strong>
                            <small>
                              เป้าหมาย:{" "}
                              {
                                room.players.find((p) => p.id === item.targetId)
                                  ?.name
                              }
                            </small>
                          </div>
                          <small>
                            ถ่าย:{" "}
                            {new Date(item.capturedAt).toLocaleString("th-TH", {
                              timeZone: "Asia/Bangkok",
                            })}
                          </small>
                          <small>
                            ส่ง:{" "}
                            {new Date(item.createdAt).toLocaleString("th-TH", {
                              timeZone: "Asia/Bangkok",
                            })}
                          </small>
                          <div className="evidence-actions">
                            <button
                              className="approve-action"
                              disabled={
                                busy ||
                                room.attacksThisHour >= room.attackLimit ||
                                room.phase !== "active" ||
                                !item.imageData
                              }
                              onClick={() =>
                                act(() => approveEvidence(room.code, item.id))
                              }
                            >
                              <Check size={17} /> อนุมัติ
                            </button>
                            <button
                              className="reject-action"
                              disabled={busy || room.phase === "ended"}
                              onClick={() =>
                                act(() => rejectEvidence(room.code, item.id))
                              }
                            >
                              <X size={17} /> ปฏิเสธ
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="panel" data-host-section="players">
                <div className="panel-heading">
                  <h2>ผู้เล่นทั้งหมด</h2>
                  <span className="muted">เฉพาะ Host · บทบาทและหัวใจ</span>
                </div>
                <div className="players-grid">
                  {room.players.map((player) => (
                    <PlayerCard
                      key={player.id}
                      player={player}
                      state={room.privateStates[player.id]}
                      host
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </section>
        <aside className="side-column">
          <div className="panel room-info">
            <span className="section-kicker">รหัสเข้าร่วมห้อง</span>
            <div className="big-code">{room.code}</div>
            <p>แชร์รหัสห้องให้ผู้เล่น</p>
            <div className="online-line">
              <span /> <b>{room.players.length}</b> คนในห้อง
            </div>
          </div>
          <div className="panel" data-host-section="events">
            <div className="panel-heading">
              <h2>บันทึกเหตุการณ์</h2>
              <Clock3 size={16} className="muted" />
            </div>
            <Events room />
          </div>
        </aside>
      </div>
      <ErrorBanner error={error} />
      {busy && (
        <div className="toast" role="status">
          กำลังดำเนินการ…
        </div>
      )}
      {confirmation && (
        <Dialog
          title={confirmation.title}
          onClose={() => setConfirmation(null)}
        >
          <p>{confirmation.detail}</p>
          <button
            className="danger-action"
            onClick={() => {
              const action = confirmation.action;
              setConfirmation(null);
              action();
            }}
          >
            ยืนยันดำเนินการ
          </button>
          {confirmation.alternateAction && (
            <button
              className="danger-action"
              onClick={() => {
                const action = confirmation.alternateAction;
                if (!action) return;
                setConfirmation(null);
                action();
              }}
            >
              ปิดห้องโดยไม่ดาวน์โหลดรูป
            </button>
          )}
          <button
            className="secondary-action"
            onClick={() => setConfirmation(null)}
          >
            ยกเลิก
          </button>
        </Dialog>
      )}
      {largeImage && (
        <Dialog
          title="รูปหลักฐาน · เฉพาะ Host"
          onClose={() => setLargeImage("")}
        >
          <img
            className="large-evidence"
            src={largeImage}
            alt="ภาพหลักฐานขนาดใหญ่"
          />
        </Dialog>
      )}
    </main>
  );
}

export function PlayerRoom({
  code,
  name = readRoomCredentials(`player:${code}`)?.name,
}: {
  code: string;
  name?: string;
}) {
  const router = useRouter();
  const [room, refresh, run, setRoom, , stale] = useRoom(code);
  const [tab, setTab] = useState("home");
  const [showRules, setShowRules] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const [ackRole, setAckRole] = useState<Role | undefined>();
  const [confirmation, setConfirmation] = useState<{
    title: string;
    detail: string;
    action: () => void;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [now, setNow] = useState(Date.now());
  const [toast, setToast] = useState("");
  const [mounted, setMounted] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const remembered = readRoomCredentials(`player:${code}`);
  const [loginName, setLoginName] = useState(name || remembered?.name || "");
  const [reclaimToken, setReclaimToken] = useState(
    remembered?.reclaimToken || "",
  );
  const [targetId, setTargetId] = useState("");
  const [reportTarget, setReportTarget] = useState("");
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [capturedAt, setCapturedAt] = useState("");
  const cameraTargetRef = useRef<string | null>(null);
  const [submittingEvidence, setSubmittingEvidence] = useState(false);
  const [error, setError] = useState("");
  const [joining, setJoining] = useState(false);
  const [isLeaveModalOpen, setIsLeaveModalOpen] = useState(false);
  const join = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setJoining(true);
    try {
      const joined = await joinOrCreateDemo(code, loginName, reclaimToken);
      const token = joined.reclaimToken || reclaimToken;
      rememberRoomCredentials(`player:${code}`, {
        name: loginName,
        reclaimToken: token || undefined,
      });
      rememberActiveRoom({
        role: "player",
        code,
        name: loginName,
      });
      setReclaimToken(token);
      if (joined.reclaimToken) setShowRecovery(true);
      else setToast("กลับเข้าตัวละครเดิมสำเร็จ");
      setPlayerId(joined.playerId);
      setRoom(joined.room);
    } catch (e) {
      const msg = errorMessage(e, "เข้าห้องไม่ได้");
      setError(msg);
      if (
        msg.includes("closed") ||
        msg.includes("ไม่อยู่") ||
        msg.includes("ไม่พบ")
      ) {
        clearActiveRoom();
      }
    } finally {
      setJoining(false);
    }
  };
  const handleConfirmLeave = () => {
    clearActiveRoom();
    forgetRoomCredentials(`player:${code}`);
    setIsLeaveModalOpen(false);
    router.replace("/");
  };
  useEffect(() => {
    if (loginName) void join();
  }, [code]);
  const currentRole = playerId
    ? room?.privateStates[playerId]?.currentRole
    : undefined;
  useEffect(() => {
    if (currentRole && currentRole !== ackRole) setRoleOpen(true);
  }, [currentRole]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!playerId || room?.phase === "ended" || room?.closedAt) return;
    void heartbeat(code);
    const timer = window.setInterval(() => {
      void heartbeat(code);
    }, 30000);
    return () => window.clearInterval(timer);
  }, [code, playerId, room?.phase, room?.closedAt]);
  useEffect(() => {
    setMounted(true);
  }, []);
  useEffect(
    () => () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    },
    [photoPreview],
  );
  if (!mounted)
    return (
      <main className="loading-screen">
        <Hourglass /> กำลังเชื่อมต่อห้อง...
      </main>
    );
  if (room?.phase === "ended" && room.viewerRole === "player")
    return (
      <PlayerEndGameSummary
        room={room}
        playerId={room.playerId ?? playerId}
        onLeave={handleConfirmLeave}
      />
    );
  if (!playerId && !joining)
    return (
      <main className="landing-shell">
        <section className="access-panel">
          <div className="access-heading">
            <span>รหัสเข้าร่วมห้อง</span>
            <h2>เข้าห้อง</h2>
            <p>
              ใช้รหัสห้องและชื่อผู้เล่นเพื่อเข้าร่วม; หากเปลี่ยนอุปกรณ์
              ให้ใส่รหัสกู้คืนของผู้เล่น
            </p>
          </div>
          <form onSubmit={join}>
            <label>
              ชื่อผู้เล่น
              <input
                required
                value={loginName}
                onChange={(e) => setLoginName(e.target.value.slice(0, 24))}
              />
            </label>
            <label>
              รหัสกู้คืน (เฉพาะอุปกรณ์ใหม่)
              <input
                value={reclaimToken}
                onChange={(e) =>
                  setReclaimToken(
                    e.target.value.replace(/[^a-f0-9]/gi, "").slice(0, 32),
                  )
                }
                autoCapitalize="off"
              />
            </label>
            <button className="primary-action" disabled={joining}>
              เข้าห้อง <ArrowFallback />
            </button>
          </form>
          <ErrorBanner error={error} />
        </section>
      </main>
    );
  if (!room || !playerId)
    return (
      <main className="loading-screen">
        <Hourglass /> {error || "กำลังเชื่อมต่อห้อง..."}
        {error && (
          <a className="secondary-action" href="/">
            กลับหน้าแรก
          </a>
        )}
      </main>
    );
  if (room.closedAt)
    return (
      <main className="loading-screen">
        <DoorOpen size={32} />
        <h1>ห้องถูกปิดแล้ว</h1>
        <p>Host ปิดห้องนี้แล้ว</p>
        <a className="secondary-action" href="/">
          กลับหน้าแรก
        </a>
      </main>
    );
  const me = room.privateStates[playerId];
  const mine = room.players.find((player) => player.id === playerId);
  if (!me) {
    return (
      <>
        <Waiting room={room} onLeave={() => setIsLeaveModalOpen(true)} />
        {showRecovery && (
          <RecoveryCard
            token={reclaimToken}
            onClose={() => setShowRecovery(false)}
          />
        )}
        <LeaveConfirmModal
          expectedName={loginName}
          isOpen={isLeaveModalOpen}
          onClose={() => setIsLeaveModalOpen(false)}
          onConfirm={handleConfirmLeave}
        />
      </>
    );
  }
  const isKiller = me.isActiveKiller;
  const quotaExhausted =
    isKiller &&
    room.phase === "active" &&
    room.attacksThisHour >= room.attackLimit;
  const act = (operation: () => Promise<RoomState>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    operation()
      .then((next) => {
        setRoom(next);
        void refresh();
      })
      .catch((e) => setError(errorMessage(e, "ดำเนินการไม่สำเร็จ")))
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
        void refresh();
      });
  };
  const target = room.players.find(
    (player) =>
      player.id === targetId &&
      player.id !== playerId &&
      player.health !== "dead" &&
      !room.privateStates[player.id]?.isActiveKiller,
  );
  const validReportTarget = room.players.some(
    (player) =>
      player.id === reportTarget &&
      player.id !== playerId &&
      player.health !== "dead",
  );
  const photoSeconds = capturedAt
    ? Math.max(
        0,
        Math.ceil((new Date(capturedAt).getTime() + 120000 - now) / 1000),
      )
    : 0;
  const clearPhoto = () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhoto(null);
    setPhotoPreview("");
    setCapturedAt("");
  };
  const receiveCameraPhoto = async (photo: Blob, receivedAt: string) => {
    const requestedTargetId = cameraTargetRef.current;
    cameraTargetRef.current = null;
    if (!requestedTargetId || requestedTargetId !== target?.id) {
      setError("เป้าหมายเปลี่ยนแล้ว กรุณาถ่ายรูปใหม่");
      return;
    }
    try {
      const current = await loadRoom(code);
      const currentMe = current?.privateStates[playerId];
      const currentPlayer = current?.players.find(
        (player) => player.id === playerId,
      );
      const currentTarget = current?.players.find(
        (player) =>
          player.id === requestedTargetId &&
          player.id !== playerId &&
          player.health !== "dead" &&
          !current.privateStates[player.id]?.isActiveKiller,
      );
      if (
        !current ||
        current.closedAt ||
        current.phase !== "active" ||
        !currentMe?.isActiveKiller ||
        !currentPlayer ||
        currentPlayer?.health === "dead" ||
        !currentTarget ||
        current.attacksThisHour >= current.attackLimit
      ) {
        if (current) setRoom(current);
        clearPhoto();
        setError("สถานะเกมหรือเป้าหมายเปลี่ยนแล้ว กรุณาถ่ายรูปใหม่");
        return;
      }
      setRoom(current);
      clearPhoto();
      setPhoto(photo);
      setPhotoPreview(URL.createObjectURL(photo));
      setCapturedAt(receivedAt);
      setError("");
    } catch (cause) {
      setError(errorMessage(cause, "ตรวจสอบสถานะเกมก่อนรับรูปไม่สำเร็จ"));
    }
  };
  const sendEvidence = async () => {
    if (!photo || !target || !capturedAt || submittingEvidence || quotaExhausted) return;
    if (Date.now() - new Date(capturedAt).getTime() >= 120000) {
      setError("รูปเกิน 2 นาทีแล้ว กรุณาถ่ายใหม่");
      return;
    }
    setError("");
    setSubmittingEvidence(true);
    try {
      const next = await submitEvidence(room.code, targetId, photo, capturedAt);
      setRoom(next);
      void refresh();
      clearPhoto();
      setToast("ส่งแล้ว · รอ Host ตรวจ รูปที่ส่งสำเร็จจะไม่หมดอายุ");
    } catch (e) {
      setError(errorMessage(e, "ส่งหลักฐานไม่สำเร็จ"));
    } finally {
      setSubmittingEvidence(false);
      void refresh();
    }
  };
  return (
    <main className={`app-shell player-app player-tab-${tab}`}>
      <Header
        code={room.code}
        label="พื้นที่ผู้เล่น"
        onLeave={() => setIsLeaveModalOpen(true)}
      />
      <ConnectionStatus />
      {stale && (
        <div className="error-banner" role="status">
          ข้อมูลอาจยังไม่อัปเดต{" "}
          <button className="text-button" onClick={() => void refresh()}>
            เชื่อมต่อใหม่
          </button>
        </div>
      )}
      <GameNavigation active={tab} onChange={setTab} />
      <div className="player-layout">
        {tab === "players" && (
          <section className="tab-content panel">
            <span className="section-kicker">ทุกคนมีความลับ</span>
            <h1>
              ผู้เล่นในห้อง <small>{room.players.length} คน</small>
            </h1>
            <p className="muted">สถานะออนไลน์แยกจากสถานะชีวิต</p>
            <div className="players-grid">
              {room.players.map((player) => (
                <div key={player.id}>
                  {player.id === playerId && (
                    <span className="you-tag">คุณ</span>
                  )}
                  <PlayerCard player={player} />
                </div>
              ))}
            </div>
          </section>
        )}
        {tab === "news" && (
          <section className="tab-content panel">
            <span className="section-kicker">อัปเดตจากห้องเกม</span>
            <h1>ข่าวสาร</h1>
            <Events room={room} playerId={playerId} />
          </section>
        )}
        {tab === "more" && (
          <section className="tab-content panel">
            <span className="section-kicker">{mine?.name}</span>
            <h1>เพิ่มเติม</h1>
            <div className="menu-list">
              <button onClick={() => setRoleOpen(true)}>
                <Shield size={20} /> บทบาทของฉัน <ArrowFallback />
              </button>
              <button onClick={() => setShowRules(true)}>
                <Eye size={20} /> กติกาและวิธีเล่น <ArrowFallback />
              </button>
              {reclaimToken && (
                <button onClick={() => setShowRecovery(true)}>
                  <Shield size={20} /> รหัสกู้คืนของฉัน <ArrowFallback />
                </button>
              )}
              <NotificationToggle code={code} />
              <button
                className="danger-text"
                onClick={() => setIsLeaveModalOpen(true)}
              >
                <DoorOpen size={20} /> ออกจากห้อง <ArrowFallback />
              </button>
            </div>
            <p className="muted">
              การแจ้งเตือนบนหน้าจอล็อกจะแสดงเพียงว่ามีอัปเดตใหม่
              รายละเอียดส่วนตัวอ่านได้ในเกมเท่านั้น
            </p>
          </section>
        )}
        <section className="main-column player-home" hidden={tab !== "home"}>
          <div className="player-greeting">
            <div>
              <span className="section-kicker">ห้อง {code}</span>
              <h2>สวัสดี, {mine?.name}</h2>
            </div>
            <span className={`phase-badge phase-${room.phase}`}>
              <span />
              {PHASE_LABELS[room.phase]}
            </span>
          </div>
          <div className={`player-hero ${isKiller ? "is-killer" : ""}`}>
            <img
              className="player-hero-art"
              src={ROLE_ART[me.currentRole]}
              alt=""
              aria-hidden="true"
            />
            <span className="section-kicker">บทบาทส่วนตัวของคุณ</span>
            <h1>{ROLE_LABELS[me.currentRole]}</h1>
            <p>{ROLE_DETAILS[me.currentRole]}</p>
            <button className="text-button" onClick={() => setRoleOpen(true)}>
              <Eye size={15} /> อ่านบทบาทของฉัน
            </button>
            <div className="identity-stamp">
              {me.team === "killers" ? "ฝ่าย Killer" : "ฝ่ายเมือง"}
            </div>
          </div>
          {room.phase === "bomb-resolution" && (
            <div className="quota-cooldown-notice">
              <AlertTriangle />
              <div>
                <strong>รอ Host จัดการระเบิด</strong>
                <p>พักการโจมตีระหว่างจัดการเหตุการณ์</p>
              </div>
            </div>
          )}
          {room.phase === "police-check" && (
            <div className="quota-cooldown-notice">
              <Shield />
              <div>
                <strong>ถึงเวลาตำรวจชี้ตัว</strong>
                <p>หยุดการโจมตีปกติ รอผลการชี้ตัว</p>
              </div>
            </div>
          )}
          {room.policeCheckAt && room.phase === "active" && (
            <div className="panel schedule-preview">
              <Clock3 size={22} />
              <div>
                <span className="muted">เวลาตำรวจชี้ตัว · เวลาไทย</span>
                <strong>
                  {new Date(room.policeCheckAt).toLocaleString("th-TH", {
                    timeZone: "Asia/Bangkok",
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </strong>
              </div>
            </div>
          )}
          {me.currentRole === "police" &&
            !room.policeCheckAt &&
            room.phase === "active" && (
              <div className="panel">
                <Clock3 size={20} />
                <p>รอ Host กำหนดเวลาชี้ตัว</p>
              </div>
            )}
          {me.currentRole === "reporter" && me.hasUsedAbility && (
            <div className="panel">
              <Check size={22} />
              <h2>ใช้ความสามารถแล้ว</h2>
              <p>อ่านผลตรวจส่วนตัวได้ในข่าวสาร</p>
              <button
                className="secondary-action"
                onClick={() => setTab("news")}
              >
                ดูข่าวสารส่วนตัว
              </button>
            </div>
          )}
          {isKiller && (
            <div className="panel quota-panel">
              <span className="section-kicker">โควต้าอนุมัติชั่วโมงนี้</span>
              <h2>
                อนุมัติแล้ว {room.attacksThisHour} / {room.attackLimit}
              </h2>
              <div className="quota-meter">
                <span
                  style={{
                    width: `${Math.min(100, (room.attacksThisHour / room.attackLimit) * 100)}%`,
                  }}
                />
              </div>
              <p>
                รีเซ็ต{" "}
                {new Date(
                  Math.floor(now / 3600000) * 3600000 + 3600000,
                ).toLocaleTimeString("th-TH", {
                  timeZone: "Asia/Bangkok",
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                น. เวลาไทย · นับภาพอนุมัติ ไม่ใช่จำนวนผู้ถูกกำจัด
              </p>
            </div>
          )}
          {isKiller && <KillerProgress room={room} playerId={playerId} />}
          {!isKiller && (
            <div className="personal-health panel">
              <div>
                <span className="section-kicker">หัวใจของคุณ</span>
                <h2>
                  {me.hearts} <small>/ {me.maxHearts}</small>
                </h2>
              </div>
              <Hearts count={me.hearts} max={me.maxHearts} />
            </div>
          )}
          {quotaExhausted && (
            <div className="quota-cooldown-notice">
              <Clock3 size={24} />
              <div>
                <span className="section-kicker">โควต้าชั่วโมงนี้เต็มแล้ว</span>
                <strong>โควต้าภาพอนุมัติเต็มแล้ว</strong>
                <p>
                  ไม่สามารถถ่ายหรือส่งรูปได้ กรุณารอรีเซ็ตโควต้าเมื่อขึ้นชั่วโมงใหม่ตามเวลาไทย
                </p>
              </div>
            </div>
          )}
          {isKiller && mine?.health !== "dead" && room.phase === "active" && (
            <div className="panel action-panel">
              <div className="panel-heading">
                <div>
                  <span className="section-kicker">ภารกิจของคุณ</span>
                  <h2>เลือกเป้าหมาย</h2>
                </div>
                <span className="quota">
                  {Math.max(0, room.attackLimit - room.attacksThisHour)}{" "}
                  ภาพอนุมัติคงเหลือ
                </span>
              </div>
              <select
                aria-label="เลือกเป้าหมาย"
                value={targetId}
                onChange={(e) => {
                  cameraTargetRef.current = null;
                  clearPhoto();
                  setTargetId(e.target.value);
                }}
                disabled={submittingEvidence || quotaExhausted}
              >
                <option value="">เลือกผู้เล่น...</option>
                {room.players
                  .filter(
                    (player) =>
                      player.id !== playerId &&
                      player.health !== "dead" &&
                      !room.privateStates[player.id]?.isActiveKiller,
                  )
                  .map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.name}
                    </option>
                  ))}
              </select>
              {target && (
                <div className="target-confirm">
                  <span className="avatar">{target.name.slice(0, 1)}</span>
                  <div>
                    <strong>{target.name}</strong>
                    <small>ผลลัพธ์จะแสดงหลัง Host อนุมัติ</small>
                  </div>
                  <Eye size={17} />
                </div>
              )}
              <div className="camera-drop">
                <Camera size={24} />
                <span>
                  ใช้กล้องมือถือเพื่อถ่ายและซูมภาพ
                  <small>เมื่อกลับมาที่เว็บ จะมีเวลา 2 นาทีเพื่อส่งให้ Host</small>
                </span>
              </div>
              {!target && <p className="muted">เลือกเป้าหมายก่อนเปิดกล้อง</p>}
              <NativeCamera
                disabled={submittingEvidence || quotaExhausted || !target || tab !== "home"}
                onOpen={() => {
                  cameraTargetRef.current = target?.id ?? null;
                  setError("");
                }}
                onCapture={receiveCameraPhoto}
                onError={setError}
              />
              {photoPreview && (
                <div className="evidence-preview">
                  <img src={photoPreview} alt="ตัวอย่างหลักฐานก่อนส่ง" />
                  <button
                    type="button"
                    className="preview-remove"
                    disabled={submittingEvidence || quotaExhausted}
                    onClick={clearPhoto}
                    aria-label="ลบรูปและถ่ายใหม่"
                  >
                    <X size={18} />
                  </button>
                  <span role="status">
                    {photoSeconds > 0
                      ? `เป้าหมาย: ${target?.name ?? "กรุณาเลือกใหม่"} · ส่งภายใน ${Math.floor(photoSeconds / 60)}:${String(photoSeconds % 60).padStart(2, "0")}`
                      : "รูปเกิน 2 นาทีแล้ว กรุณาถ่ายใหม่"}
                  </span>
                </div>
              )}
              <button
                className="primary-action"
                disabled={
                  !target ||
                  !photo ||
                  !capturedAt ||
                  photoSeconds <= 0 ||
                  quotaExhausted ||
                  submittingEvidence
                }
                onClick={sendEvidence}
              >
                {submittingEvidence
                  ? "กำลังส่งหลักฐาน..."
                  : "ส่งหลักฐานให้ Host"}{" "}
                <span>→</span>
              </button>
            </div>
          )}
          {me.currentRole === "police" &&
            mine?.health !== "dead" &&
            room.phase === "police-check" && (
              <div className="panel action-panel">
                <Shield size={19} />
                <h2>ชี้ตัวผู้ต้องสงสัย</h2>
                <select
                  aria-label="เลือกเป้าหมาย"
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                >
                  <option value="">เลือกผู้ต้องสงสัย...</option>
                  {room.players
                    .filter(
                      (player) =>
                        player.id !== playerId && player.health !== "dead",
                    )
                    .map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.name}
                      </option>
                    ))}
                </select>
                <button
                  className="danger-action"
                  disabled={!target || busy}
                  onClick={() =>
                    setConfirmation({
                      title: "ยืนยันผู้ต้องสงสัย",
                      detail: `คุณกำลังชี้ตัว ${target?.name} หากถูก ฝ่ายเมืองชนะ หากผิด ฝ่าย Killer ชนะ`,
                      action: () =>
                        act(() => resolvePoliceCheck(room.code, targetId)),
                    })
                  }
                >
                  ยืนยันการชี้ตัว <Shield size={16} />
                </button>
              </div>
            )}
          {me.currentRole === "reporter" &&
            !me.hasUsedAbility &&
            mine?.health !== "dead" &&
            ["active", "bomb-resolution", "police-check"].includes(
              room.phase,
            ) && (
              <div className="panel action-panel">
                <Eye size={19} />
                <h2>ตรวจบทบาทเริ่มต้น</h2>
                <select
                  aria-label="เลือกผู้เล่นเพื่อตรวจบทบาท"
                  value={reportTarget}
                  onChange={(e) => setReportTarget(e.target.value)}
                >
                  <option value="">เลือกผู้เล่น...</option>
                  {room.players
                    .filter(
                      (player) =>
                        player.id !== playerId && player.health !== "dead",
                    )
                    .map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.name}
                      </option>
                    ))}
                </select>
                <button
                  className="secondary-action"
                  disabled={!validReportTarget || busy}
                  onClick={() =>
                    setConfirmation({
                      title: "ใช้ความสามารถนักข่าว",
                      detail: `ตรวจบทบาทเริ่มต้นของ ${room.players.find((p) => p.id === reportTarget)?.name} ใช้ได้เพียง 1 ครั้งต่อเกม และผลจะปรากฏในข่าวสารส่วนตัว`,
                      action: () =>
                        act(() => reporterAbility(room.code, reportTarget)),
                    })
                  }
                >
                  ใช้ความสามารถ <Eye size={16} />
                </button>
              </div>
            )}
          {mine?.health === "dead" && (
            <div className="dead-card">
              <Skull size={27} />
              <div>
                <strong>คุณถูกกำจัดแล้ว</strong>
                <p>รับชมเกมต่อได้ แต่ใช้ความสามารถไม่ได้</p>
              </div>
            </div>
          )}
          <ErrorBanner error={error} />
          <div className="panel">
            <div className="panel-heading">
              <h2>ข่าวล่าสุด</h2>
            </div>
            <Events room playerId={playerId} />
          </div>
        </section>
        <aside className="side-column" hidden={tab !== "home"}>
          <div className="panel privacy-note">
            <Shield size={19} />
            <strong>ข้อมูลส่วนตัว</strong>
            <p>บทบาทและหัวใจเป็นความลับของคุณ ระวังคนรอบตัวขณะเปิดหน้าจอ</p>
          </div>
        </aside>
      </div>
      {showRules && <Rules onClose={() => setShowRules(false)} />}
      {showRecovery && (
        <RecoveryCard
          token={reclaimToken}
          onClose={() => setShowRecovery(false)}
        />
      )}
      {roleOpen && !showRecovery && room.phase !== "ended" && (
        <RoleReveal
          role={me.currentRole}
          hearts={me.hearts}
          maxHearts={me.maxHearts}
          previous={ackRole !== me.currentRole ? ackRole : undefined}
          onClose={() => {
            setRoleOpen(false);
            setAckRole(me.currentRole);
          }}
        />
      )}
      {confirmation && (
        <Dialog
          title={confirmation.title}
          onClose={() => setConfirmation(null)}
        >
          <p>{confirmation.detail}</p>
          <button
            className="primary-action"
            onClick={() => {
              const action = confirmation.action;
              setConfirmation(null);
              action();
            }}
          >
            ยืนยันดำเนินการ <Check size={18} />
          </button>
          <button
            className="secondary-action"
            onClick={() => setConfirmation(null)}
          >
            ยกเลิก
          </button>
        </Dialog>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={16} /> {toast}
        </div>
      )}
      <LeaveConfirmModal
        expectedName={loginName}
        isOpen={isLeaveModalOpen}
        onClose={() => setIsLeaveModalOpen(false)}
        onConfirm={handleConfirmLeave}
      />
    </main>
  );
}

function ArrowFallback() {
  return <span aria-hidden="true">→</span>;
}
