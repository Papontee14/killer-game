"use client";
import { useEffect, useState } from "react";
import type { RoomState } from "@/src/types";
import {
  configureV24,
  doctorAbility,
  revealPolice,
  resolveV24Action,
  submitFinalBallot,
  resolveFinal,
  recordV24Warning,
} from "@/src/room-store";

type Props = {
  room: RoomState;
  act: (task: () => Promise<RoomState>) => unknown;
  busy: boolean;
  /** Lobby drafts belong to HostRoom so a recommendation can set roles and time together. */
  durationDraft?: number;
  onDurationDraftChange?: (minutes: number) => void;
};
const stamp = (value?: string) =>
  value
    ? new Date(value).toLocaleTimeString("th-TH", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Bangkok",
      })
    : "—";
function countdown(value: string | undefined, now: number) {
  if (!value) return "—";
  const seconds = Math.max(0, Math.ceil((Date.parse(value) - now) / 1000));
  return `${Math.floor(seconds / 3600)}:${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
function formatDuration(totalMinutes: number) {
  totalMinutes = Math.max(0, totalMinutes);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours} ชั่วโมง${minutes ? ` ${minutes} นาที` : ""}`;
}
export function V24Panel({ room, act, busy, durationDraft, onDurationDraftChange }: Props) {
  const v = room.v24;
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const start = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Date.now() - start), 1000);
    return () => clearInterval(timer);
  }, [v?.serverNow]);
  const now = Date.parse(v?.serverNow || new Date().toISOString()) + elapsed;
  const savedDuration = v?.durationMinutes ?? 600;
  const [durationHours, setDurationHours] = useState(Math.floor(savedDuration / 60));
  const [durationMinutes, setDurationMinutes] = useState(savedDuration % 60);
  const localDuration = durationHours * 60 + durationMinutes;
  const duration = durationDraft ?? localDuration;
  useEffect(() => {
    if (v?.durationMinutes == null) return;
    setDurationHours(Math.floor(v.durationMinutes / 60));
    setDurationMinutes(v.durationMinutes % 60);
  }, [v?.durationMinutes]);
  const [target, setTarget] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [ranking, setRanking] = useState<string[]>([]);
  const [confirmVote, setConfirmVote] = useState(false);
  const [warning, setWarning] = useState("");
  const host = room.viewerRole === "host";
  const me = room.playerId ? room.privateStates[room.playerId] : undefined;
  const living = room.players.filter((p) => p.health !== "dead");
  const choices = living.filter((p) => p.id !== room.playerId);
  const voterKey = choices.map((p) => p.id).join(",");
  const alive = living.some((p) => p.id === room.playerId);
  const names = (ids: string[]) =>
    ids
      .map((id) => room.players.find((p) => p.id === id)?.name ?? "—")
      .join(", ");
  useEffect(() => {
    if (room.phase === "secret-vote")
      setRanking(voterKey ? voterKey.split(",") : []);
    setSelected([]);
    setConfirmVote(false);
  }, [room.phase, room.code, voterKey]);
  if (room.rulesVersion !== "2.4" || !v) return null;
  if (room.phase === "lobby")
    return host ? (
      <section className="panel v24-panel" data-host-section="home">
        <h2>ตั้งค่าก่อนเริ่ม</h2>
        <fieldset className="duration-fields">
          <legend>ระยะเวลาเกม</legend>
          <label>
            ชั่วโมง
            <input
              type="number"
              min={0}
              max={48}
              value={Math.floor(duration / 60)}
              onChange={(e) => {
                const next = Math.max(0, Number(e.target.value) || 0) * 60 + duration % 60;
                if (onDurationDraftChange) onDurationDraftChange(next);
                else setDurationHours(Math.floor(next / 60));
              }}
            />
          </label>
          <label>
            นาที
            <input
              type="number"
              min={0}
              max={59}
              value={duration % 60}
              onChange={(e) => {
                const next = Math.floor(duration / 60) * 60 + Math.min(59, Math.max(0, Number(e.target.value) || 0));
                if (onDurationDraftChange) onDurationDraftChange(next);
                else setDurationMinutes(next % 60);
              }}
            />
          </label>
        </fieldset>
        <p>
          cutoff {formatDuration(duration - 30)} · discussion {formatDuration(duration - 10)} · Reveal
          ถึง {formatDuration(duration - 120)} · โหวตอีก 3 นาที
        </p>
        <button
          className="primary-action"
          disabled={
            busy ||
            duration <= 120 ||
            duration > 2880
          }
          onClick={() => act(() => configureV24(room.code, duration))}
        >
          บันทึกกติกาก่อนเริ่ม
        </button>
        <p role="status">
          {v.durationMinutes
            ? `ค่าที่บันทึก: ${formatDuration(v.durationMinutes)}`
            : "ต้องบันทึกระยะเวลาเกมก่อนแจกบทบาท"}
        </p>
      </section>
    ) : (
      <section className="panel v24-panel">
        <h2>ห้องรอเริ่มเกม</h2>
        <p>{v.durationMinutes ? `ระยะเวลาเกม: ${formatDuration(v.durationMinutes)}` : "รอ Host กำหนดระยะเวลาเกม"}</p>
      </section>
    );
  return (
    <section className="panel v24-panel" data-host-section="urgent">
      <span className="section-kicker">v2.4 · เวลาเซิร์ฟเวอร์</span>
      <h2>
        {room.phase === "secret-vote"
          ? "Communication Lock · โหวตลับ"
          : room.phase === "final-discussion"
            ? "Final Discussion"
            : room.phase === "resolution"
              ? "Resolution · รอเคลียร์เหตุการณ์"
              : "กำหนดการเกม"}
      </h2>
      <div className="v24-metrics">
        <div>
          หยุดรับ action<strong>{stamp(v.cutoffAt)}</strong>
        </div>
        <div>
          Final<strong>{stamp(v.finalAt)}</strong>
        </div>
        <div>
          เวลาที่เหลือ
          <strong>
            {countdown(
              room.phase === "secret-vote" ? v.voteEndsAt : v.finalAt,
              now,
            )}
          </strong>
        </div>
      </div>
      {v.huntDeadline && (
        <>
          <div className="v24-metrics">
            <div>
              Hunt Clock<strong>{countdown(v.huntDeadline, now)}</strong>
            </div>
            <div>
              Attack / 60m<strong>{v.attacksUsed ?? 0} / 3</strong>
            </div>
            <div>
              Kill / 60m<strong>{v.killsUsed ?? 0} / 1</strong>
            </div>
          </div>
          <p>
            pending {v.pendingAttacks ?? 0} · rolling window ใช้ร่วมกันทั้งทีม
            {v.huntPending ? " · รอ Host ตรวจหลักฐานก่อนตัดสิน Hunt Clock" : ""}
          </p>
        </>
      )}
      {me && !me.isActiveKiller && me.protectionUntil && (
        <p>
          Protection ของคุณ:{" "}
          <strong>{countdown(me.protectionUntil, now)}</strong>
        </p>
      )}
      {alive && me?.currentRole === "doctor" && (
        <div className="v24-action">
          <h3>Doctor · รักษาผู้เล่นอื่น</h3>
          <p>
            เหลือ {4 - (me.doctorUses ?? 0)} ครั้ง · cooldown{" "}
            {countdown(me.doctorReadyAt, now)} · ผลไม่บอกว่าคืน Heart
            สำเร็จหรือไม่
          </p>
          <select
            aria-label="เป้าหมาย Doctor"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value="">เลือกผู้เล่น</option>
            {choices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button
            className="primary-action"
            disabled={
              busy ||
              !choices.some((p) => p.id === target) ||
              (me.doctorUses ?? 0) >= 4 ||
              Date.parse(me.doctorReadyAt ?? "") > now ||
              now >= Date.parse(v.cutoffAt ?? "") ||
              !["active", "bomb-resolution"].includes(room.phase)
            }
            onClick={() => act(() => doctorAbility(room.code, target))}
          >
            ใช้ 1 ครั้ง · ส่งการรักษา
          </button>
        </div>
      )}
      {alive && me?.currentRole === "police" && (
        <div className="v24-action">
          <h3>Reveal Badge</h3>
          <p>
            ใช้ได้ถึง {stamp(v.revealEndsAt)} · ไม่เพิ่ม Heart หรือ protection
          </p>
          <button
            className="secondary-action"
            disabled={
              busy ||
              me.badgeRevealed ||
              now > Date.parse(v.revealEndsAt ?? "") ||
              !["active", "bomb-resolution"].includes(room.phase)
            }
            onClick={() => act(() => revealPolice(room.code))}
          >
            {me.badgeRevealed ? "เปิดเผยตัวแล้ว" : "เปิดเผยตัวว่าเป็น Police"}
          </button>
        </div>
      )}
      {room.phase === "secret-vote" && (
        <div className="v24-action">
          <p>
            ห้ามพูดคุยหรือส่งข้อมูลเกมเพิ่มเติม · เลือก {v.nomineeCount} คน
            {v.finalVoteRules ? " (Killer ตั้งต้นเท่านั้นจึงชนะ)" : ""} ·
            ส่งแล้วแก้ไม่ได้
          </p>
          {!host && !alive && <p>ผู้เสียชีวิตไม่มีสิทธิ์โหวต</p>}
          {!host &&
            alive &&
            (v.myBallot ? (
              <p role="status">
                ส่ง ballot แล้ว: {names(v.myBallot.nominees)} · รอประกาศผล
              </p>
            ) : (
              <>
                <fieldset disabled={busy || confirmVote}>
                  <legend>
                    ผู้ต้องสงสัย ({selected.length}/{v.nomineeCount})
                  </legend>
                  {choices.map((p) => (
                    <label className="v24-choice" key={p.id}>
                      <input
                        type="checkbox"
                        checked={selected.includes(p.id)}
                        disabled={
                          !selected.includes(p.id) &&
                          selected.length >= (v.nomineeCount ?? 1)
                        }
                        onChange={() =>
                          setSelected((old) =>
                            old.includes(p.id)
                              ? old.filter((id) => id !== p.id)
                              : [...old, p.id],
                          )
                        }
                      />
                      {p.name}
                    </label>
                  ))}
                </fieldset>
                {me?.currentRole === "police" && (
                  <fieldset disabled={busy || confirmVote}>
                    <legend>ลำดับตัดสินคะแนนเสมอ · อันดับ 1 สำคัญที่สุด</legend>
                    {ranking.map((id, i) => (
                      <div className="v24-rank" key={id}>
                        <span>
                          {i + 1}. {names([id])}
                        </span>
                        <button
                          aria-label={`เลื่อน ${names([id])} ขึ้น`}
                          disabled={i === 0}
                          onClick={() =>
                            setRanking((old) => {
                              const next = [...old];
                              [next[i - 1], next[i]] = [next[i], next[i - 1]];
                              return next;
                            })
                          }
                        >
                          ↑
                        </button>
                        <button
                          aria-label={`เลื่อน ${names([id])} ลง`}
                          disabled={i === ranking.length - 1}
                          onClick={() =>
                            setRanking((old) => {
                              const next = [...old];
                              [next[i + 1], next[i]] = [next[i], next[i + 1]];
                              return next;
                            })
                          }
                        >
                          ↓
                        </button>
                      </div>
                    ))}
                  </fieldset>
                )}
                {confirmVote ? (
                  <>
                    <p>ยืนยันเลือก {names(selected)}?</p>
                    <button
                      className="primary-action"
                      disabled={busy || now >= Date.parse(v.voteEndsAt ?? "")}
                      onClick={() =>
                        act(() =>
                          submitFinalBallot(
                            room.code,
                            selected,
                            me?.currentRole === "police" ? ranking : [],
                          ),
                        )
                      }
                    >
                      ส่ง ballot ลับ · แก้ไม่ได้
                    </button>
                    <button
                      className="secondary-action"
                      disabled={busy}
                      onClick={() => setConfirmVote(false)}
                    >
                      กลับไปแก้
                    </button>
                  </>
                ) : (
                  <button
                    className="primary-action"
                    disabled={
                      busy ||
                      selected.length !== v.nomineeCount ||
                      now >= Date.parse(v.voteEndsAt ?? "")
                    }
                    onClick={() => setConfirmVote(true)}
                  >
                    ตรวจ ballot ก่อนส่ง
                  </button>
                )}
              </>
            ))}
          {host && (
            <>
              <p>
                ส่งแล้ว {v.ballots?.length ?? 0}/{living.length} ใบ ·
                ไม่แสดงคะแนนต่อผู้เล่น
              </p>
              <button
                className="secondary-action"
                disabled={busy}
                onClick={() => act(() => resolveFinal(room.code))}
              >
                ตรวจเวลาและตัดสินเมื่อครบกำหนด
              </button>
            </>
          )}
        </div>
      )}
      {host && (
        <div className="v24-action">
          <h3>คิวตาม effective time</h3>
          <p>
            รอครบหน้าต่างส่งภาพ 2 นาที แล้ว resolve จากบนลงล่าง; attack
            เปิดภาพตรวจในส่วนหลักฐาน
          </p>
          {v.actions
            ?.filter((a) => a.status === "pending")
            .map((a, i) => (
              <div className="v24-queue" key={a.id}>
                <strong>
                  {a.kind === "heal" ? "Heal" : "Attack"} ·{" "}
                  {names([a.target_id])}
                </strong>
                <small>
                  {stamp(a.effective_at)} · {names([a.actor_id])}
                </small>
                {a.kind === "heal" && (
                  <button
                    className="secondary-action"
                    disabled={
                      busy ||
                      i !== 0 ||
                      room.phase === "bomb-resolution" ||
                      now < Date.parse(a.effective_at) + 120000
                    }
                    onClick={() => act(() => resolveV24Action(room.code, a.id))}
                  >
                    Resolve การรักษา
                  </button>
                )}
              </div>
            ))}
          <label>
            บันทึก warning
            <textarea
              maxLength={500}
              value={warning}
              onChange={(e) => setWarning(e.target.value)}
            />
          </label>
          <button
            className="secondary-action"
            disabled={busy || !warning.trim()}
            onClick={() => act(() => recordV24Warning(room.code, warning))}
          >
            บันทึก warning
          </button>
        </div>
      )}
      {v.nominees && (
        <p>
          Final nominees: <strong>{names(v.nominees)}</strong>
        </p>
      )}
    </section>
  );
}
