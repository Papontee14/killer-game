"use client";
/* The room credential bootstrap intentionally runs once per room code. */
/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @next/next/no-img-element */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { PlayerAvatar, PixelIcon } from "./pixel-ui";
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
  EyeOff,
  Heart,
  Hourglass,
  Minus,
  Plus,
  Radio,
  Shield,
  Skull,
  Trophy,
  UserMinus,
  X,
} from "lucide-react";
import {
  approveEvidence,
  closeRoom,
  createOrLoadRoom,
  endGame,
  heartbeat,
  joinOrCreateDemo,
  loadAttackActivityImage,
  loadRoom,
  rejectEvidence,
  reporterAbility,
  resolveBomb,
  resolvePoliceCheck,
  setAccusationAt,
  selectAvatar,
  removeLobbyPlayer,
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
import { AVATARS, type AvatarGender, avatarById } from "@/src/avatar-catalog";
import { V24Panel } from "./v24-panel";
import { V24_ROLE_DETAILS } from "@/src/v24-rules";
import { ROLE_ART, roleArtAlt, roleArtForPlayer } from "@/src/role-art";
import { downloadEvidenceArchive } from "@/src/evidence-download";
import {
  getNotificationPermission,
  requestNotificationPermission,
  schedulePoliceCheckReminder,
  showGenericNotification,
  subscribeToWebPush,
} from "@/src/notifications";

import { NativeCamera } from "./native-camera";
import { KillerProgress } from "./killer-progress";
import { RoomInvite } from "./room-invite";
import { PrivacyBoundary, capturePrivateView, type PrivateViewSnapshot } from "./privacy-boundary";
import {
  Brand,
  Dialog,
  GameNavigation,
  PHASE_LABELS,
  RoleReveal,
  ROLE_SUMMARIES,
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

function formatDuration(totalMinutes: number) {
  totalMinutes = Math.max(0, totalMinutes);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours} ชั่วโมง${minutes ? ` ${minutes} นาที` : ""}`;
}

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

    const refreshIfLive = async () => {
      try {
        const next = await loadRoom(code);
        if (!stopped) {
          // Realtime updates the open view only. Web Push is the single mobile
          // notification path, so a delayed push cannot duplicate this update.
          replaceRoom(next);
          setStale(false);
        }
      } catch {
        if (!stopped) setStale(true);
      } finally {
        if (!stopped) setInitialLoadComplete(true);
      }
    };
    refreshIfLive();
    const timer = window.setInterval(() => void refreshIfLive(), 15000);
    const supabase = getSupabaseBrowser();
    const channel = supabase
      ?.channel(`room-signal-${code}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "room_signals" },
        () => void refreshIfLive(),
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

function usePoliceCheckReminder(
  code: string,
  policeCheckAt: string | undefined,
  isHost: boolean,
) {
  useEffect(
    () => schedulePoliceCheckReminder(code, policeCheckAt, isHost),
    [code, policeCheckAt, isHost],
  );
}

function NotificationToggle({ code }: { code: string }) {
  const [permission, setPermission] = useState<string>("default");
  const [pushState, setPushState] = useState<"idle" | "pending" | "ready" | "failed">("idle");

  const setupWebPush = useCallback(async () => {
    setPushState("pending");
    try {
      const supabase = getSupabaseBrowser();
      const session = await supabase?.auth.getSession();
      const token = session?.data.session?.access_token;
      const ready = !!token && !!code && await subscribeToWebPush(code, token);
      setPushState(ready ? "ready" : "failed");
      return ready;
    } catch {
      setPushState("failed");
      return false;
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
    return <button type="button" className="topbar-btn" disabled title="เบราว์เซอร์ไม่รองรับการแจ้งเตือน" aria-label="เบราว์เซอร์ไม่รองรับการแจ้งเตือน"><BellOff size={15} /><span className="notif-label">ไม่รองรับแจ้งเตือน</span></button>;

  const handleToggle = async () => {
    const next = await requestNotificationPermission();
    setPermission(next);
    if (next === "granted") {
      if (await setupWebPush()) {
        void showGenericNotification("เปิดการแจ้งเตือนสำเร็จ");
      }
    }
  };

  return (
    <button
      className={`topbar-btn ${pushState === "ready" ? "" : "notice"}`}
      aria-label={pushState === "ready" ? "แจ้งเตือนเปิดแล้ว" : pushState === "failed" ? "เปิดแจ้งเตือนอีกครั้ง" : "เปิดแจ้งเตือน"}
      disabled={pushState === "pending"}
      onClick={() => void handleToggle()}
      title={
        pushState === "failed"
          ? "ยังลงทะเบียนแจ้งเตือนตอนปิดจอไม่สำเร็จ กดเพื่อลองอีกครั้ง"
          : pushState === "ready"
          ? "ลงทะเบียนรับแจ้งเตือนแล้ว การแสดงผลขึ้นกับการตั้งค่ามือถือ"
          : "กดเพื่อเปิดการแจ้งเตือนบนมือถือ"
      }
      type="button"
    >
      {pushState === "ready" ? <Bell size={15} /> : <BellOff size={15} />}
      <span className="notif-label">
        {pushState === "pending"
          ? "กำลังเปิดแจ้งเตือน…"
          : pushState === "failed"
            ? "แจ้งเตือนยังไม่พร้อม · ลองอีกครั้ง"
          : pushState === "ready"
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
  onHideScreen,
  action,
}: {
  code: string;
  label: string;
  back?: boolean;
  onLeave?: () => void;
  onHideScreen?: () => void;
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
        back ? (
          <a className="back-link" href="/" aria-label="กลับหน้าหลัก">
            <ChevronLeft size={17} />
          </a>
        ) : null
      )}
      <Brand small />
      <span className="topbar-title">{label}</span>
      <div className="topbar-actions">
        {onHideScreen && (
          <button
            type="button"
            className="topbar-btn privacy-button"
            onClick={onHideScreen}
            title="ซ่อนหน้าจอ"
            aria-label="ซ่อนหน้าจอ"
          >
            <EyeOff size={16} /> <span>ซ่อนหน้าจอ</span>
          </button>
        )}
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
    "reporter ability requires more than half of starting players alive":
      "ใช้ความสามารถไม่ได้: ผู้เล่นที่ยังมีชีวิตเหลือครึ่งหนึ่งหรือน้อยกว่าจำนวนเริ่มต้น",
    "police accusation unavailable":
      "ชี้ตัวไม่ได้ เป้าหมายหรือช่วงเกมอาจเปลี่ยนแล้ว กรุณาเลือกใหม่",
    "player name is already in use":
      "ชื่อนี้อยู่ในห้องแล้ว กรุณาใช้ชื่ออื่น",
    "invalid room or host cannot play":
      "ไม่พบห้อง ห้องถูกปิด หรือคุณเป็น Host ซึ่งไม่สามารถร่วมเป็นผู้เล่นได้",
    "game already started":
      "เกมเริ่มแล้ว เข้าร่วมผู้เล่นใหม่ไม่ได้",
    "not allowed":
      "ดำเนินการไม่ได้ สิทธิ์หรือสถานะเกมอาจเปลี่ยนแล้ว กรุณาตรวจสอบและลองใหม่",
    "target is dead": "เป้าหมายถูกกำจัดแล้ว กรุณาเลือกผู้เล่นใหม่",
    "evidence is no longer pending":
      "หลักฐานนี้ถูกจัดการแล้ว หรือเกมเปลี่ยนช่วง กรุณาตรวจสอบคิวอีกครั้ง",
    "resolve earlier event first": "ต้อง resolve เหตุการณ์ก่อนหน้าในคิวก่อน",
    "waiting for capture upload window": "รอครบ 2 นาทีจาก effective time เพื่อให้เรียงภาพที่ยังส่งไม่ครบได้ถูกต้อง",
    "resolve bomb first": "กรุณาตัดสินผล Bomber ก่อน",
    "target protected; reject evidence": "ภาพอยู่ในช่วง protection ของเป้าหมาย กรุณาปฏิเสธหลักฐาน",
    "rolling attack quota reached; reject evidence": "เกินโควตา 3 attacks ต่อ rolling 60 นาที กรุณาปฏิเสธหลักฐาน",
    "rolling kill quota reached; reject evidence": "เกินโควตา 1 kill ต่อ rolling 60 นาที กรุณาปฏิเสธหลักฐาน",
    "rolling attack reservations full": "โควตาโจมตีถูกใช้หรือจองเต็มแล้ว รอคิวเดิมหรือ rolling window คืนโควตา",
    "pending evidence limit reached": "มีหลักฐานรอตรวจครบ 2 ชิ้นแล้ว",
    "doctor ability unavailable": "Doctor ใช้ความสามารถไม่ได้ ตรวจเวลา จำนวนครั้ง และเป้าหมาย",
    "reveal unavailable": "Reveal ใช้ไม่ได้ในสถานะปัจจุบันหรือพ้นกำหนดแล้ว",
    "invalid ballot": "เลือกผู้เล่นอื่นที่ยังมีชีวิตให้ครบจำนวนและไม่ซ้ำกัน",
    "invalid police ranking": "กรุณาจัดลำดับผู้เล่นอื่นที่ยังมีชีวิตทุกคน",
    "vote unavailable": "ยังไม่เปิดโหวตหรือหมดเวลาลงคะแนนแล้ว",
    "configure proximity rule before start": "กรุณาบันทึกระยะเวลาเกมก่อนเริ่มเกม",
    "invalid v24 settings": "เวลาเกมต้องอยู่ระหว่าง 2 ชั่วโมง 1 นาที ถึง 48 ชั่วโมง",
    "hourly kill quota reached":
      "โควต้าคิลเต็มแล้ว อนุมัติได้เฉพาะภาพที่ไม่ทำให้เป้าหมายตายจนกว่าจะขึ้นชั่วโมงใหม่เวลาไทย",
    "killer ability unavailable": "ใช้ความสามารถ Killer ไม่ได้ในสถานะปัจจุบัน",
    "killer is not active": "ผู้ส่งหลักฐานไม่สามารถโจมตีได้แล้ว",
    "evidence is not allowed, missing, or stale":
      "รูปหมดอายุหรือเป้าหมายเปลี่ยนสถานะ กรุณาตรวจสอบแล้วถ่ายใหม่",
    "invalid bomb targets":
      "เลือกผู้เล่นที่ยังมีชีวิตได้ 0–2 คน กรุณาทบทวนรายชื่อ",
    "invalid player count or required roles":
      "จำนวนบทบาทต้องตรงกับผู้เล่น และต้องมี Killer กับตำรวจ",
    "invalid player count, avatar selection, or required roles":
      "ผู้เล่นทุกคนต้องเลือกรูปโปรไฟล์ และจำนวนบทบาทต้องตรงกันก่อนเริ่มเกม",
    "avatar already selected": "รูปโปรไฟล์นี้มีคนเลือกแล้ว กรุณาเลือกรูปอื่น",
    "invalid avatar": "ไม่พบรูปโปรไฟล์นี้ กรุณาเลือกใหม่",
    "room is full": "ห้องเต็มแล้ว รับผู้เล่นได้สูงสุด 28 คน",
    "player not found": "ไม่พบผู้เล่นในห้องรอแล้ว",
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
  onHideScreen,
}: {
  expectedName: string;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  onHideScreen?: () => void;
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
    <Dialog title="ออกจากเกม" onClose={close} onHideScreen={onHideScreen}>
      <p>
        พิมพ์ชื่อ <strong>{expectedName}</strong> เพื่อยืนยัน
        สถานะผู้เล่นของคุณยังอยู่ในเกม
        หากออกจากอุปกรณ์นี้หรือล้างข้อมูล จะกลับเข้าผู้เล่นเดิมไม่ได้
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
        <PixelIcon name="heart"
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
      <PlayerAvatar avatarId={player.avatarId} />
      {visibleState && (
        <img
          className="role-thumb role-thumb-player"
          src={roleArtForPlayer(state.currentRole, player.id)}
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
            {state.team === "killers" ? "Killer Side" : "City Side"}
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

function AvatarPicker({
  room,
  playerId,
  onSelect,
  onClose,
  busy,
}: {
  room: RoomState;
  playerId: string;
  onSelect: (avatarId: string) => void;
  onClose: () => void;
  busy: boolean;
}) {
  const [filter, setFilter] = useState<"all" | AvatarGender>("all");
  const [previewId, setPreviewId] = useState<string | null>(
    room.players.find((player) => player.id === playerId)?.avatarId ?? null,
  );
  const selected = previewId ? avatarById.get(previewId) : undefined;
  const owners = new Map(
    room.players.filter((player) => player.id !== playerId && player.avatarId)
      .map((player) => [player.avatarId!, player.name]),
  );
  const visible = AVATARS.filter((avatar) => filter === "all" || avatar.gender === filter);
  return (
    <Dialog title="เลือกรูปโปรไฟล์" onClose={onClose} className="avatar-dialog">
      <p className="muted">รูปโปรไฟล์ในห้องเดียวกันห้ามซ้ำกัน เลือกได้จนกว่า Host จะเริ่มเกม</p>
      <div className="avatar-filters" role="group" aria-label="กรองรูปโปรไฟล์">
        {(["all", "male", "female"] as const).map((value) => (
          <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>
            {value === "all" ? "ทั้งหมด" : value === "male" ? "ชาย" : "หญิง"}
          </button>
        ))}
      </div>
      <div className="avatar-grid">
        {visible.map((avatar) => {
          const owner = owners.get(avatar.id);
          return <button key={avatar.id} className={`avatar-choice ${previewId === avatar.id ? "selected" : ""} ${owner ? "taken" : ""}`} disabled={Boolean(owner)} onClick={() => setPreviewId(avatar.id)}>
            <img src={avatar.src} alt="" loading="lazy" />
            {owner && <small>เลือกโดย {owner}</small>}
          </button>;
        })}
      </div>
      <div className="avatar-preview" aria-live="polite">
        {selected ? <><img src={selected.src} alt="" /><div><small>กดใช้รูปนี้เพื่อยืนยัน</small></div></> : <span className="muted">เลือกรูปเพื่อดูตัวอย่าง</span>}
        <button className="primary-action" disabled={!selected || busy} onClick={() => selected && onSelect(selected.id)}>ใช้รูปนี้</button>
      </div>
    </Dialog>
  );
}

function attackHistoryLockedForViewer(room: RoomState, now = Date.now()) {
  const viewer = room.playerId
    ? room.players.find((player) => player.id === room.playerId)
    : undefined;
  return Boolean(
    room.v24?.finalVoteRules &&
      room.viewerRole === "player" &&
      viewer?.health !== "dead" &&
      room.phase !== "ended" &&
      room.v24.cutoffAt &&
      now >= Date.parse(room.v24.cutoffAt),
  );
}

function reporterAbilityStatus(
  room: RoomState,
  playerId: string | null,
  now = Date.now(),
) {
  const initialCount = room.players.length;
  const aliveCount = room.players.filter(
    (player) => player.health !== "dead",
  ).length;
  const minimumAlive = Math.floor(initialCount / 2) + 1;
  const me = playerId ? room.privateStates[playerId] : undefined;
  const player = room.players.find((candidate) => candidate.id === playerId);
  const phaseAllowed = room.rulesVersion === "2.4"
    ? ["active", "bomb-resolution"].includes(room.phase)
    : ["active", "bomb-resolution", "police-check"].includes(room.phase);
  const beforeCutoff = room.rulesVersion !== "2.4" ||
    !room.v24?.cutoffAt || now < Date.parse(room.v24.cutoffAt);
  let reason = "";
  if (me?.hasUsedAbility) reason = "คุณใช้ความสามารถนี้ไปแล้ว";
  else if (player?.health === "dead") reason = "คุณถูกกำจัดแล้ว";
  else if (!phaseAllowed) reason = "ยังไม่อยู่ในช่วงที่ใช้ความสามารถได้";
  else if (!beforeCutoff) reason = "พ้นเวลาที่ใช้ความสามารถได้แล้ว";
  else if (aliveCount < minimumAlive)
    reason = "ผู้เล่นที่ยังมีชีวิตเหลือครึ่งหนึ่งหรือน้อยกว่าจำนวนเริ่มต้น";
  return { aliveCount, initialCount, minimumAlive, available: !reason, reason };
}

function isAttackRelatedEvent(event: RoomState["events"][number]) {
  return event.type === "attack" ||
    event.type === "bomb" ||
    (event.type === "warning" &&
      (event.message === "คุณถูกโจมตีและเสียหัวใจ 1 ดวง" ||
        event.message.endsWith(" ถูกกำจัด"))) ||
    (event.type === "ability" &&
      [
        "Killer's Wife has awakened. There are now two active Killers.",
        "คุณปลดพลัง Killer’s Wife แล้ว",
        "Killer has eliminated Killer's Wife. There are now two Killers.",
        "คุณกลายเป็น Killer แล้ว",
      ].includes(event.message));
}

function Events({
  room,
  playerId,
}: {
  room: RoomState | boolean;
  playerId?: string;
}) {
  const resolvedRoom = typeof room === "boolean" ? latestRoom : room;
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    if (!resolvedRoom?.v24?.finalVoteRules) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [resolvedRoom?.code, resolvedRoom?.v24?.finalVoteRules]);
  if (!resolvedRoom) return null;
  const visible = (playerId
    ? resolvedRoom.events.filter(
        (event) => !event.playerId || event.playerId === playerId,
      )
    : resolvedRoom.events).filter(
      (event) => !attackHistoryLockedForViewer(resolvedRoom) || !isAttackRelatedEvent(event),
    );
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
function AttackActivityPanel({ room }: { room: RoomState }) {
  const [visibleCount, setVisibleCount] = useState(20);
  const [images, setImages] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<{ url: string; label: string } | null>(null);
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    if (!room.v24?.finalVoteRules) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [room.code, room.v24?.finalVoteRules]);
  const hidden = room.attackActivityHidden || attackHistoryLockedForViewer(room);
  const visible = hidden ? [] : room.attackActivity.slice(0, visibleCount);
  const signature = visible.map((item) => item.id).join(",");
  useEffect(() => {
    let cancelled = false;
    void Promise.all(visible.map(async (item) => {
      if (!item.storagePath || images[item.id] || failed[item.id]) return;
      try {
        const url = await loadAttackActivityImage(item.storagePath);
        if (!cancelled) setImages((current) => ({ ...current, [item.id]: url }));
      } catch {
        if (!cancelled) setFailed((current) => ({ ...current, [item.id]: true }));
      }
    }));
    return () => { cancelled = true; };
  }, [signature, room.code]);
  useEffect(() => { setVisibleCount(20); setImages({}); setFailed({}); setExpanded(null); }, [room.code, hidden]);
  if (!room.canViewAttackActivity && !hidden) return null;
  const names = new Map(room.players.map((player) => [player.id, player.name]));
  const retry = (id: string) => {
    setFailed((current) => ({ ...current, [id]: false }));
    setImages((current) => { const next = { ...current }; delete next[id]; return next; });
  };
  return <section className="attack-activity" aria-label="Activity การโจมตี">
    <div className="panel-heading"><div><span className="section-kicker">เฉพาะผู้ถูกกำจัดและ Host</span><h2>Activity การโจมตี</h2></div><Clock3 size={16} className="muted" /></div>
    {hidden ? <div className="empty-state"><EyeOff size={24} /><p>ประวัติการโดนโจมตีถูกซ่อนจนจบเกม</p><small>จะแสดงอีกครั้งเมื่อเกมสิ้นสุด</small></div> : room.attackActivity.length === 0 ? <div className="empty-state"><Radio size={24} /><p>ยังไม่มีการโจมตีที่อนุมัติ</p><small>รายการที่ Host อนุมัติจะแสดงที่นี่</small></div> : <div className="attack-activity-grid">
      {visible.map((item) => {
        const actor = names.get(item.killerId) ?? "ไม่ทราบชื่อ";
        const target = names.get(item.targetId) ?? "ไม่ทราบชื่อ";
        const label = `${actor} โจมตี ${target}`;
        const image = images[item.id];
        return <article className="attack-activity-card" key={item.id}>
          <div className="attack-activity-image">
            {image ? <button aria-label={`ขยายรูป ${label}`} onClick={() => setExpanded({ url: image, label })}><img src={image} alt={`หลักฐาน: ${label}`} onError={() => retry(item.id)} /></button>
              : failed[item.id] ? <div><span>โหลดรูปไม่สำเร็จ</span><button className="text-button" onClick={() => retry(item.id)}>ลองใหม่</button></div>
              : <span>กำลังโหลดรูป…</span>}
          </div>
          <div className="attack-activity-info">
            <strong>{label}</strong>
            <small>เวลาถ่าย: {new Date(item.capturedAt).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" })}</small>
            <small>Host อนุมัติ: {item.decisionAt ? new Date(item.decisionAt).toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }) : "ไม่มีข้อมูลเวลา"}</small>
            <span className={`attack-result ${item.result === "elimination confirmed" ? "lethal" : ""}`}>{item.result === "elimination confirmed" ? "ถูกกำจัดจากการโจมตีครั้งนี้" : item.result === "target is still alive" ? "เป้าหมายยังมีชีวิต" : "ไม่มีข้อมูลผลการโจมตี"}</span>
          </div>
        </article>;
      })}
    </div>}
    {!hidden && visibleCount < room.attackActivity.length && <button className="secondary-action activity-more" onClick={() => setVisibleCount((count) => count + 20)}>โหลดเพิ่มเติม</button>}
    {!hidden && expanded && <Dialog title={expanded.label} onClose={() => setExpanded(null)}><img className="attack-activity-expanded" src={expanded.url} alt={`หลักฐาน: ${expanded.label}`} /></Dialog>}
  </section>;
}

function EndGameReasonPanel({ room }: { room: RoomState }) {
  if (room.phase !== "ended") return null;
  if (!room.endGameResult) return (
    <div className="game-end-reason" aria-label="Game end reason">
      <span className="section-kicker">เหตุผลที่เกมจบ</span>
      <strong>ไม่มีข้อมูลเหตุผลจบเกมที่บันทึกไว้</strong>
    </div>
  );
  const result = room.endGameResult;
  const names = new Map(room.players.map((player) => [player.id, player.name]));
  const actor = result.actorPlayerId ? names.get(result.actorPlayerId) : undefined;
  const target = result.targetPlayerId ? names.get(result.targetPlayerId) : undefined;
  const affected = result.affectedPlayerIds
    .map((id) => names.get(id))
    .filter((name): name is string => Boolean(name));
  const labels: Record<string, string> = {
    "police-accusation-correct": "ตำรวจชี้ตัว Killer ถูกต้อง",
    "police-accusation-wrong": "ตำรวจชี้ตัวผู้บริสุทธิ์ผิด",
    "police-attacked": "Killer โจมตีตำรวจ",
    "police-eliminated-no-successor": "ตำรวจถูกกำจัดและไม่มี Detective รับตำแหน่งต่อ",
    "bomb-eliminated-all-killers": "ระเบิดกำจัด Killer ที่เหลือทั้งหมด",
    "bomb-eliminated-police-no-successor": "ระเบิดกำจัดตำรวจและไม่มี Detective รับตำแหน่งต่อ",
    "hunt-clock-expired": "Killer ไม่ทัน Hunt Clock",
    "all-killers-eliminated": "ไม่มี active Killer ที่ยังมีชีวิต",
    "police-lineage-eliminated": "ไม่มี living Police หลัง succession",
    "final-low-kills": "Final มี confirmed kills ต่ำกว่า 2",
    "final-vote": "ตัดสินจากผลโหวตลับ",
    "host-ended": "Host สั่งจบเกม",
  };
  const detail = result.reason.startsWith("police-accusation") && actor && target
      ? `${actor} ชี้ตัว ${target}`
    : result.reason === "police-attacked" && actor && target
      ? `${actor} โจมตี ${target}`
      : result.reason === "police-eliminated-no-successor" && actor && target
        ? `${target} ถูกกำจัดโดย ${actor}`
        : affected.length
          ? `ผู้ได้รับผล: ${affected.join(", ")}`
          : undefined;
  const winningTeam = room.winner === "city" ? "City Side ชนะ" : room.winner === "killers" ? "Killer Side ชนะ" : "เกมจบแล้ว";
  return (
    <div className="game-end-reason" aria-label="Game end reason">
      <span className="section-kicker">เหตุผลที่เกมจบ</span>
      <strong>{winningTeam} เพราะ {labels[result.reason] ?? "เกมจบแล้ว"}</strong>
      {detail && <span>{detail}</span>}
      {room.v24?.nominees && <span>Final nominees: {room.v24.nominees.map(id => room.players.find(p => p.id === id)?.name ?? "—").join(", ")}</span>}
      <time dateTime={result.occurredAt}>
        {new Date(result.occurredAt).toLocaleString("th-TH", {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: "Asia/Bangkok",
        })}
      </time>
    </div>
  );
}

type ForegroundNotification = { id: string; kind: "generic" | "evidence" | "police-reminder"; created_at: string };

function useRoomNotifications(code: string, onNotice: (message: string) => void, refresh: () => void) {
  const seen = useRef(new Set<string>());
  const connectedOnce = useRef(false);
  useEffect(() => {
    const supabase = getSupabaseBrowser();
    if (!supabase) return;
    let stopped = false;
    const message = (item: ForegroundNotification) => item.kind === "police-reminder"
      ? "ตำรวจจะทำการชี้ตัวใน 3 นาที" : item.kind === "evidence"
        ? "มีหลักฐานใหม่รอตรวจสอบ" : "มีเหตุการณ์ใหม่ในห้อง";
    const receive = (item: ForegroundNotification, announce: boolean) => {
      if (seen.current.has(item.id)) return;
      seen.current.add(item.id);
      if (announce && Date.now() - Date.parse(item.created_at) <= 30_000) onNotice(message(item));
      refresh();
    };
    const catchUp = async (announce: boolean) => {
      const { data } = await supabase.from("room_notifications").select("id,kind,created_at")
        .gte("created_at", new Date(Date.now() - 30_000).toISOString());
      if (!stopped) (data || []).forEach((item) => receive(item as ForegroundNotification, announce));
    };
    const channel = supabase.channel(`room-notification-${code}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "room_notifications" }, (payload) => receive(payload.new as ForegroundNotification, true))
      .subscribe((status) => {
        if (status !== "SUBSCRIBED") return;
        void catchUp(connectedOnce.current);
        connectedOnce.current = true;
      });
    return () => { stopped = true; supabase.removeChannel(channel); };
  }, [code, onNotice, refresh]);
}

function EndGameTimeline({ room }: { room: RoomState }) {
  if (room.phase !== "ended" || room.endGameTimeline.length === 0) return null;
  const names = new Map(room.players.map((player) => [player.id, player.name]));
  const messages = room.endGameTimeline.map((entry) => {
    const actor = entry.actorPlayerId ? names.get(entry.actorPlayerId) : undefined;
    const target = entry.targetPlayerId ? names.get(entry.targetPlayerId) : undefined;
    const message = entry.kind === "detective-eliminated" && target
      ? `${target} (Detective) ถูกกำจัด`
      : entry.kind === "detective-promoted" && target
        ? `${target} รับตำแหน่ง Police`
        : entry.kind === "police-attacked" && actor && target
          ? `Host อนุมัติหลักฐานที่ ${actor} โจมตี ${target} ซึ่งเป็น Police`
          : "ประกาศผลจบเกม";
    return { ...entry, message };
  });
  return <section className="game-end-timeline" aria-label="Game end timeline">
    <span className="section-kicker">ลำดับเหตุการณ์สำคัญ</span>
    <ol>{messages.map((entry, index) => <li key={`${entry.kind}-${entry.occurredAt}-${index}`}>
      <span>{entry.message}</span>
      <time dateTime={entry.occurredAt}>{new Date(entry.occurredAt).toLocaleString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" })}</time>
    </li>)}</ol>
  </section>;
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
            ? "City Side ชนะ"
            : resolvedRoom.winner === "killers"
              ? "Killer Side ชนะ"
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
        <EndGameReasonPanel room={room} />
        <EndGameTimeline room={room} />
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
                      src={roleArtForPlayer(summary.initialRole, player.id)}
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
                      ) : summary ? "ยังไม่ได้รับบทบาท" : "กำลังรอข้อมูลเฉลยบทบาท"}
                    </span>
                  </div>
                  <span className={`end-game-team team-${summary?.team ?? "none"}`}>
                    {summary?.team === "killers"
                      ? "Killer Side"
                      : summary?.team === "city"
                        ? "City Side"
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
  onRemove,
}: {
  room: RoomState;
  waiting?: boolean;
  onRemove?: (player: RoomState["players"][number]) => void;
}) {
  const selectedCount = room.players.filter((player) => player.avatarId).length;
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
        <strong>{selectedCount}/{room.players.length} เลือกแล้ว</strong>
      </div>
      {room.players.length === 0 ? (
        <div className="empty-state">
          <p>ยังไม่มีผู้เล่นเข้าห้อง</p>
        </div>
      ) : (
        <div className="players-grid">
          {room.players.map((player) => <div key={player.id} className="lobby-player-row">
            <PlayerCard player={player} />
            {!player.avatarId && <small className="avatar-needed">ยังไม่ได้เลือกรูปโปรไฟล์</small>}
            {onRemove && <button className="remove-lobby-player" onClick={() => onRemove(player)} aria-label={`นำ ${player.name} ออกจากห้อง`}><UserMinus size={16} /> นำออก</button>}
          </div>)}
        </div>
      )}
    </section>
  );
}
function Waiting({ room, onLeave, onChooseAvatar, playerId }: { room: RoomState; onLeave?: () => void; onChooseAvatar?: () => void; playerId?: string | null }) {
  const mine = room.players.find((player) => player.id === playerId);
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
              borderRadius: "0",
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
      <Skull className="waiting-skull" size={56} aria-hidden="true" />
      <div className="waiting-copy">
        <span className="section-kicker">KILLER · ห้อง {room.code}</span>
        <h1><Brand /></h1>
        <p>Host {room.hostName} กำลังเตรียมเกม</p>
        <p className="muted">ปิดเว็บหรือหลุดจากเครือข่าย ไม่ถือว่าถูกกำจัด</p>
        <div className="waiting-status" role="status" aria-live="polite">
          <span aria-hidden="true" />
          <strong>รอ Host เริ่มเกม</strong>
        </div>
        {mine && <section className="waiting-avatar panel">
          <PlayerAvatar avatarId={mine.avatarId} />
          <div><strong>{mine.avatarId ? "เลือกรูปโปรไฟล์แล้ว" : "ยังไม่ได้เลือกรูปโปรไฟล์"}</strong><small>{mine.avatarId ? "เปลี่ยนได้จนกว่า Host จะเริ่มเกม" : "เลือกให้เสร็จก่อน Host เริ่มเกม"}</small></div>
          {onChooseAvatar && <button className="primary-action" onClick={onChooseAvatar}>เลือกรูปโปรไฟล์</button>}
        </section>}
        <LobbyPlayers room={room} waiting />
        {room.rulesVersion === "2.4" && <section className="panel v24-panel"><h2>ตั้งค่าเกม · {formatDuration(room.v24?.durationMinutes ?? 600)}</h2><p>Hunt Clock 120 นาที · โหวตลับตอน Final</p></section>}
      </div>
    </main>
  );
}

export function HostRoom({ code, name }: { code: string; name?: string }) {
  const router = useRouter();
  const [room, refresh, run, setRoom, initialLoadComplete, stale] =
    useRoom(code);
  usePoliceCheckReminder(code, room?.policeCheckAt, true);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState("");
  const [leaving, setLeaving] = useState(false);
  const creationAttemptForCode = useRef<string | null>(null);
  const [tab, setTab] = useState("home");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
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
  useEffect(() => { if(room?.rulesVersion === "legacy" && room.phase === "lobby") setCounts({...DEFAULT_ROLE_COUNTS,doctor:0,sumo:1,villager:4}); }, [room?.code,room?.rulesVersion]);
  const [bombSelection, setBombSelection] = useState<string[]>([]);
  const [accusationAt, setAccusationAtInput] = useState("");
  const hostCredentials = readRoomCredentials(`host:${code}`);
  const hostName = name || hostCredentials?.name || "";
  useRoomNotifications(code, setNotice, refresh);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);
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
  if (room.rulesVersion === "2.4") pending.sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
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
                      } as Record<string, string>
                    )[tab]}
              </h1>
            </div>
            <div className={`phase-badge phase-${PHASE_LABELS[room.phase]}`}>
              <span />
              {PHASE_LABELS[room.phase]}
            </div>
          </div>
          {room.phase === "lobby" && tab === "home" && (
            <section className="host-room-banner" aria-label="ข้อมูลห้อง">
              <div><span className="section-kicker">รหัสเข้าร่วมห้อง</span><strong className="big-code">{room.code}</strong></div>
              <p><b>{room.players.length} คน</b> เข้าห้องแล้ว<br />แชร์รหัสนี้ให้เพื่อน แล้วจัดสรรบทบาทให้ครบ</p>
              <RoomInvite code={room.code} />
            </section>
          )}
          <Ended room={room} host />
          <EndGameReasonPanel room={room} />
          <EndGameTimeline room={room} />
          {room.phase === "lobby" && tab === "players" && (
            <LobbyPlayers room={room} onRemove={(player) => setConfirmation({
              title: "นำผู้เล่นออกจากห้อง",
              detail: `นำ ${player.name} ออกจากห้องรอ? รูปโปรไฟล์ที่เลือกจะว่างทันที`,
              action: () => act(() => removeLobbyPlayer(room.code, player.id)),
            })} />
          )}
          {room.phase === "lobby" && tab === "evidence" && (
            <div className="panel empty-state">
              <Camera size={28} />
              <h2>ยังไม่มีหลักฐานรอตรวจ</h2>
              <p>คิวหลักฐานจะเริ่มเมื่อ Host แจกบทบาทแล้ว</p>
            </div>
          )}
          {room.rulesVersion === "2.4" && <V24Panel room={room} act={act} busy={busy} />}
          {room.phase === "lobby" ? (
            <div className="panel setup-panel" data-host-section="home">
              <div className="panel-heading">
                <div>
                  <span className="section-kicker">จัดสรรบทบาท</span>
                  <h2>กำหนดบทบาท</h2>
                </div>
                <span className="count-total">{total} คน</span>
              </div>
              <div className="role-grid">
                {(Object.keys(DEFAULT_ROLE_COUNTS) as Role[]).filter(role => room.rulesVersion === "2.4" ? role !== "sumo" : role !== "doctor").map((role) => (
                  <div className="role-control" key={role}>
                    <img
                      className="role-thumb role-thumb-control"
                      src={ROLE_ART[role]}
                      alt=""
                      aria-hidden="true"
                    />
                    <div>
                      <strong>{ROLE_LABELS[role]}</strong>
                      <small>{room.rulesVersion === "2.4" && role === "killer-wife" ? 1 : ROLE_HEARTS[role] || "ไม่มี"} หัวใจ</small>
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
                        <Minus size={18} aria-hidden="true" />
                      </button>
                      <b>{counts[role]}</b>
                      <button
                        aria-label={`เพิ่ม ${ROLE_LABELS[role]}`}
                        disabled={
                          busy || counts[role] >= (role === "villager" ? 20 : 1)
                        }
                        onClick={() => adjust(role, 1)}
                      >
                        <Plus size={18} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button
                className="primary-action start-btn"
                disabled={busy || room.players.length !== total || room.players.some((player) => !player.avatarId)}
                onClick={() => act(() => startGame(room.code, Object.fromEntries(Object.entries(counts).filter(([role]) => room.rulesVersion === "2.4" ? role !== "sumo" : role !== "doctor"))))}
              >
                เริ่มแจกบทบาท ({room.players.length}/{total}){" "}
                <Radio size={18} />
              </button>
              {room.players.length !== total ? (
                <p className="muted">
                  จำนวนผู้เล่น {room.players.length} คน ต้องตรงกับบทบาท {total}{" "}
                  คน จึงจะเริ่มได้
                </p>
              ) : room.players.some((player) => !player.avatarId) ? <p className="muted">รอเลือกรูปโปรไฟล์: {room.players.filter((player) => !player.avatarId).map((player) => player.name).join(", ")}</p> : null}
            </div>
          ) : (
            <>
              {room.phase === "bomb-resolution" && (
                <div className="panel bomb-panel" data-host-section="urgent">
                  <div className="panel-heading">
                    <div>
                      <span className="section-kicker danger-kicker">
                        เหตุการณ์เร่งด่วน
                      </span>
                      <h2>Host เลือกผู้เล่นที่ใกล้ Bomber ที่สุด 0–{room.rulesVersion === "2.4" ? 1 : 2} คน</h2>
                      <p className="muted">Host ตัดสินจากภาพหลักฐานเองว่าใครอยู่ใกล้ Bomber ที่สุด แล้วเลือกให้เสียชีวิตได้</p>
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
                                : current.length < (room.rulesVersion === "2.4" ? 1 : 2)
                                  ? [...current, player.id]
                                  : current,
                            )
                          }
                        >
                          <PlayerAvatar avatarId={player.avatarId} />
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
              <section className="host-review-summary" data-host-section="home">
                <div>
                  <span className="section-kicker">งานรอตรวจ</span>
                  <h2>{pending.length} หลักฐานรอตรวจ</h2>
                  <p>{!["active", "resolution"].includes(room.phase) ? "พักการอนุมัติในช่วงนี้" : pending.length ? "เปิดภาพและตรวจเป้าหมายก่อนตัดสินผลตามลำดับเวลา" : "ตรวจครบแล้ว รอหลักฐานใหม่จากผู้เล่น"}</p>
                </div>
                <button className="primary-action" onClick={() => setTab("evidence")}>ตรวจหลักฐาน <Camera size={18} /></button>
              </section>
              <div className="metric-grid" data-host-section="home">
                <div className="metric-card">
                  <small>ผู้เล่น</small>
                  <strong>{room.players.length}</strong>
                  <span>คนในห้อง</span>
                </div>
                <div className="metric-card">
                  <small>โควต้าคิล</small>
                  <strong>
                    {room.rulesVersion === "2.4" ? room.v24?.killsUsed ?? 0 : room.killsThisHour}
                    <em>/{room.rulesVersion === "2.4" ? 1 : room.killLimit}</em>
                  </strong>
                  <span>{room.rulesVersion === "2.4" ? "คิลใน rolling 60 นาที" : "คิลในชั่วโมงนี้ · เวลาไทย"}</span>
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
                hidden={room.rulesVersion === "2.4"}
                data-host-section="home"
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
                {(room.rulesVersion === "2.4" ? (room.v24?.killsUsed ?? 0) >= 1 : room.killsThisHour >= room.killLimit) && (
                  <p className="amber-text">
                    โควต้าคิลเต็ม · อนุมัติได้เฉพาะภาพที่ไม่ทำให้เป้าหมายตาย
                  </p>
                )}
                {!["active", "resolution"].includes(room.phase) && (
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
                          {room.rulesVersion !== "2.4" && room.privateStates[item.targetId]?.currentRole ===
                            "police" && (
                            <p className="danger-text">
                              หากอนุมัติการโจมตีตำรวจ City Side จะชนะทันที
                            </p>
                          )}
                          <div className="evidence-actions">
                            {room.rulesVersion === "2.4" && room.v24?.actions?.find(a => a.status === "pending")?.evidence_id !== item.id && <p className="muted">รอ resolve เหตุการณ์ก่อนหน้าในคิว</p>}
                            <button
                              className="approve-action"
                              disabled={
                                busy ||
                                (room.rulesVersion === "2.4" && room.v24?.actions?.find(a => a.status === "pending")?.evidence_id !== item.id) ||
                                !["active", "resolution"].includes(room.phase) ||
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
          <section className="panel" data-host-section="events">
            <div className="panel-heading"><h2>บันทึกเหตุการณ์</h2><Clock3 size={16} className="muted" /></div>
            <Events room />
            <AttackActivityPanel room={room} />
          </section>
        </section>
        {room.phase === "lobby" && tab === "home" && <aside className="host-lobby-roster"><LobbyPlayers room={room} onRemove={(player) => setConfirmation({
          title: "นำผู้เล่นออกจากห้อง",
          detail: `นำ ${player.name} ออกจากห้องรอ? รูปโปรไฟล์ที่เลือกจะว่างทันที`,
          action: () => act(() => removeLobbyPlayer(room.code, player.id)),
        })} /></aside>}
      </div>
      <ErrorBanner error={error} />
      {busy && (
        <div className="toast" role="status">
          กำลังดำเนินการ…
        </div>
      )}
      {notice && <div className="toast" role="status"><Bell size={16} /> {notice}</div>}
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
  const [room, refresh, run, setRoom, initialLoadComplete, stale] = useRoom(code);
  usePoliceCheckReminder(code, room?.policeCheckAt, false);
  const [tab, setTab] = useState("home");
  const [showRules, setShowRules] = useState(false);
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
  const reporterAliveCount = room?.players.filter(
    (player) => player.health !== "dead",
  ).length;
  const reporterCutoffReached = Boolean(
    room?.rulesVersion === "2.4" &&
      room.v24?.cutoffAt &&
      now >= Date.parse(room.v24.cutoffAt),
  );
  const [toast, setToast] = useState("");
  useRoomNotifications(code, setToast, refresh);
  const [mounted, setMounted] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [screenHidden, setScreenHidden] = useState<boolean | null>(null);
  const privateViewSnapshot = useRef<PrivateViewSnapshot | null>(null);
  const remembered = readRoomCredentials(`player:${code}`);
  const [loginName, setLoginName] = useState(name || remembered?.name || "");
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
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [removedFromLobby, setRemovedFromLobby] = useState(false);
  const wasMemberRef = useRef(false);
  useEffect(() => {
    if (room?.viewerRole === "player") wasMemberRef.current = true;
    if (initialLoadComplete && !room && wasMemberRef.current) {
      setRemovedFromLobby(true);
      clearActiveRoom();
      forgetRoomCredentials(`player:${code}`);
    }
  }, [room, initialLoadComplete, code]);
  const join = async (event?: React.FormEvent) => {
    event?.preventDefault();
    setJoining(true);
    try {
      const joined = await joinOrCreateDemo(code, loginName);
      rememberRoomCredentials(`player:${code}`, {
        name: loginName,
      });
      rememberActiveRoom({
        role: "player",
        code,
        name: loginName,
      });
      setToast("กลับเข้าผู้เล่นเดิมสำเร็จ");
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
    if (loginName && !removedFromLobby) void join();
  }, [code, removedFromLobby]);
  const currentRole = playerId
    ? room?.privateStates[playerId]?.currentRole
    : undefined;
  const privacyPlayerId = playerId ?? room?.playerId;
  const privacyStorageKey =
    room && privacyPlayerId
      ? `killer_privacy:${room.code}:${room.createdAt}:${privacyPlayerId}`
      : "";
  const hideScreen = useCallback(() => {
    if (!privacyStorageKey) return;
    privateViewSnapshot.current = capturePrivateView();
    try {
      window.sessionStorage.setItem(privacyStorageKey, "1");
    } catch {
      // The overlay still protects the current view when storage is unavailable.
    }
    setScreenHidden(true);
  }, [privacyStorageKey]);
  const revealScreen = useCallback(async () => {
    await refresh();
    if (privacyStorageKey) {
      try {
        window.sessionStorage.removeItem(privacyStorageKey);
      } catch {
        // Continue revealing the current view if storage is unavailable.
      }
    }
    setScreenHidden(false);
  }, [privacyStorageKey, refresh]);
  useEffect(() => {
    if (!privacyStorageKey) return;
    let hidden = false;
    try {
      hidden = window.sessionStorage.getItem(privacyStorageKey) === "1";
    } catch {
      hidden = false;
    }
    setScreenHidden(hidden);
  }, [privacyStorageKey]);
  useEffect(() => {
    if (currentRole && currentRole !== ackRole) setRoleOpen(true);
  }, [currentRole]);
  useLayoutEffect(() => {
    // Never retain a confirmation callback from an earlier role or phase.
    setConfirmation(null);
  }, [currentRole, room?.phase, room?.createdAt,
    playerId ? room?.privateStates[playerId]?.hasUsedAbility : undefined,
    room?.players.find(player => player.id === playerId)?.health,
    room?.players.find(player => player.id === targetId)?.health,
    room?.players.find(player => player.id === reportTarget)?.health,
    reporterAliveCount,
    reporterCutoffReached]);
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
  if (removedFromLobby)
    return <main className="loading-screen"><UserMinus size={32} /><h1>คุณถูกนำออกจากห้องรอ</h1><p>หากต้องการเข้าร่วมอีกครั้ง ให้กลับไปเข้าห้องใหม่และเลือกรูปโปรไฟล์ใหม่</p><a className="secondary-action" href="/">กลับหน้าแรก</a></main>;
  if (privacyPlayerId && screenHidden === null)
    return (
      <main className="loading-screen">
        <Hourglass /> กำลังเตรียมพื้นที่ส่วนตัว...
      </main>
    );
  const protect = (content: ReactNode) => (
    <PrivacyBoundary hidden={screenHidden === true} snapshot={privateViewSnapshot.current} onReveal={revealScreen}>
      {content}
    </PrivacyBoundary>
  );
  if (room?.phase === "ended" && room.viewerRole === "player")
    return protect(
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
              ใช้รหัสห้องและชื่อผู้เล่นเพื่อเข้าร่วม
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
    return protect(
      <main className="loading-screen">
        <DoorOpen size={32} />
        <h1>ห้องถูกปิดแล้ว</h1>
        <p>Host ปิดห้องนี้แล้ว</p>
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
  const me = room.privateStates[playerId];
  const mine = room.players.find((player) => player.id === playerId);
  if (!me) {
    return protect(
      <>
        <Waiting room={room} playerId={playerId ?? room.playerId} onLeave={() => setIsLeaveModalOpen(true)} onChooseAvatar={() => setAvatarPickerOpen(true)} />
        {avatarPickerOpen && playerId && <AvatarPicker room={room} playerId={playerId} busy={busy} onClose={() => setAvatarPickerOpen(false)} onSelect={(avatarId) => {
          act(() => selectAvatar(room.code, avatarId));
          setAvatarPickerOpen(false);
        }} />}
        <LeaveConfirmModal
          expectedName={loginName}
          isOpen={isLeaveModalOpen}
          onClose={() => setIsLeaveModalOpen(false)}
          onConfirm={handleConfirmLeave}
          onHideScreen={hideScreen}
        />
      </>
    );
  }
  const isKiller = me.isActiveKiller;
  const v24SubmissionBlocked = room.rulesVersion === "2.4" && (
    room.killerEvidenceProgress.filter(item => item.killerId === playerId && item.status === "pending").length >= 2 ||
    (room.v24?.attacksUsed ?? 0) + room.killerEvidenceProgress.filter(item => item.status === "pending" && Date.parse(item.capturedAt) > now - 3600000).length >= 3
  );
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
  const reporterStatus = reporterAbilityStatus(room, playerId, now);
  const reporterAbilityWithRecheck = async () => {
    const current = await loadRoom(room.code);
    if (!current) throw new Error("reporter ability unavailable");
    setRoom(current);
    const status = reporterAbilityStatus(current, playerId);
    if (!status.available) {
      throw new Error(
        status.reason.includes("ครึ่งหนึ่ง")
          ? "reporter ability requires more than half of starting players alive"
          : "reporter ability unavailable",
      );
    }
    const target = current.players.find(
      (player) =>
        player.id === reportTarget &&
        player.id !== playerId &&
        player.health !== "dead",
    );
    if (!target) throw new Error("reporter ability unavailable");
    return reporterAbility(current.code, reportTarget);
  };
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
        !currentTarget
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
    if (!photo || !target || !capturedAt || submittingEvidence) return;
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
      setToast("ส่งแล้ว · รอ Host ตรวจหลักฐานการโจมตีผู้เล่น");
    } catch (e) {
      setError(errorMessage(e, "ส่งหลักฐานไม่สำเร็จ"));
    } finally {
      setSubmittingEvidence(false);
      void refresh();
    }
  };
  return protect(
    <main className={`app-shell player-app player-tab-${tab}`}>
      <Header
        code={room.code}
        label="พื้นที่ผู้เล่น"
        onLeave={() => setIsLeaveModalOpen(true)}
        onHideScreen={hideScreen}
      />
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
            <AttackActivityPanel room={room} />
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
              src={roleArtForPlayer(me.currentRole, playerId)}
              alt=""
              aria-hidden="true"
            />
            <span className="section-kicker">บัตรบทบาท · ลับเฉพาะคุณ</span>
            <h1>{ROLE_LABELS[me.currentRole]}</h1>
            <p>{room.rulesVersion === "2.4" ? V24_ROLE_DETAILS[me.currentRole] : ROLE_SUMMARIES[me.currentRole]}</p>
            <button className="text-button" onClick={() => setRoleOpen(true)}>
              <Eye size={15} /> อ่านบทบาทของฉัน
            </button>
            <div className="identity-stamp">
              {me.team === "killers" ? "Killer Side" : "City Side"}
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
          {room.rulesVersion !== "2.4" && me.currentRole === "police" &&
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
          {room.rulesVersion === "2.4" && <V24Panel room={room} act={act} busy={busy} />}
          {room.rulesVersion !== "2.4" && isKiller && (
            <div className="panel quota-panel">
              <span className="section-kicker">โควต้าคิลชั่วโมงนี้</span>
              <h2>
                ใช้คิลแล้ว {room.killsThisHour} / {room.killLimit} คน
              </h2>
              <p>ใช้ร่วมกับทีม Killer · ภาพที่ไม่ทำให้เป้าหมายตายยังอนุมัติได้</p>
              <div className="quota-meter">
                <span
                  style={{
                    width: `${Math.min(100, (room.killsThisHour / room.killLimit) * 100)}%`,
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
                น. เวลาไทย · นับเฉพาะคิล
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
          {room.rulesVersion !== "2.4" && isKiller && room.killsThisHour >= room.killLimit && (
            <div className="quota-cooldown-notice">
              <Clock3 size={24} />
              <div>
                <span className="section-kicker">โควต้าชั่วโมงนี้เต็มแล้ว</span>
                <strong>โควต้าคิลเต็มแล้ว</strong>
                <p>
                  ยังส่งหลักฐานและโจมตีที่ไม่ถึงตายได้ กรุณารอคิลถัดไปเมื่อขึ้นชั่วโมงใหม่ตามเวลาไทย
                </p>
              </div>
            </div>
          )}
          {isKiller && mine?.health !== "dead" && room.phase === "active" && (
            <div className="panel action-panel">
              <div className="panel-heading">
                <div>
                  <span className="section-kicker">ภารกิจของคุณ</span>
                  <h2>{photo ? "ตรวจภาพและส่ง" : target ? "ถ่ายภาพเป้าหมาย" : "เลือกเป้าหมาย"}</h2>
                </div>
                <span className="quota">
                  {room.rulesVersion === "2.4" ? `${room.v24?.attacksUsed ?? 0} / 3 attacks` : `${room.killsThisHour} / ${room.killLimit} คิล`}
                </span>
              </div>
              <ol className="mission-steps" aria-label="ขั้นตอนภารกิจ">
                {["เลือกเป้าหมาย", "ถ่ายภาพ", "ตรวจและส่ง"].map((label, index) => {
                  const step = photo ? 2 : target ? 1 : 0;
                  return <li key={label} aria-current={index === step ? "step" : undefined} className={index < step ? "complete" : ""}>
                    <span aria-hidden="true">{index < step ? "✓" : index + 1}</span>{label}
                  </li>;
                })}
              </ol>
              <select
                aria-label="เลือกเป้าหมาย"
                value={targetId}
                onChange={(e) => {
                  cameraTargetRef.current = null;
                  clearPhoto();
                  setTargetId(e.target.value);
                }}
                disabled={submittingEvidence}
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
                  <PlayerAvatar avatarId={target.avatarId} />
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
              {v24SubmissionBlocked && <p role="status">ช่องส่งหลักฐานเต็ม · รอ Host ตรวจหลักฐานเดิม หรือรอ rolling quota คืนช่องว่าง</p>}
              <NativeCamera
                disabled={submittingEvidence || v24SubmissionBlocked || !target || tab !== "home"}
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
                    disabled={submittingEvidence}
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
                  v24SubmissionBlocked ||
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
          {room.rulesVersion !== "2.4" && me.currentRole === "police" &&
            mine?.health !== "dead" &&
            ["active", "police-check"].includes(room.phase) && (
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
                      detail: `คุณกำลังชี้ตัว ${target?.name} หากถูก City Side ชนะ หากผิด Killer Side ชนะ`,
                      action: () =>
                        act(() => resolvePoliceCheck(room.code, targetId)),
                    })
                  }
                >
                  ยืนยันการชี้ตัว <Shield size={16} />
                </button>
              </div>
            )}
          {me.currentRole === "reporter" && !me.hasUsedAbility && (
              <div className="panel action-panel">
                <Eye size={19} />
                <h2>ตรวจบทบาทเริ่มต้น</h2>
                <p className="muted">
                  ยังมีชีวิต {reporterStatus.aliveCount}/{reporterStatus.initialCount} คน · ต้องเหลืออย่างน้อย {reporterStatus.minimumAlive} คน
                </p>
                {!reporterStatus.available && (
                  <p>ใช้ความสามารถไม่ได้: {reporterStatus.reason}</p>
                )}
                <select
                  aria-label="เลือกผู้เล่นเพื่อตรวจบทบาท"
                  value={reportTarget}
                  onChange={(e) => setReportTarget(e.target.value)}
                  disabled={!reporterStatus.available || busy}
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
                  disabled={!reporterStatus.available || !validReportTarget || busy}
                  onClick={() =>
                    setConfirmation({
                      title: "ใช้ความสามารถนักข่าว",
                      detail: `ตรวจบทบาทเริ่มต้นของ ${room.players.find((p) => p.id === reportTarget)?.name} ได้ 1 ครั้งต่อเกม ใช้ได้เมื่อผู้เล่นที่ยังมีชีวิตเหลือมากกว่าครึ่งของจำนวนเริ่มต้น (ตอนนี้ ${reporterStatus.aliveCount}/${reporterStatus.initialCount} คน) และผลจะปรากฏในข่าวสารส่วนตัว`,
                      action: () =>
                        act(reporterAbilityWithRecheck),
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
                <button className="text-button" onClick={() => setTab("news")}>ดู Activity การโจมตี</button>
              </div>
            </div>
          )}
          <ErrorBanner error={error} />
          <div className="panel latest-news-panel">
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
      {showRules && <Rules rulesVersion={room.rulesVersion} phase={room.phase} finalVoteRules={room.v24?.finalVoteRules} onClose={() => setShowRules(false)} />}
      {roleOpen && room.phase !== "ended" && (
        <RoleReveal
          rulesVersion={room.rulesVersion}
          key={`${room.code}:${room.createdAt}:${playerId}`}
          revealStorageKey={`killer_role_revealed:${room.code}:${room.createdAt}:${playerId}`}
          role={me.currentRole}
          artVariantKey={playerId}
          hearts={me.hearts}
          maxHearts={me.maxHearts}
          previous={ackRole !== me.currentRole ? ackRole : undefined}
          revealImmediately={ackRole !== undefined}
          onClose={() => {
            setRoleOpen(false);
            setAckRole(me.currentRole);
          }}
          onHideScreen={hideScreen}
        />
      )}
      {confirmation && (
        <Dialog
          title={confirmation.title}
          onClose={() => setConfirmation(null)}
          onHideScreen={hideScreen}
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
        onHideScreen={hideScreen}
      />
    </main>
  );
}

function ArrowFallback() {
  return <span aria-hidden="true">→</span>;
}
