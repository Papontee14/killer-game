"use client";
import Image from "next/image";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Home,
  Heart,
  LockKeyhole,
  Radio,
  Settings,
  Shield,
  Users,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import {
  ROLE_HEARTS,
  ROLE_LABELS,
  type Role,
  type RoomPhase,
} from "@/src/types";
import { ROLE_ART, roleArtAlt } from "@/src/role-art";
export const PHASE_LABELS: Record<RoomPhase, string> = {
  lobby: "ห้องรอ",
  active: "กำลังเล่น",
  "bomb-resolution": "จัดการระเบิด",
  "police-check": "ตำรวจชี้ตัว",
  ended: "จบเกม",
};
export const ROLE_DETAILS: Record<Role, string> = {
  killer:
    "เลือกเป้าหมาย ถ่ายภาพด้วยกล้องสด และส่งให้ Host ภายใน 2 นาที ทุกภาพที่อนุมัติลด 1 หัวใจ คุณไม่มีแถบหัวใจ แต่ตายได้จากระเบิด Bomber",
  "killer-wife":
    "เริ่มต้นฝ่ายเมือง มี 2 หัวใจ เมื่อถูกโจมตีที่อนุมัติครั้งที่สอง คุณจะเปลี่ยนเป็น Killer และใช้โควต้าร่วมกับทีม 3 ภาพต่อชั่วโมง การตายจากระเบิดไม่ทำให้เปลี่ยนบทบาท",
  police:
    "เมื่อถึงเวลาชี้ตัว เลือกผู้ต้องสงสัยที่ยังมีชีวิต 1 คน ชี้ถูก Killer คนใดก็ได้ฝ่ายเมืองชนะ ชี้ผิดฝ่าย Killer ชนะ",
  reporter:
    "ตรวจบทบาทเริ่มต้นของผู้เล่นอื่นที่ยังมีชีวิตได้ 1 ครั้งต่อเกม ผลเป็นความลับและไม่เปลี่ยนตามบทบาทปัจจุบันของเป้าหมาย",
  bomber:
    "เมื่อตาย Host จะเลือกผู้เล่นที่อยู่ใกล้คุณ 0–2 คน ผู้ถูกระเบิดตายทันทีโดยไม่ขึ้นกับหัวใจ ไม่มีระเบิดต่อเนื่อง",
  detective:
    "เมื่อตำรวจตาย หากคุณยังมีชีวิต คุณจะรับตำแหน่งตำรวจเป็นการส่วนตัว เก็บตัวตนของคุณเป็นความลับ",
  athlete:
    "คุณมี 3 หัวใจ อยู่ฝ่ายเมือง สังเกตสิ่งรอบตัวและช่วยฝ่ายเมืองหาตัว Killer",
  sumo: "คุณมี 4 หัวใจ อยู่ฝ่ายเมือง ระวังตัวและสังเกตผู้ต้องสงสัยรอบตัวคุณ",
  villager:
    "คุณมี 2 หัวใจ อยู่ฝ่ายเมือง รักษาตัวให้รอดและช่วยกันสังเกตว่าใครคือ Killer",
};
const RULE_ROLES = Object.keys(ROLE_LABELS) as Role[];
export function Brand({ small = false }: { small?: boolean }) {
  return <span className={`killer-logo ${small ? "small" : ""}`}>KILLER</span>;
}
export function Dialog({
  title,
  children,
  onClose,
  dismissible = true,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  dismissible?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const node = ref.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`game-dialog ${className}`}
      aria-labelledby={id}
      onCancel={(event) => {
        if (!dismissible) {
          event.preventDefault();
          return;
        }
        onClose();
      }}
      onClick={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-heading">
        <h2 id={id}>{title}</h2>
        {dismissible && (
          <button className="icon-button" aria-label="ปิด" onClick={onClose}>
            <X size={20} />
          </button>
        )}
      </div>
      {children}
    </dialog>
  );
}
export function Rules({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="วิธีเล่น KILLER" onClose={onClose}>
      <p className="muted">
        บทบาทของคุณเป็นความลับ เกมเกิดขึ้นรอบตัวคุณในชีวิตจริง
      </p>
      <div className="rules-steps">
        <p>
          <b>01 · เข้าห้อง</b>ใช้รหัส 6 ตัวจาก Host
          และบันทึกรหัสกู้คืนเพื่อกลับเป็นตัวละครเดิม
        </p>
        <p>
          <b>02 · รับบทบาท</b>Host แจกบทบาทเมื่อทุกคนพร้อม
          อ่านภารกิจส่วนตัวก่อนเริ่มเล่น
        </p>
        <p>
          <b>03 · สังเกตและเอาตัวรอด</b>Killer ส่งภาพจากกล้องสดให้ Host ตรวจ
          โควต้าเริ่มต้น 2 ภาพอนุมัติต่อชั่วโมง รีเซ็ตตรงต้นชั่วโมงเวลาไทย
          ภาพรอตรวจไม่ใช้โควต้า และไม่มีเวลารอต่อเป้าหมาย
        </p>
        <p>
          <b>04 · ถึงเวลาตัดสิน</b>ตำรวจชี้ถูก ฝ่ายเมืองชนะ ชี้ผิด ฝ่าย Killer
          ชนะ หาก Killer ทุกคนตายจากระเบิด ฝ่ายเมืองชนะ แม้ตำรวจตายพร้อมกัน
          หากตำรวจตายและไม่มีนักสืบรับตำแหน่ง ฝ่าย Killer ชนะ
        </p>
      </div>
      <h3>9 บทบาท · ทุกคนมีความลับ</h3>
      <RoleCarousel />
      <p className="privacy-caption">
        <LockKeyhole size={16} />{" "}
        การปิดเว็บหรือหลุดจากเครือข่ายไม่ทำให้ตัวละครตาย
      </p>
    </Dialog>
  );
}

function RoleCarousel() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateIndex = () => {
      const slides = Array.from(
        viewport.querySelectorAll<HTMLElement>("[data-role-slide]"),
      );
      if (!slides.length) return;
      const center = viewport.scrollLeft + viewport.clientWidth / 2;
      const nextIndex = slides.reduce(
        (closest, slide, index) =>
          Math.abs(slide.offsetLeft + slide.offsetWidth / 2 - center) <
          Math.abs(
            slides[closest].offsetLeft + slides[closest].offsetWidth / 2 - center,
          )
            ? index
            : closest,
        0,
      );
      setActiveIndex(nextIndex);
    };
    viewport.addEventListener("scroll", updateIndex, { passive: true });
    window.addEventListener("resize", updateIndex);
    updateIndex();
    return () => {
      viewport.removeEventListener("scroll", updateIndex);
      window.removeEventListener("resize", updateIndex);
    };
  }, []);

  const moveTo = (index: number) => {
    const boundedIndex = Math.max(0, Math.min(index, RULE_ROLES.length - 1));
    const viewport = viewportRef.current;
    const slide = viewport?.querySelector<HTMLElement>(
      `[data-role-slide="${boundedIndex}"]`,
    );
    if (viewport && slide) {
      const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      viewport.scrollTo({
        left: slide.offsetLeft,
        behavior: reduceMotion ? "auto" : "smooth",
      });
    }
    setActiveIndex(boundedIndex);
  };

  return (
    <div className="role-carousel" aria-label="บทบาททั้งหมด">
      <div
        ref={viewportRef}
        className="role-carousel-viewport"
        role="region"
        aria-roledescription="carousel"
        aria-label="สไลด์บทบาท"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            moveTo(activeIndex - 1);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            moveTo(activeIndex + 1);
          }
        }}
      >
        {RULE_ROLES.map((role, index) => (
          <article
            key={role}
            data-role-slide={index}
            className="role-carousel-slide"
            role="group"
            aria-roledescription="สไลด์"
            aria-label={`${index + 1} จาก ${RULE_ROLES.length}`}
          >
            <Image
              className="role-thumb role-thumb-rules role-carousel-art"
              src={ROLE_ART[role]}
              width={2048}
              height={2048}
              sizes="(max-width: 520px) calc(100vw - 64px), 420px"
              alt={roleArtAlt(role)}
            />
            <div className="role-carousel-heading">
              <div>
                <span className="role-carousel-kicker">
                  <Shield size={16} /> บทบาทที่ {index + 1}
                </span>
                <h4>{ROLE_LABELS[role]}</h4>
              </div>
              {ROLE_HEARTS[role] ? (
                <span
                  className="role-carousel-hearts"
                  aria-label={`${ROLE_HEARTS[role]} หัวใจ`}
                >
                  <Heart
                    className="role-carousel-heart-icon"
                    size={16}
                    fill="currentColor"
                    aria-hidden="true"
                  />
                  <span aria-hidden="true">× {ROLE_HEARTS[role]}</span>
                </span>
              ) : (
                <span className="role-carousel-hearts role-carousel-hearts-none">
                  ไม่มีแถบหัวใจ
                </span>
              )}
            </div>
            <p>{ROLE_DETAILS[role]}</p>
          </article>
        ))}
      </div>
      <div className="role-carousel-controls">
        <button
          className="icon-button"
          type="button"
          aria-label="บทบาทก่อนหน้า"
          onClick={() => moveTo(activeIndex - 1)}
          disabled={activeIndex === 0}
        >
          <ChevronLeft size={18} />
        </button>
        <div className="role-carousel-dots" aria-label="เลือกบทบาท">
          {RULE_ROLES.map((role, index) => (
            <button
              key={role}
              type="button"
              className={index === activeIndex ? "active" : ""}
              aria-label={`ไปที่ ${ROLE_LABELS[role]}`}
              aria-current={index === activeIndex ? "true" : undefined}
              onClick={() => moveTo(index)}
            />
          ))}
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="บทบาทถัดไป"
          onClick={() => moveTo(activeIndex + 1)}
          disabled={activeIndex === RULE_ROLES.length - 1}
        >
          <ChevronRight size={18} />
        </button>
      </div>
      <p className="role-carousel-position" aria-live="polite">
        {activeIndex + 1} / {RULE_ROLES.length}
      </p>
    </div>
  );
}
export function GameNavigation({
  host = false,
  active,
  onChange,
  pending = 0,
}: {
  host?: boolean;
  active: string;
  onChange: (value: string) => void;
  pending?: number;
}) {
  const tabs = host
    ? ([
        ["home", "ภาพรวม", Home],
        ["evidence", "ตรวจหลักฐาน", ClipboardCheck],
        ["players", "ผู้เล่น", Users],
        ["events", "เหตุการณ์", Radio],
        ["settings", "ตั้งค่าห้อง", Settings],
      ] as const)
    : ([
        ["home", "หน้าหลัก", Home],
        ["players", "ผู้เล่น", Users],
        ["news", "ข่าวสาร", Radio],
        ["more", "เพิ่มเติม", Settings],
      ] as const);
  return (
    <nav
      className={host ? "game-nav host-nav" : "game-nav player-nav"}
      aria-label={host ? "เมนู Host" : "เมนูผู้เล่น"}
    >
      {host && (
        <div className="nav-brand">
          <Brand small />
          <span>ศูนย์ควบคุมเกม</span>
        </div>
      )}
      {tabs.map(([key, label, Icon]) => (
        <button
          key={key}
          aria-current={active === key ? "page" : undefined}
          className={active === key ? "active" : ""}
          onClick={() => onChange(key)}
        >
          <Icon size={20} />
          <span>{label}</span>
          {key === "evidence" && pending > 0 && <b>{pending}</b>}
        </button>
      ))}
      {host && (
        <div className="nav-foot">
          <LockKeyhole size={16} /> พื้นที่ส่วนตัวสำหรับ Host
        </div>
      )}
    </nav>
  );
}
export function ConnectionStatus() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return (
    <div
      className={`connection-status ${online ? "" : "disconnected"}`}
      role="status"
    >
      {online ? <Wifi size={14} /> : <WifiOff size={16} />}
      {online
        ? "เชื่อมต่อเครือข่ายแล้ว"
        : "เครือข่ายหลุด · ข้อมูลอาจยังไม่อัปเดต กำลังรอเชื่อมต่อกลับ"}
    </div>
  );
}
export function RecoveryCard({
  token,
  onClose,
}: {
  token: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <Dialog title="เก็บรหัสนี้ไว้ให้ดี" onClose={onClose}>
      <div className="recovery-icon">
        <LockKeyhole size={32} />
      </div>
      <p>
        ใช้รหัสนี้พร้อมรหัสห้องและชื่อเดิม เพื่อกลับเป็นตัวละครเดิมบนอุปกรณ์ใหม่
        เก็บไว้เป็นความลับ
      </p>
      <code className="recovery-code">{token}</code>
      <button
        className="secondary-action"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(token);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? (
          <>
            <Check size={17} /> คัดลอกแล้ว
          </>
        ) : (
          "คัดลอกรหัสกู้คืน"
        )}
      </button>
      <button className="primary-action" onClick={onClose}>
        บันทึกรหัสแล้ว <ChevronRight size={18} />
      </button>
    </Dialog>
  );
}
function MysteryCardBack() {
  return (
    <span className="mystery-card-back" aria-hidden="true">
      <svg viewBox="0 0 300 400" fill="none" className="mystery-card-engraving">
        <rect x="13" y="13" width="274" height="374" rx="15" />
        <rect x="21" y="21" width="258" height="358" rx="10" />
        {Array.from({ length: 12 }, (_, i) => (
          <ellipse key={i} cx="150" cy="200" rx={68 + i * 4} ry={110 + i * 5}
            transform={`rotate(${i * 15} 150 200)`} opacity=".24" />
        ))}
        {[0, 180].map((angle) => (
          <g key={angle} transform={`rotate(${angle} 150 200)`}>
            <path d="M32 90V32h58M39 72V39h33M210 32h58v58M228 39h33v33M110 48l40 22 40-22-40-16zM150 70v30" />
            <path d="M42 108l9 9-9 9-9-9zM258 108l9 9-9 9-9-9z" />
          </g>
        ))}
        <circle cx="150" cy="200" r="58" className="mystery-card-seal" />
        <circle cx="150" cy="200" r="51" />
        <path d="M150 131l7 9-7 9-7-9zM150 251l7 9-7 9-7-9z" />
      </svg>
      <span className="mystery-card-brand">KILLER</span>
      <span className="mystery-card-question">?</span>
      <span className="mystery-card-caption">EVERYONE HAS A SECRET</span>
    </span>
  );
}

export function RoleReveal({
  role,
  previous,
  hearts,
  maxHearts,
  onClose,
  revealImmediately = false,
  revealStorageKey,
}: {
  role: Role;
  previous?: Role;
  hearts?: number;
  maxHearts?: number;
  onClose: () => void;
  revealImmediately?: boolean;
  revealStorageKey?: string;
}) {
  const [revealState, setRevealState] = useState<
    "waiting" | "spinning" | "revealed"
  >(() => {
    if (revealImmediately) return "revealed";
    try {
      if (revealStorageKey && window.localStorage.getItem(revealStorageKey) === "1") {
        return "revealed";
      }
    } catch {
      // The in-page acknowledgement still works when browser storage is blocked.
    }
    return "waiting";
  });
  const [loadedArt, setLoadedArt] = useState("");
  const [artError, setArtError] = useState(false);
  const [artAttempt, setArtAttempt] = useState(0);
  const roleArtReady = loadedArt === ROLE_ART[role];
  const imageRef = useRef<HTMLImageElement>(null);
  const isRevealed = revealState === "revealed";

  useEffect(() => {
    if (!isRevealed || !revealStorageKey) return;
    try {
      // Remember completion, not the tap: interrupted animations can be retried.
      // Persist only a flag, never the player's private role.
      window.localStorage.setItem(revealStorageKey, "1");
    } catch {
      // Storage may be unavailable in private browsing or full.
    }
  }, [isRevealed, revealStorageKey]);

  useEffect(() => {
    if (revealState !== "spinning") return;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const timer = window.setTimeout(
      () => setRevealState("revealed"),
      reduceMotion ? 240 : 2700,
    );
    return () => window.clearTimeout(timer);
  }, [revealState]);

  return (
    <Dialog
      title={previous ? "บทบาทของคุณเปลี่ยนแล้ว" : "บทบาทของคุณ"}
      onClose={onClose}
      dismissible={isRevealed}
      className="role-reveal-dialog"
    >
      <div
        className={`role-reveal role-reveal-${revealState}`}
      >
        <div className="role-reveal-card-scene">
          <div
            className={`role-reveal-card ${revealState === "spinning" ? "is-spinning" : ""}`}
            onAnimationEnd={(event) => {
              if (
                event.target === event.currentTarget &&
                ["role-card-reveal", "role-card-reduced"].includes(event.animationName) &&
                revealState === "spinning"
              ) {
                setRevealState("revealed");
              }
            }}
          >
            <span className="role-reveal-card-face role-reveal-card-question">
              <MysteryCardBack />
            </span>
            <div
              className="role-reveal-card-face role-reveal-card-role"
              aria-hidden={!isRevealed}
            >
              <div className={`role-card-identity ${role === "killer" ? "killer" : ""}`}>
              <Image
                key={`${role}-${artAttempt}`}
                ref={imageRef}
                className="role-reveal-art"
                src={ROLE_ART[role]}
                width={2048}
                height={2048}
                sizes="280px"
                priority
                alt=""
                onLoad={async (event) => {
                  const node = event.currentTarget;
                  try {
                    await node.decode();
                    if (imageRef.current === node) setLoadedArt(ROLE_ART[role]);
                  } catch {
                    if (imageRef.current === node) setArtError(true);
                  }
                }}
                onError={() => setArtError(true)}
              />
              <span className="section-kicker">
                <LockKeyhole size={14} /> เฉพาะคุณเท่านั้น
              </span>
              <h2>{ROLE_LABELS[role]}</h2>
              <span className="status-pill">
                {role === "killer" ? "ฝ่าย Killer" : "ฝ่ายเมือง"}
              </span>
              </div>
              <span className="role-card-secret-cover"><MysteryCardBack /></span>
            </div>
            {[0, 1, 2].map((edge) => (
              <span key={edge} className="role-card-edge" style={{ transform: `translateZ(${edge - 1}px)` }} aria-hidden="true" />
            ))}
          </div>
          {!isRevealed && (
            <button type="button" className="role-card-trigger"
              disabled={!roleArtReady || revealState === "spinning"}
              aria-label={!roleArtReady ? "กำลังเตรียมภาพบทบาท" : revealState === "waiting" ? "แตะเพื่อเปิดบทบาท" : "กำลังเปิดบทบาท"}
              onClick={() => {
                if (roleArtReady && revealState === "waiting") setRevealState("spinning");
              }} />
          )}
        </div>
        {!isRevealed && <p className="role-card-instruction" role="status">
          {artError ? "โหลดภาพไม่สำเร็จ กรุณาลองใหม่" : !roleArtReady ? "กำลังเตรียมภาพบทบาท…" : revealState === "spinning" ? "ความลับของคุณกำลังเปิดเผย…" : "แตะเพื่อเปิดบทบาท"}
        </p>}
        {artError && <button type="button" className="text-button" onClick={() => {
          setArtError(false);
          setArtAttempt((attempt) => attempt + 1);
        }}>ลองโหลดภาพอีกครั้ง</button>}
      </div>
      {isRevealed && previous && (
        <p className="muted">
          จาก {ROLE_LABELS[previous]} → {ROLE_LABELS[role]} ·
          เก็บตัวตนใหม่เป็นความลับ
        </p>
      )}
      {isRevealed && <p>{ROLE_DETAILS[role]}</p>}
      {isRevealed && role !== "killer" && (
        <div
          className="reveal-hearts"
          aria-label={`${hearts ?? ROLE_HEARTS[role]} หัวใจ`}
        >
          {Array.from({ length: maxHearts ?? ROLE_HEARTS[role] }, (_, i) => (
            <Heart
              key={i}
              size={24}
              fill={i < (hearts ?? ROLE_HEARTS[role]) ? "currentColor" : "none"}
            />
          ))}
        </div>
      )}
      {isRevealed && (
        <button className="primary-action" onClick={onClose}>
          เข้าใจแล้ว <Check size={18} />
        </button>
      )}
    </Dialog>
  );
}
