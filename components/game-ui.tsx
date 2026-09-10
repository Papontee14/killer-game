"use client";
import Image from "next/image";
import {
  LEGACY_GUIDE_PHASES,
  LEGACY_ROLE_GUIDE,
  V24_GUIDE_PHASES,
  V24_PREVIOUS_ROLE_GUIDE,
  V24_ROLE_DETAILS,
  V24_ROLE_GUIDE,
  type GuidePhase,
  type GuideRole,
} from "@/src/v24-rules";
import { Brand } from "./brand";
import { PixelIcon } from "./pixel-ui";
import { useEffect, useLayoutEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { usePrivacyHidden } from "./privacy-boundary";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  LockKeyhole,
  X,
} from "lucide-react";
import {
  ROLE_HEARTS,
  ROLE_LABELS,
  type Role,
  type RoomPhase,
} from "@/src/types";
import { ROLE_ART, roleArtAlt, roleArtForPlayer } from "@/src/role-art";
export const PHASE_LABELS: Record<RoomPhase, string> = {
  resolution: "Resolution",
  "final-discussion": "Final Discussion",
  "secret-vote": "โหวตลับ",
  lobby: "ห้องรอ",
  active: "กำลังเล่น",
  "bomb-resolution": "จัดการระเบิด",
  "police-check": "ตำรวจชี้ตัว",
  ended: "จบเกม",
};
export const ROLE_DETAILS: Record<Role, string> = {
  doctor: V24_ROLE_DETAILS.doctor,
  killer:
    "เลือกเป้าหมาย ถ่ายภาพด้วยกล้องสด และส่งให้ Host ภายใน 2 นาที ทุกภาพที่อนุมัติลด 1 หัวใจ คุณไม่มีแถบหัวใจ แต่ตายได้จากระเบิด Bomber",
  "killer-wife":
    "เริ่มต้นอยู่ Killer Side มี 1 หัวใจ เมื่อถูกโจมตีที่อนุมัติ คุณจะปลดพลังโจมตีได้ แต่ยังคงชื่อ Killer’s Wife ภาพนั้นไม่นับเป็นคิล การตายจากระเบิดไม่ทำให้ปลดพลัง",
  police:
    "ชี้ตัวผู้ต้องสงสัยที่ยังมีชีวิตได้ระหว่างเล่นหรือเมื่อถึงเวลานัดหมาย ชี้ถูก Killer ตั้งต้น City Side ชนะ ชี้ผิด Killer Side ชนะ หาก Killer โจมตีคุณและ Host อนุมัติ City Side ชนะทันที",
  reporter:
    "ตรวจบทบาทเริ่มต้นของผู้เล่นอื่นที่ยังมีชีวิตได้ 1 ครั้งต่อเกม ขณะผู้เล่นที่ยังมีชีวิตเหลือมากกว่าครึ่งของจำนวนเริ่มต้น ผลเป็นความลับและไม่เปลี่ยนตามบทบาทปัจจุบันของเป้าหมาย",
  bomber:
    "เมื่อตาย Host จะเลือกผู้เล่นที่อยู่ใกล้คุณ 0–2 คน ผู้ถูกระเบิดตายทันทีโดยไม่ขึ้นกับหัวใจ ไม่มีระเบิดต่อเนื่อง",
  detective:
    "เมื่อตำรวจตาย หากคุณยังมีชีวิต คุณจะรับตำแหน่งตำรวจเป็นการส่วนตัว เก็บตัวตนของคุณเป็นความลับ",
  athlete:
    "คุณมี 3 หัวใจ อยู่ City Side สังเกตสิ่งรอบตัวและช่วย City Side หาตัว Killer",
  sumo: "คุณมี 4 หัวใจ อยู่ City Side ระวังตัวและสังเกตผู้ต้องสงสัยรอบตัวคุณ",
  villager:
    "คุณมี 2 หัวใจ อยู่ City Side รักษาตัวให้รอดและช่วยกันสังเกตว่าใครคือ Killer",
};
export const ROLE_SUMMARIES: Record<Role, string> = {
  doctor: V24_ROLE_DETAILS.doctor,
  killer: "เลือกเป้าหมาย ถ่ายภาพด้วยกล้องสด และส่งให้ Host ตรวจภายใน 2 นาที",
  "killer-wife": "อยู่ Killer Side ตลอดทั้งเกม และเมื่อถูกโจมตีจะปลดพลังโจมตีโดยคงบทบาทเดิม",
  police: "ชี้ตัวผู้ต้องสงสัยที่ยังมีชีวิตได้ตลอดช่วงเล่น",
  reporter: "ตรวจบทบาทเริ่มต้นได้หนึ่งครั้ง ขณะผู้เล่นที่ยังมีชีวิตเหลือมากกว่าครึ่ง",
  bomber: "เมื่อคุณตาย Host จะเลือกผู้เล่นใกล้ตัวได้สูงสุดสองคน",
  detective: "หากตำรวจตาย คุณจะรับตำแหน่งตำรวจเป็นการส่วนตัว",
  athlete: "อยู่ City Side มีสามหัวใจ และช่วยสังเกตหา Killer",
  sumo: "อยู่ City Side มีสี่หัวใจและช่วยกันสังเกตผู้ต้องสงสัย",
  villager: "อยู่ City Side มีสองหัวใจ รักษาตัวให้รอดและช่วยหาตัว Killer",
};
export { Brand } from "./brand";
export function Dialog({
  title,
  children,
  onClose,
  dismissible = true,
  className = "",
  onHideScreen,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  dismissible?: boolean;
  className?: string;
  onHideScreen?: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const hidden = usePrivacyHidden();
  useLayoutEffect(() => {
    const node = ref.current;
    if (!hidden) node?.showModal();
    else node?.close();
    return () => node?.close();
  }, [hidden]);
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
        <div className="dialog-actions">
          {onHideScreen && (
            <button className="icon-button privacy-dialog-button" aria-label="ซ่อนหน้าจอ" onClick={onHideScreen}>
              <EyeOff size={19} />
            </button>
          )}
          {dismissible && (
            <button className="icon-button" aria-label="ปิด" onClick={onClose}>
              <X size={20} />
            </button>
          )}
        </div>
      </div>
      {children}
    </dialog>
  );
}
export function Rules({
  onClose,
  rulesVersion = "2.4",
  phase = "lobby",
  finalVoteRules,
  wifeRevoteRules,
}: {
  onClose: () => void;
  rulesVersion?: "legacy" | "2.4";
  phase?: RoomPhase;
  finalVoteRules?: boolean;
  wifeRevoteRules?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<"phases" | "roles">("phases");
  const tabId = useId();
  const phasesTabRef = useRef<HTMLButtonElement>(null);
  const rolesTabRef = useRef<HTMLButtonElement>(null);
  const latestFinalVoteRules = rulesVersion === "2.4" && (phase === "lobby" || finalVoteRules === true);
  const phases = rulesVersion === "2.4" ? V24_GUIDE_PHASES : LEGACY_GUIDE_PHASES;
  const roles = rulesVersion === "legacy"
    ? LEGACY_ROLE_GUIDE
    : latestFinalVoteRules
      ? V24_ROLE_GUIDE
      : V24_PREVIOUS_ROLE_GUIDE;
  const roleOrder = (Object.keys(ROLE_LABELS) as Role[]).filter((role) =>
    rulesVersion === "2.4" ? role !== "sumo" : role !== "doctor",
  );
  const selectTab = (tab: "phases" | "roles", moveFocus = false) => {
    setActiveTab(tab);
    if (moveFocus) requestAnimationFrame(() => (tab === "phases" ? phasesTabRef : rolesTabRef).current?.focus());
  };
  const onTabsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      selectTab(activeTab === "phases" ? "roles" : "phases", true);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      selectTab("phases", true);
    }
    if (event.key === "End") {
      event.preventDefault();
      selectTab("roles", true);
    }
  };

  return (
    <Dialog title="กติกาและวิธีเล่น" onClose={onClose} className="guide-dialog">
      <p className="guide-intro">
        {rulesVersion === "2.4"
          ? "Killer Side ต้องทำการกำจัดให้ทันเวลา ส่วน City Side ต้องเอาตัวรอด เก็บข้อมูล และตัดสินให้ถูกคน. บทบาทของคุณเป็นความลับ."
          : "บทบาทของคุณเป็นความลับ เกมเกิดขึ้นรอบตัวคุณในชีวิตจริง. ใช้คู่มือนี้ตามกฎของห้องนี้."}
      </p>
      {rulesVersion === "2.4" && !latestFinalVoteRules && (
        <p className="guide-compatibility">ห้องนี้เริ่มด้วยกฎโหวต 2.4 รุ่นก่อน จึงใช้กติกาโหวตตามจำนวน Killer ที่ทำงานอยู่.</p>
      )}
      <div className="guide-tabs" role="tablist" aria-label="คู่มือเกม" onKeyDown={onTabsKeyDown}>
        <button ref={phasesTabRef} id={`${tabId}-phases-tab`} type="button" role="tab" aria-selected={activeTab === "phases"}
          aria-controls={`${tabId}-phases-panel`} tabIndex={activeTab === "phases" ? 0 : -1} onClick={() => selectTab("phases")}>เฟสการเล่น</button>
        <button ref={rolesTabRef} id={`${tabId}-roles-tab`} type="button" role="tab" aria-selected={activeTab === "roles"}
          aria-controls={`${tabId}-roles-panel`} tabIndex={activeTab === "roles" ? 0 : -1} onClick={() => selectTab("roles")}>ตัวละคร</button>
      </div>
      <section id={`${tabId}-phases-panel`} role="tabpanel" aria-labelledby={`${tabId}-phases-tab`} hidden={activeTab !== "phases"}>
        <ol className="guide-timeline">
          {phases.map((guidePhase) => <GuidePhaseCard key={guidePhase.number} phase={guidePhase} latestFinalVoteRules={latestFinalVoteRules} wifeRevoteRules={wifeRevoteRules ?? phase === "lobby"} />)}
        </ol>
        {rulesVersion === "2.4" && (
          <details className="guide-interruption">
            <summary>เหตุการณ์แทรก: Bomber ระเบิด</summary>
            <p>เมื่อ Bomber ถูก Killer กำจัด เกมจะหยุดรอ Host ตรวจภาพหลักฐานและเลือกผู้เล่นที่ยังมีชีวิตใกล้ที่สุด 0–1 คน ระเบิดไม่สนหัวใจ ไม่เกิดเป็นลูกโซ่ และไม่ปลดพลัง Killer’s Wife.</p>
          </details>
        )}
        <details className="guide-interruption">
          <summary>เงื่อนไขจบเกมก่อนเวลา</summary>
          {rulesVersion === "2.4" ? <p>{latestFinalVoteRules
            ? "City ชนะเมื่อ Killer ตั้งต้นตายหรือไม่มี Killer ที่ทำงานอยู่ และชนะทันทีหาก Hunt Clock หมด. Killer Side ชนะเมื่อไม่มี Police ที่ยังมีชีวิตหลังการสืบทอดตำแหน่ง."
            : "City ชนะเมื่อไม่มี Killer ที่ทำงานอยู่ และชนะทันทีหาก Hunt Clock หมด. Killer Side ชนะเมื่อไม่มี Police ที่ยังมีชีวิตหลังการสืบทอดตำแหน่ง."}</p>
            : <p>City ชนะเมื่อ Police ชี้ถูก Killer ที่ทำงานอยู่ หรือ Killer ทุกคนตายจากระเบิด. Killer Side ชนะเมื่อ Police ชี้ผิด หรือ Police ตายโดยไม่มี Detective สืบทอด.</p>}
        </details>
      </section>
      <section id={`${tabId}-roles-panel`} role="tabpanel" aria-labelledby={`${tabId}-roles-tab`} hidden={activeTab !== "roles"}>
        <RoleGuide title="Killer Side" roles={roleOrder.filter((role) => roles[role].side === "Killer Side")} guide={roles} />
        <RoleGuide title="City Side" roles={roleOrder.filter((role) => roles[role].side === "City Side")} guide={roles} />
      </section>
      <p className="privacy-caption"><LockKeyhole size={16} /> การปิดเว็บหรือหลุดจากเครือข่ายไม่ทำให้ตัวละครตาย</p>
    </Dialog>
  );
}

function GuidePhaseCard({ phase, latestFinalVoteRules, wifeRevoteRules }: { phase: GuidePhase; latestFinalVoteRules: boolean; wifeRevoteRules: boolean }) {
  const isVote = phase.number === "05";
  const player = isVote && !latestFinalVoteRules
    ? "ถ้ามีการกำจัดที่ยืนยันแล้วเพียง 0–1 ครั้ง City ชนะทันที ถ้ามี 2 ครั้งขึ้นไป ผู้เล่นที่ยังมีชีวิตทุกฝ่ายหยุดสื่อสารและโหวตลับ เลือกผู้เล่นอื่นให้ครบตามจำนวน Killer ที่ทำงานอยู่ ส่งแล้วแก้ไม่ได้; ไม่ส่งถือว่างดออกเสียง. City ต้องเลือก Killer ที่ทำงานอยู่ให้ครบทุกคน."
    : isVote && wifeRevoteRules
      ? "ถ้ามีการกำจัดที่ยืนยันแล้วเพียง 0–1 ครั้ง City ชนะทันที ถ้ามี 2 ครั้งขึ้นไป ผู้เล่นที่ยังมีชีวิตทุกฝ่ายหยุดสื่อสารและส่งบัตรโหวตลับ เลือกคนอื่นเท่านั้น ส่งแล้วแก้ไม่ได้; ไม่ส่งถือว่างดออกเสียง. เลือก Killer ตั้งต้นแล้ว City ชนะ; หากเลือก Killer’s Wife ระบบจะเปิดเผยเธอ ตัดออกจากการโหวต และเปิดโหวตรอบสุดท้ายอีก 3 นาทีทันที."
      : phase.player;
  return <li className="guide-phase">
    <span className="guide-phase-number">{phase.number}</span>
    <div className="guide-phase-heading"><h3>{phase.title}</h3><p>{phase.timing}</p></div>
    <div className="guide-phase-content"><h4>ผู้เล่นต้องทำอะไร</h4><p>{player}</p></div>
    {phase.stops && <div className="guide-phase-content guide-phase-stop"><h4>หยุดทำ</h4><p>{phase.stops}</p></div>}
    {phase.points && <ul>{phase.points.map((point) => <li key={point}>{point}</li>)}</ul>}
    <details><summary>หน้าที่ Host</summary><p>{phase.host}</p></details>
  </li>;
}

function RoleGuide({ title, roles, guide }: { title: string; roles: Role[]; guide: Record<Role, GuideRole> }) {
  return <section className="guide-role-group" aria-labelledby={`guide-${title.replace(" ", "-")}`}>
    <h3 id={`guide-${title.replace(" ", "-")}`}>{title}</h3>
    <div className="guide-role-list">
      {roles.map((role) => <details className="guide-role-card" key={role}>
        <summary>
          <Image className="guide-role-art" src={ROLE_ART[role]} width={96} height={96} sizes="96px" alt={roleArtAlt(role)} />
          <span className="guide-role-copy"><b>{ROLE_LABELS[role]}</b><small>{guide[role].side} · {guide[role].hearts}</small><span>{guide[role].summary}</span></span>
        </summary>
        <div className="guide-role-details">{guide[role].details.map((detail) => <section key={detail.title}><h4>{detail.title}</h4><p>{detail.body}</p></section>)}</div>
      </details>)}
    </div>
  </section>;
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
        ["home", "ภาพรวม", "home"],
        ["evidence", "ตรวจหลักฐาน", "evidence"],
        ["players", "ผู้เล่น", "users"],
        ["events", "เหตุการณ์", "signal"],
      ] as const)
    : ([
        ["home", "หน้าหลัก", "home"],
        ["players", "ผู้เล่น", "users"],
        ["news", "ข่าวสาร", "signal"],
        ["more", "เพิ่มเติม", "gear"],
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
      {tabs.map(([key, label, icon]) => (
        <button
          key={key}
          aria-current={active === key ? "page" : undefined}
          className={active === key ? "active" : ""}
          onClick={() => onChange(key)}
        >
          <PixelIcon name={icon} size={20} />
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
function MysteryCardBack() {
  return (
    <span className="mystery-card-back" aria-hidden="true">
      <svg viewBox="0 0 300 400" fill="none" className="mystery-card-engraving">
        <rect x="16" y="16" width="268" height="368" rx="5" />
        <path d="M32 82h236M32 304h236M32 332h120M32 348h84M210 332h58M210 348h58" />
        <rect x="102" y="132" width="96" height="120" rx="4" />
        <path d="M126 132v-12a24 24 0 0 1 48 0v12" />
      </svg>
      <span className="mystery-card-brand">KILLER</span>
      <span className="mystery-card-question">?</span>
      <span className="mystery-card-caption">แฟ้มบทบาท · ยังไม่เปิดเผย</span>
    </span>
  );
}

export function RoleReveal({
  rulesVersion,
  role,
  previous,
  hearts,
  maxHearts,
  onClose,
  revealImmediately = false,
  revealStorageKey,
  onHideScreen,
  artVariantKey,
}: {
  role: Role;
  rulesVersion?: "legacy" | "2.4";
  previous?: Role;
  hearts?: number;
  maxHearts?: number;
  onClose: () => void;
  revealImmediately?: boolean;
  revealStorageKey?: string;
  onHideScreen?: () => void;
  artVariantKey?: string;
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
  const art = roleArtForPlayer(role, artVariantKey);
  const roleArtReady = loadedArt === art;
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
      onHideScreen={onHideScreen}
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
                src={art}
                width={2048}
                height={2048}
                sizes="280px"
                priority
                alt=""
                onLoad={async (event) => {
                  const node = event.currentTarget;
                  try {
                    await node.decode();
                    if (imageRef.current === node) setLoadedArt(art);
                  } catch {
                    if (imageRef.current === node) setArtError(true);
                  }
                }}
                onError={() => setArtError(true)}
              />
              <span className="section-kicker">
                <LockKeyhole size={14} /> ลับเฉพาะคุณ
              </span>
              <h2>{ROLE_LABELS[role]}</h2>
              <span className="status-pill">
                {role === "killer" || role === "killer-wife" ? "Killer Side" : "City Side"}
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
      {isRevealed && <p>{rulesVersion === "2.4" ? V24_ROLE_DETAILS[role] : ROLE_DETAILS[role]}</p>}
      {isRevealed && role !== "killer" && (
        <div
          className="reveal-hearts"
          aria-label={`${hearts ?? ROLE_HEARTS[role]} หัวใจ`}
        >
          {Array.from({ length: maxHearts ?? ROLE_HEARTS[role] }, (_, i) => (
            <PixelIcon name="heart"
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
