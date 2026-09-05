'use client';
/* The room credential bootstrap intentionally runs once per room code. */
/* eslint-disable react-hooks/exhaustive-deps */
/* eslint-disable @next/next/no-img-element */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import {
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
} from 'lucide-react';
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
} from '@/src/room-store';
import { getSupabaseBrowser } from '@/src/supabase-browser';
import {
  clearActiveRoom,
  forgetRoomCredentials,
  readRoomCredentials,
  rememberActiveRoom,
  rememberRoomCredentials,
} from '@/src/room-session';
import {
  DEFAULT_ROLE_COUNTS,
  ROLE_HEARTS,
  ROLE_LABELS,
  type PrivatePlayerState,
  type Role,
  type RoomState,
} from '@/src/types';
import { downloadEvidenceArchive } from '@/src/evidence-download';
import {
  getNotificationPermission,
  requestNotificationPermission,
  showGenericNotification,
  subscribeToWebPush,
  notifyRoomParticipants,
} from '@/src/notifications';

import { LiveCamera } from './live-camera';
import { KillerProgress } from './killer-progress';

let latestRoom: RoomState | null = null;
function useRoom(code: string) {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const replaceRoom = useCallback((next: RoomState | null) => {
    latestRoom = next;
    setRoom(next);
  }, []);
  const refresh = useCallback(
    () =>
      loadRoom(code)
        .then(replaceRoom)
        .catch(() => undefined),
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
        }
      } catch {
        // The screen can show a recovery state once the first request has completed.
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
        'postgres_changes',
        { event: '*', schema: 'public', table: 'room_signals' },
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
  return [room, refresh, run, replaceRoom, initialLoadComplete] as const;
}

function NotificationToggle({ code }: { code: string }) {
  const [permission, setPermission] = useState<string>('default');

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
    if (current === 'granted') {
      void setupWebPush();
    }
  }, [setupWebPush]);

  if (permission === 'unsupported') return null;

  const handleToggle = async () => {
    const next = await requestNotificationPermission();
    setPermission(next);
    if (next === 'granted') {
      void setupWebPush();
      void showGenericNotification('เปิดการแจ้งเตือนสำเร็จ');
    }
  };

  return (
    <button
      className={`topbar-btn ${permission === 'granted' ? '' : 'notice'}`}
      onClick={() => void handleToggle()}
      title={
        permission === 'granted'
          ? 'เปิดการแจ้งเตือนแล้ว (รองรับแม้ปิดจอหรือปัดแอป)'
          : 'กดเพื่อเปิดการแจ้งเตือนบนมือถือ'
      }
      type='button'
    >
      {permission === 'granted' ? <Bell size={15} /> : <BellOff size={15} />}
      <span className='notif-label'>
        {permission === 'granted' ? 'แจ้งเตือนเปิดแล้ว' : 'เปิดแจ้งเตือน'}
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
    <header className='topbar'>
      {onLeave ? (
        <button
          type='button'
          className='back-link'
          onClick={onLeave}
          title='ออกจากเกม'
          aria-label='ออกจากเกม'
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          <ChevronLeft size={17} />
        </button>
      ) : (
        <a className='back-link' href={back ? '/' : undefined}>
          {back ? <ChevronLeft size={17} /> : <Radio size={17} />}
        </a>
      )}
      <span className='topbar-title'>{label}</span>
      <div className='topbar-actions'>
        <NotificationToggle code={code} />
        {action}
        <span className='room-chip'>
          ROOM <b>{code}</b>
        </span>
      </div>
    </header>
  );
}
function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    const rpcError = error as {
      message: string;
      details?: unknown;
      hint?: unknown;
    };
    return [rpcError.message, rpcError.details, rpcError.hint]
      .filter(
        (part): part is string =>
          typeof part === 'string' && part.trim().length > 0,
      )
      .join(' — ');
  }
  return fallback;
}
function ErrorBanner({ error }: { error: string }) {
  return error ? (
    <div className='error-banner'>
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
  const [typedName, setTypedName] = useState('');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (typedName.trim() !== expectedName.trim()) {
      setError('ชื่อไม่ตรงกับชื่อในเกม กรุณาลองใหม่');
      return;
    }
    setError('');
    onConfirm();
  };

  return (
    <div
      role='dialog'
      aria-modal='true'
      aria-labelledby='leave-dialog-title'
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(4px)',
        padding: '20px',
      }}
    >
      <div
        className='panel'
        style={{
          width: 'min(100%, 420px)',
          border: '1px solid var(--danger)',
          boxShadow: '0 10px 40px rgba(0, 0, 0, 0.6)',
        }}
      >
        <div className='panel-heading'>
          <div>
            <span className='section-kicker' style={{ color: 'var(--danger)' }}>
              LEAVE GAME
            </span>
            <h2 id='leave-dialog-title' style={{ margin: '4px 0 0' }}>
              ออกจากเกม
            </h2>
          </div>
          <DoorOpen size={24} style={{ color: 'var(--danger)' }} />
        </div>
        <p
          style={{
            fontSize: '13px',
            color: 'var(--muted)',
            margin: '0 0 16px',
            lineHeight: 1.5,
          }}
        >
          ต้องการออกจากเกมนี้หรือไม่? อุปกรณ์จะไม่กลับเข้าห้องนี้โดยอัตโนมัติอีก
          (พิมพ์ชื่อของคุณ <strong>&quot;{expectedName}&quot;</strong>{' '}
          เพื่อยืนยัน)
        </p>
        <form onSubmit={handleSubmit} style={{ display: 'grid', gap: '12px' }}>
          <label style={{ fontSize: '12px', display: 'grid', gap: '6px' }}>
            <span>ยืนยันชื่อในเกม</span>
            <input
              autoFocus
              required
              value={typedName}
              onChange={(e) => {
                setTypedName(e.target.value);
                if (error) setError('');
              }}
              placeholder={expectedName}
              style={{
                width: '100%',
                height: '42px',
                padding: '0 12px',
                border: '1px solid var(--line)',
                background: 'var(--panel-2)',
                color: 'var(--text)',
              }}
            />
          </label>
          {error && <ErrorBanner error={error} />}
          <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
            <button
              type='button'
              onClick={() => {
                setTypedName('');
                setError('');
                onClose();
              }}
              className='topbar-btn'
              style={{ flex: 1, height: '42px', justifyContent: 'center' }}
            >
              ยกเลิก
            </button>
            <button
              type='submit'
              className='topbar-btn danger'
              style={{
                flex: 1,
                height: '42px',
                justifyContent: 'center',
                background: 'var(--danger)',
                color: 'var(--ink)',
                fontWeight: 700,
                border: 'none',
              }}
            >
              ยืนยันออก
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
function Hearts({ count, max }: { count: number; max: number }) {
  return (
    <span className='hearts'>
      {Array.from({ length: max }, (_, index) => (
        <Heart
          key={index}
          size={15}
          fill={index < count ? 'currentColor' : 'none'}
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
  player: RoomState['players'][number];
  state?: PrivatePlayerState;
  host?: boolean;
}) {
  const visibleState = host && state;
  return (
    <div className={`player-card ${player.health === 'dead' ? 'is-dead' : ''}`}>
      <span className='avatar'>{player.name.slice(0, 1).toUpperCase()}</span>
      <div className='player-meta'>
        <strong>{player.name}</strong>
        <small>
          {visibleState
            ? ROLE_LABELS[state.currentRole]
            : player.health === 'dead'
              ? 'กำจัดแล้ว'
              : 'ผู้เล่น'}
        </small>
      </div>
      {visibleState ? (
        <Hearts count={state.hearts} max={state.maxHearts} />
      ) : (
        <span
          className={`status-pill ${player.isOnline ? 'online' : 'offline'}`}
        >
          {player.isOnline ? 'ONLINE' : 'OFFLINE'}
        </span>
      )}
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
  const resolvedRoom = typeof room === 'boolean' ? latestRoom : room;
  if (!resolvedRoom) return null;
  const visible = playerId
    ? resolvedRoom.events.filter(
        (event) => !event.playerId || event.playerId === playerId,
      )
    : resolvedRoom.events;
  return (
    <>
      {resolvedRoom.viewerRole === 'host' && resolvedRoom.phase === 'lobby' && (
        <LobbyPlayers room={resolvedRoom} />
      )}
      <div className='event-feed'>
        {visible.slice(0, 10).map((event) => (
          <div className={`event-row event-${event.type}`} key={event.id}>
            <span className='event-mark'>
              {event.type === 'warning' || event.type === 'bomb' ? (
                <AlertTriangle size={14} />
              ) : event.type === 'winner' ? (
                <Shield size={14} />
              ) : (
                <Radio size={14} />
              )}
            </span>
            <div>
              <p>{event.message}</p>
              <time>
                {new Date(event.createdAt).toLocaleTimeString('th-TH', {
                  hour: '2-digit',
                  minute: '2-digit',
                  timeZone: 'Asia/Bangkok',
                })}
              </time>
            </div>
          </div>
        ))}
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
  const resolvedRoom = typeof room === 'boolean' ? latestRoom : room;
  if (!resolvedRoom || resolvedRoom.phase !== 'ended') return null;
  return (
    <div
      className={`game-ended-notice outcome-${host ? 'winner' : winner ? 'winner' : 'loser'}`}
    >
      <Trophy size={30} />
      <div>
        <span className='section-kicker'>GAME OVER</span>
        <h2>
          {host
            ? 'เกมจบแล้ว'
            : winner === undefined
              ? 'เกมจบแล้ว'
              : winner
                ? 'คุณชนะ'
                : 'คุณแพ้'}
        </h2>
        <p>
          {resolvedRoom.winner === 'city'
            ? 'ฝ่ายเมืองชนะ'
            : resolvedRoom.winner === 'killers'
              ? 'ฝ่าย Killer ชนะ'
              : 'Host ได้ทำการจบเกม'}
        </p>
      </div>
    </div>
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
      className={waiting ? 'waiting-roster' : 'panel lobby-roster-panel'}
      aria-live='polite'
    >
      <div className='lobby-roster-heading'>
        <div>
          <span className='section-kicker'>PLAYERS IN ROOM</span>
          <h2>ผู้เล่นในห้อง</h2>
        </div>
        <strong>{room.players.length} คน</strong>
      </div>
      {room.players.length === 0 ? (
        <div className='empty-state'>
          <p>ยังไม่มีผู้เล่นเข้าห้อง</p>
        </div>
      ) : (
        <div className='players-grid'>
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
    <main className='lobby-waiting-screen'>
      {onLeave && (
        <div style={{ position: 'absolute', top: 16, left: 20, zIndex: 10 }}>
          <button
            type='button'
            className='back-link'
            onClick={onLeave}
            title='ออกจากเกม'
            aria-label='ออกจากเกม'
            style={{
              background: 'rgba(0,0,0,0.4)',
              border: '1px solid var(--line)',
              borderRadius: '6px',
              cursor: 'pointer',
              color: 'var(--acid)',
              display: 'grid',
              placeItems: 'center',
              width: 36,
              height: 36,
            }}
          >
            <ChevronLeft size={20} />
          </button>
        </div>
      )}
      <div className='waiting-grid' />
      <Skull className='waiting-skull' size={56} />
      <div className='waiting-copy'>
        <span className='section-kicker'>KILLER // ROOM {room.code}</span>
        <h1>KILLER</h1>
        <p>รอ Host แจกบทบาทอยู่...</p>
        <div className='waiting-status'>
          <span /> WAITING FOR HOST
        </div>
        <LobbyPlayers room={room} waiting />
      </div>
    </main>
  );
}

export function HostRoom({ code, name }: { code: string; name?: string }) {
  const router = useRouter();
  const [room, refresh, run, setRoom, initialLoadComplete] = useRoom(code);
  const [mounted, setMounted] = useState(false);
  const [error, setError] = useState('');
  const [leaving, setLeaving] = useState(false);
  const creationAttemptForCode = useRef<string | null>(null);
  const [counts, setCounts] = useState(DEFAULT_ROLE_COUNTS);
  const [bombSelection, setBombSelection] = useState<string[]>([]);
  const [accusationAt, setAccusationAtInput] = useState('');
  const hostCredentials = readRoomCredentials(`host:${code}`);
  const hostName = name || hostCredentials?.name || '';
  useEffect(() => {
    setMounted(true);
  }, []);
  useEffect(() => {
    if (mounted && initialLoadComplete && !room && !hostName && !leaving) {
      setError(
        'Host access is unavailable on this device. Return to the original Host browser.',
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
        rememberActiveRoom({ role: 'host', code, name: hostName });
      })
      .catch((e) => {
        const msg = errorMessage(e, 'เปิดห้องไม่ได้');
        setError(msg);
        if (
          msg.includes('closed') ||
          msg.includes('ไม่อยู่') ||
          msg.includes('ไม่พบ')
        ) {
          clearActiveRoom();
        }
      });
  }, [mounted, room, code, hostName, leaving, setRoom]);
  if (!mounted || !room)
    return (
      <main className='loading-screen'>
        <Hourglass /> {error || 'กำลังเชื่อมต่อห้อง...'}
      </main>
    );
  if (room.viewerRole !== 'host')
    return (
      <main className='loading-screen'>
        <Shield size={24} /> เฉพาะผู้สร้างห้องเท่านั้นที่เข้าถึงหน้าควบคุมได้
      </main>
    );
  const act = (operation: Promise<RoomState>) => {
    setError('');
    void run(operation)
      .catch((e) => setError(errorMessage(e, 'ดำเนินการไม่สำเร็จ')))
      .finally(() => {
        void refresh();
      });
  };
  const pending = room.evidences.filter(
    (evidence) => evidence.status === 'pending',
  );
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const adjust = (role: Role, delta: number) =>
    setCounts((current) => ({
      ...current,
      [role]: Math.max(
        role === 'killer' || role === 'police' ? 1 : 0,
        Math.min(role === 'villager' ? 20 : 1, current[role] + delta),
      ),
    }));
  const finish = async () => {
    if (!window.confirm('ดาวน์โหลด archive แล้วปิดห้องหรือไม่')) return;
    try {
      await downloadEvidenceArchive(room);
      setLeaving(true);
      clearActiveRoom();
      forgetRoomCredentials(`host:${room.code}`);
      await closeRoom(room.code);
      router.replace('/');
    } catch (e) {
      setError(errorMessage(e, 'ปิดห้องไม่สำเร็จ'));
    }
  };
  const leave = async () => {
    if (!window.confirm('ปิดห้องนี้หรือไม่')) return;
    setLeaving(true);
    clearActiveRoom();
    forgetRoomCredentials(`host:${room.code}`);
    await closeRoom(room.code);
    router.replace('/');
  };
  const endCurrentGame = () => {
    if (!window.confirm('ยืนยันการจบเกม? ผู้เล่นทุกคนจะเห็นว่าเกมจบแล้ว'))
      return;
    act(endGame(room.code));
  };
  return (
    <main className='app-shell'>
      <Header
        code={room.code}
        label='CONTROL ROOM'
        action={
          room.phase === 'ended' ? (
            <button className='topbar-btn danger' onClick={finish}>
              <Download size={15} /> archive และปิด
            </button>
          ) : (
            <>
              <button className='topbar-btn danger' onClick={endCurrentGame}>
                <Skull size={15} /> จบเกม
              </button>
              {room.phase === 'lobby' && (
                <button className='topbar-btn danger' onClick={leave}>
                  <DoorOpen size={15} /> ปิดห้อง
                </button>
              )}
            </>
          )
        }
      />
      <div className='host-layout'>
        <section className='main-column'>
          <div className='page-intro'>
            <div>
              <span className='section-kicker'>
                {room.phase === 'lobby' ? 'LOBBY / SETUP' : 'LIVE OPERATION'}
              </span>
              <h1>{room.phase === 'lobby' ? 'ตั้งค่าเกม' : 'ภาพรวมภารกิจ'}</h1>
            </div>
            <div className={`phase-badge phase-${room.phase}`}>
              <span />
              {room.phase}
            </div>
          </div>
          <Ended room={room} host />
          {room.phase === 'lobby' ? (
            <div className='panel setup-panel'>
              <div className='panel-heading'>
                <div>
                  <span className='section-kicker'>ROLE LOADOUT</span>
                  <h2>กำหนดบทบาท</h2>
                </div>
                <span className='count-total'>{total} คน</span>
              </div>
              <div className='role-grid'>
                {(Object.keys(DEFAULT_ROLE_COUNTS) as Role[]).map((role) => (
                  <div className='role-control' key={role}>
                    <div>
                      <strong>{ROLE_LABELS[role]}</strong>
                      <small>{ROLE_HEARTS[role] || 'ไม่มี'} หัวใจ</small>
                    </div>
                    <div className='stepper'>
                      <button onClick={() => adjust(role, -1)}>-</button>
                      <b>{counts[role]}</b>
                      <button onClick={() => adjust(role, 1)}>+</button>
                    </div>
                  </div>
                ))}
              </div>
              <button
                className='primary-action start-btn'
                disabled={room.players.length !== total}
                onClick={() => act(startGame(room.code, counts))}
              >
                เริ่มแจกบทบาท ({room.players.length}/{total}){' '}
                <Radio size={18} />
              </button>
            </div>
          ) : (
            <>
              <div className='metric-grid'>
                <div className='metric-card'>
                  <small>ผู้เล่น</small>
                  <strong>{room.players.length}</strong>
                  <span>คนในห้อง</span>
                </div>
                <div className='metric-card'>
                  <small>approved quota</small>
                  <strong>
                    {Math.max(0, room.attackLimit - room.attacksThisHour)}
                    <em>/{room.attackLimit}</em>
                  </strong>
                  <span>ภาพอนุมัติคงเหลือในชั่วโมง Bangkok</span>
                </div>
                <div className='metric-card'>
                  <small>หลักฐานรอตรวจ</small>
                  <strong className={pending.length ? 'amber-text' : ''}>
                    {pending.length}
                  </strong>
                  <span>คิวตรวจรูป</span>
                </div>
              </div>
              <div className='panel action-panel police-schedule-panel'>
                <div className='schedule-heading'>
                  <div className='schedule-icon'>
                    <Clock3 size={19} />
                  </div>
                  <div>
                    <span className='section-kicker'>POLICE SCHEDULE</span>
                    <h2>ตั้งเวลาตำรวจชี้ตัว</h2>
                    <p>กำหนดช่วงเวลาที่ตำรวจจะตรวจสอบและชี้ตัว Killer</p>
                  </div>
                </div>
                <label className='schedule-field'>
                  <span>วันและเวลา</span>
                  <div className='schedule-input-wrap'>
                    <Clock3 size={17} />
                    <input
                      aria-label='วันและเวลาตำรวจชี้ตัว'
                      type='datetime-local'
                      value={accusationAt}
                      onChange={(e) => setAccusationAtInput(e.target.value)}
                    />
                  </div>
                </label>
                <button
                  className='secondary-action schedule-save'
                  disabled={!accusationAt}
                  onClick={() =>
                    accusationAt &&
                    act(
                      setAccusationAt(
                        room.code,
                        new Date(accusationAt).toISOString(),
                      ),
                    )
                  }
                >
                  {room.policeCheckAt
                    ? 'อัปเดตเวลานัดหมาย'
                    : 'บันทึกเวลานัดหมาย'}
                  <Clock3 size={16} />
                </button>
                {room.policeCheckAt && (
                  <div className='schedule-status'>
                    <span className='schedule-status-dot' />
                    <div>
                      <small>กำหนดไว้แล้ว</small>
                      <strong>
                        {new Date(room.policeCheckAt).toLocaleString('th-TH', {
                          timeZone: 'Asia/Bangkok',
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        })}
                      </strong>
                    </div>
                    <span className='schedule-status-label'>รอตรวจ</span>
                  </div>
                )}
              </div>
              {room.phase === 'bomb-resolution' && (
                <div className='panel bomb-panel'>
                  <div className='panel-heading'>
                    <div>
                      <span className='section-kicker danger-kicker'>
                        BOMB PROTOCOL
                      </span>
                      <h2>เลือกผู้เล่นใกล้ Bomber 0–2 คน</h2>
                    </div>
                    <Skull />
                  </div>
                  <div className='bomb-grid'>
                    {room.players
                      .filter((player) => player.health !== 'dead')
                      .map((player) => (
                        <button
                          className={
                            bombSelection.includes(player.id) ? 'selected' : ''
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
                          <span className='avatar'>
                            {player.name.slice(0, 1)}
                          </span>
                          {player.name}
                          <Check size={16} />
                        </button>
                      ))}
                  </div>
                  <button
                    className='danger-action'
                    onClick={() => act(resolveBomb(room.code, bombSelection))}
                  >
                    ดำเนินการระเบิด <Skull size={16} />
                  </button>
                </div>
              )}
              <div className='panel'>
                <div className='panel-heading'>
                  <div>
                    <span className='section-kicker'>EVIDENCE QUEUE</span>
                    <h2>คิวตรวจรูปโจมตี</h2>
                  </div>
                  <span className='queue-count'>{pending.length} PENDING</span>
                </div>
                {pending.length === 0 ? (
                  <div className='empty-state'>
                    <Camera size={25} />
                    <p>ยังไม่มีหลักฐานรอตรวจ</p>
                  </div>
                ) : (
                  <div className='evidence-grid'>
                    {pending.map((item) => (
                      <div className='evidence-card' key={item.id}>
                        {item.imageData && (
                          <img src={item.imageData} alt='หลักฐานการโจมตี' />
                        )}
                        <div className='evidence-info'>
                          <div>
                            <strong>
                              {
                                room.players.find((p) => p.id === item.killerId)
                                  ?.name
                              }
                            </strong>
                            <small>
                              เป้าหมาย:{' '}
                              {
                                room.players.find((p) => p.id === item.targetId)
                                  ?.name
                              }
                            </small>
                          </div>
                          <div className='evidence-actions'>
                            <button
                              className='approve-action'
                              onClick={() =>
                                act(approveEvidence(room.code, item.id))
                              }
                            >
                              <Check size={17} /> อนุมัติ
                            </button>
                            <button
                              className='reject-action'
                              onClick={() =>
                                act(rejectEvidence(room.code, item.id))
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
              <div className='panel'>
                <div className='panel-heading'>
                  <h2>ผู้เล่นทั้งหมด</h2>
                  <span className='muted'>Host เท่านั้นที่เห็น role/heart</span>
                </div>
                <div className='players-grid'>
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
        <aside className='side-column'>
          <div className='panel room-info'>
            <span className='section-kicker'>ROOM ACCESS</span>
            <div className='big-code'>{room.code}</div>
            <p>แชร์รหัสห้องให้ผู้เล่น</p>
            <div className='online-line'>
              <span /> <b>{room.players.length}</b> คนในห้อง
            </div>
          </div>
          <div className='panel'>
            <div className='panel-heading'>
              <h2>บันทึกเหตุการณ์</h2>
              <Clock3 size={16} className='muted' />
            </div>
            <Events room />
          </div>
        </aside>
      </div>
      <ErrorBanner error={error} />
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
  const [room, refresh, run, setRoom] = useRoom(code);
  const [mounted, setMounted] = useState(false);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const remembered = readRoomCredentials(`player:${code}`);
  const [loginName, setLoginName] = useState(name || remembered?.name || '');
  const [reclaimToken, setReclaimToken] = useState(
    remembered?.reclaimToken || '',
  );
  const [targetId, setTargetId] = useState('');
  const [reportTarget, setReportTarget] = useState('');
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const [capturedAt, setCapturedAt] = useState('');
  const [submittingEvidence, setSubmittingEvidence] = useState(false);
  const [error, setError] = useState('');
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
        role: 'player',
        code,
        name: loginName,
      });
      setReclaimToken(token);
      if (joined.reclaimToken)
        window.alert(
          `บันทึกรหัสกู้คืนนี้ไว้สำหรับเปลี่ยนอุปกรณ์: ${joined.reclaimToken}`,
        );
      setPlayerId(joined.playerId);
      setRoom(joined.room);
    } catch (e) {
      const msg = errorMessage(e, 'เข้าห้องไม่ได้');
      setError(msg);
      if (
        msg.includes('closed') ||
        msg.includes('ไม่อยู่') ||
        msg.includes('ไม่พบ')
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
    router.replace('/');
  };
  useEffect(() => {
    if (loginName) void join();
  }, [code]);
  useEffect(() => {
    if (room?.phase === 'ended') {
      const timer = window.setTimeout(() => router.replace('/'), 5000);
      return () => window.clearTimeout(timer);
    }
  }, [room, router]);
  useEffect(() => {
    if (!playerId) return;
    void heartbeat(code);
    const timer = window.setInterval(() => {
      void heartbeat(code);
    }, 30000);
    return () => window.clearInterval(timer);
  }, [code, playerId]);
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
      <main className='loading-screen'>
        <Hourglass /> กำลังเชื่อมต่อห้อง...
      </main>
    );
  if (!name || (!playerId && !room && !joining))
    return (
      <main className='landing-shell'>
        <section className='access-panel'>
          <div className='access-heading'>
            <span>ROOM ACCESS</span>
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
                    e.target.value.replace(/[^a-f0-9]/gi, '').slice(0, 32),
                  )
                }
                autoCapitalize='off'
              />
            </label>
            <button className='primary-action' disabled={joining}>
              เข้าห้อง <ArrowFallback />
            </button>
          </form>
          <ErrorBanner error={error} />
        </section>
      </main>
    );
  if (!room || !playerId)
    return (
      <main className='loading-screen'>
        <Hourglass /> {error || 'กำลังเชื่อมต่อห้อง...'}
      </main>
    );
  const me = room.privateStates[playerId];
  const mine = room.players.find((player) => player.id === playerId);
  if (!me) {
    return (
      <>
        <Waiting room={room} onLeave={() => setIsLeaveModalOpen(true)} />
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
    room.phase === 'active' &&
    room.attacksThisHour >= room.attackLimit;
  const act = (operation: Promise<RoomState>) => {
    setError('');
    operation
      .then((next) => {
        setRoom(next);
        void refresh();
      })
      .catch((e) => setError(errorMessage(e, 'ดำเนินการไม่สำเร็จ')))
      .finally(() => {
        void refresh();
      });
  };
  const target = room.players.find(
    (player) =>
      player.id === targetId &&
      player.id !== playerId &&
      player.health !== 'dead' &&
      !room.privateStates[player.id]?.isActiveKiller,
  );
  const validReportTarget = room.players.some(
    (player) =>
      player.id === reportTarget &&
      player.id !== playerId &&
      player.health !== 'dead',
  );
  const clearPhoto = () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhoto(null);
    setPhotoPreview('');
    setCapturedAt('');
  };
  const sendEvidence = async () => {
    if (!photo || !targetId || !capturedAt || submittingEvidence) return;
    setError('');
    setSubmittingEvidence(true);
    try {
      const next = await submitEvidence(room.code, targetId, photo, capturedAt);
      setRoom(next);
      void refresh();
      clearPhoto();
    } catch (e) {
      setError(errorMessage(e, 'ส่งหลักฐานไม่สำเร็จ'));
    } finally {
      setSubmittingEvidence(false);
      void refresh();
    }
  };
  const winner = room.winner
    ? (room.winner === 'killers') === isKiller
    : undefined;
  return (
    <main className='app-shell player-app'>
      <Header
        code={room.code}
        label='FIELD DEVICE'
        onLeave={() => setIsLeaveModalOpen(true)}
      />
      <div className='player-layout'>
        <section className='main-column'>
          <div className='player-hero'>
            <span className='section-kicker'>IDENTITY CONFIRMED</span>
            <h1>{ROLE_LABELS[me.currentRole]}</h1>
            <p>
              {isKiller
                ? 'คุณอยู่ฝ่ายลับ เลือกเป้าหมายและส่งภาพให้ Host'
                : 'บทบาทของคุณเป็นความลับ'}
            </p>
            <div className='identity-stamp'>
              {me.team === 'killers' ? 'KILLER SIDE' : 'CITY SIDE'}
            </div>
          </div>
          <Ended room winner={winner} />
          {isKiller && <KillerProgress room={room} playerId={playerId} />}
          {!isKiller && (
            <div className='personal-health panel'>
              <div>
                <span className='section-kicker'>YOUR HEARTS</span>
                <h2>
                  {me.hearts} <small>/ {me.maxHearts}</small>
                </h2>
              </div>
              <Hearts count={me.hearts} max={me.maxHearts} />
            </div>
          )}
          {quotaExhausted && (
            <div className='quota-cooldown-notice'>
              <Clock3 size={24} />
              <div>
                <span className='section-kicker'>APPROVED QUOTA LOCKED</span>
                <strong>โควต้าภาพอนุมัติเต็มแล้ว</strong>
                <p>
                  ยังส่งรูปเข้าคิวได้ Host
                  จะอนุมัติได้เมื่อขึ้นชั่วโมงใหม่ตามเวลา Bangkok
                </p>
              </div>
            </div>
          )}
          {isKiller && mine?.health !== 'dead' && room.phase === 'active' && (
            <div className='panel action-panel'>
              <div className='panel-heading'>
                <div>
                  <span className='section-kicker'>ATTACK CONSOLE</span>
                  <h2>เลือกเป้าหมาย</h2>
                </div>
                <span className='quota'>
                  {Math.max(0, room.attackLimit - room.attacksThisHour)} SHOTS
                  LEFT
                </span>
              </div>
              <select
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                disabled={submittingEvidence}
              >
                <option value=''>เลือกผู้เล่น...</option>
                {room.players
                  .filter(
                    (player) =>
                      player.id !== playerId &&
                      player.health !== 'dead' &&
                      !room.privateStates[player.id]?.isActiveKiller,
                  )
                  .map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.name}
                    </option>
                  ))}
              </select>
              {target && (
                <div className='target-confirm'>
                  <span className='avatar'>{target.name.slice(0, 1)}</span>
                  <div>
                    <strong>{target.name}</strong>
                    <small>ผลลัพธ์จะแสดงหลัง Host อนุมัติ</small>
                  </div>
                  <Eye size={17} />
                </div>
              )}
              <div className='camera-drop'>
                <Camera size={24} />
                <span>
                  ถ่ายรูปและส่งภายใน 2 นาที
                  <small>รูปที่ส่งแล้วรอ Host ตรวจได้</small>
                </span>
              </div>
              <LiveCamera
                disabled={submittingEvidence}
                onCapture={(blob, time) => {
                  clearPhoto();
                  setPhoto(blob);
                  setPhotoPreview(URL.createObjectURL(blob));
                  setCapturedAt(time);
                }}
              />
              {photoPreview && (
                <div className='evidence-preview'>
                  <img src={photoPreview} alt='ตัวอย่างหลักฐานก่อนส่ง' />
                  <button
                    type='button'
                    className='preview-remove'
                    disabled={submittingEvidence}
                    onClick={clearPhoto}
                    aria-label='ลบรูปและถ่ายใหม่'
                  >
                    <X size={18} />
                  </button>
                  <span>ตรวจสอบรูปแล้วกดส่ง หรือกดกากบาทเพื่อถ่ายใหม่</span>
                </div>
              )}
              <button
                className='primary-action'
                disabled={
                  !target || !photo || !capturedAt || submittingEvidence
                }
                onClick={sendEvidence}
              >
                {submittingEvidence
                  ? 'กำลังส่งหลักฐาน...'
                  : 'ส่งหลักฐานให้ Host'}{' '}
                <span>→</span>
              </button>
            </div>
          )}
          {me.currentRole === 'police' &&
            mine?.health !== 'dead' &&
            room.phase === 'police-check' && (
              <div className='panel action-panel'>
                <Shield size={19} />
                <h2>ชี้ตัว active Killer</h2>
                <select
                  value={targetId}
                  onChange={(e) => setTargetId(e.target.value)}
                >
                  <option value=''>เลือกผู้ต้องสงสัย...</option>
                  {room.players
                    .filter(
                      (player) =>
                        player.id !== playerId && player.health !== 'dead',
                    )
                    .map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.name}
                      </option>
                    ))}
                </select>
                <button
                  className='danger-action'
                  disabled={!targetId}
                  onClick={() => act(resolvePoliceCheck(room.code, targetId))}
                >
                  ยืนยันการชี้ตัว <Shield size={16} />
                </button>
              </div>
            )}
          {me.currentRole === 'reporter' &&
            !me.hasUsedAbility &&
            mine?.health !== 'dead' &&
            ['active', 'bomb-resolution', 'police-check'].includes(
              room.phase,
            ) && (
              <div className='panel action-panel'>
                <Eye size={19} />
                <h2>ตรวจ initial role</h2>
                <select
                  value={reportTarget}
                  onChange={(e) => setReportTarget(e.target.value)}
                >
                  <option value=''>เลือกผู้เล่น...</option>
                  {room.players
                    .filter(
                      (player) =>
                        player.id !== playerId && player.health !== 'dead',
                    )
                    .map((player) => (
                      <option key={player.id} value={player.id}>
                        {player.name}
                      </option>
                    ))}
                </select>
                <button
                  className='secondary-action'
                  disabled={!validReportTarget}
                  onClick={() => act(reporterAbility(room.code, reportTarget))}
                >
                  ใช้ความสามารถ <Eye size={16} />
                </button>
              </div>
            )}
          {mine?.health === 'dead' && (
            <div className='dead-card'>
              <Skull size={27} />
              <div>
                <strong>คุณถูกกำจัดแล้ว</strong>
                <p>รับชมเกมต่อได้ แต่ใช้ความสามารถไม่ได้</p>
              </div>
            </div>
          )}
          <ErrorBanner error={error} />
          <div className='panel'>
            <div className='panel-heading'>
              <h2>ข่าวล่าสุด</h2>
            </div>
            <Events room playerId={playerId} />
          </div>
        </section>
        <aside className='side-column'>
          <div className='panel privacy-note'>
            <Shield size={19} />
            <strong>ข้อมูลส่วนตัว</strong>
            <p>
              คุณเห็นเฉพาะ role และหัวใจของคุณเอง ระบบ projection
              ป้องกันข้อมูลคนอื่น
            </p>
          </div>
        </aside>
      </div>
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
  return <span aria-hidden='true'>→</span>;
}
