"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  Check,
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
export function Brand({ small = false }: { small?: boolean }) {
  return <span className={`killer-logo ${small ? "small" : ""}`}>KILLER</span>;
}
export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
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
      className="game-dialog"
      aria-labelledby={id}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-heading">
        <h2 id={id}>{title}</h2>
        <button className="icon-button" aria-label="ปิด" onClick={onClose}>
          <X size={20} />
        </button>
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
      <div className="rules-roles">
        {(Object.keys(ROLE_LABELS) as Role[]).map((role) => (
          <details key={role}>
            <summary>
              <Shield size={17} />
              <b>{ROLE_LABELS[role]}</b>
              <span>
                {ROLE_HEARTS[role]
                  ? `${ROLE_HEARTS[role]} หัวใจ`
                  : "ไม่มีแถบหัวใจ"}
              </span>
              <ChevronRight size={16} />
            </summary>
            <p>{ROLE_DETAILS[role]}</p>
          </details>
        ))}
      </div>
      <p className="privacy-caption">
        <LockKeyhole size={16} />{" "}
        การปิดเว็บหรือหลุดจากเครือข่ายไม่ทำให้ตัวละครตาย
      </p>
    </Dialog>
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
export function RoleReveal({
  role,
  previous,
  hearts,
  maxHearts,
  onClose,
}: {
  role: Role;
  previous?: Role;
  hearts?: number;
  maxHearts?: number;
  onClose: () => void;
}) {
  return (
    <Dialog
      title={previous ? "บทบาทของคุณเปลี่ยนแล้ว" : "บทบาทของคุณ"}
      onClose={onClose}
    >
      <div className={`role-reveal ${role === "killer" ? "killer" : ""}`}>
        <div className="role-reveal-art" />
        <span className="section-kicker">
          <LockKeyhole size={14} /> เฉพาะคุณเท่านั้น
        </span>
        <h2>{ROLE_LABELS[role]}</h2>
        <span className="status-pill">
          {role === "killer" ? "ฝ่าย Killer" : "ฝ่ายเมือง"}
        </span>
      </div>
      {previous && (
        <p className="muted">
          จาก {ROLE_LABELS[previous]} → {ROLE_LABELS[role]} ·
          เก็บตัวตนใหม่เป็นความลับ
        </p>
      )}
      <p>{ROLE_DETAILS[role]}</p>
      {role !== "killer" && (
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
      <button className="primary-action" onClick={onClose}>
        เข้าใจแล้ว <Check size={18} />
      </button>
    </Dialog>
  );
}
