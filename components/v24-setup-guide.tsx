"use client";

import { useEffect, useMemo, useState } from "react";
import type { Role } from "@/src/types";
import {
  V24_OFFICE_PRESETS,
  V24_STANDARD_12_PRESET,
  type V24GamePreset,
} from "@/src/v24-presets";

type PresetId = keyof typeof V24_OFFICE_PRESETS | "standard-12";
type Props = {
  joinedPlayers: number;
  counts: Record<Role, number>;
  durationMinutes: number;
  busy: boolean;
  onApply: (preset: V24GamePreset) => void;
};

const roleOrder: Role[] = [
  "killer", "killer-wife", "police", "detective", "reporter", "athlete", "doctor", "bomber", "villager",
];
const roleNames: Record<Role, string> = {
  killer: "Killer", "killer-wife": "Wife", police: "Police", detective: "Detective",
  reporter: "Reporter", athlete: "Athlete", doctor: "Doctor", bomber: "Bomber", villager: "Villager", sumo: "Sumo",
};
const formatDuration = (minutes: number) => {
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return `${hours} ชั่วโมง${rest ? ` ${rest} นาที` : ""}`;
};
const sameCounts = (left: Record<Role, number>, right: Record<Role, number>) =>
  roleOrder.every((role) => left[role] === right[role]);
const reporterMinimum = (players: number) => Math.floor(players / 2) + 1;

export function V24SetupGuide({ joinedPlayers, counts, durationMinutes, busy, onApply }: Props) {
  const automatic = joinedPlayers >= 5 && joinedPlayers <= 11 ? joinedPlayers as keyof typeof V24_OFFICE_PRESETS : joinedPlayers === 12 ? "standard-12" : undefined;
  const [selected, setSelected] = useState<PresetId | undefined>(automatic);
  const [manuallySelected, setManuallySelected] = useState(false);
  useEffect(() => {
    if (!manuallySelected) setSelected(automatic);
  }, [automatic, manuallySelected]);
  const preset = useMemo(() => selected === "standard-12"
    ? V24_STANDARD_12_PRESET
    : selected ? V24_OFFICE_PRESETS[selected] : undefined, [selected]);
  const changed = !!preset && (!sameCounts(counts, preset.roleCounts) || durationMinutes !== preset.durationMinutes);
  const listedRoles = preset && roleOrder
    .filter((role) => preset.roleCounts[role] > 0);
  const waiting = preset ? Math.max(0, preset.playerCount - joinedPlayers) : 0;

  return (
    <section className="panel v24-setup-guide" data-host-section="home" aria-labelledby="setup-guide-title">
      <div className="setup-guide-heading">
        <div>
          <span className="section-kicker">Guide สำหรับ Host</span>
          <h2 id="setup-guide-title">เลือกชุดแนะนำ</h2>
        </div>
        <span className="count-total">เข้าห้องแล้ว {joinedPlayers} คน</span>
      </div>
      <p className="guide-lead">เลือกจำนวนคนเพื่อดูบทบาทและเวลา แล้วกดใช้ชุดแนะนำ</p>
      <fieldset className="preset-picker">
        <legend>Office · 5–11 คน</legend>
        <div role="radiogroup" aria-label="จำนวนผู้เล่น Office">
          {Object.keys(V24_OFFICE_PRESETS).map((value) => {
            const playerCount = Number(value) as keyof typeof V24_OFFICE_PRESETS;
            return <label key={value}>
              <input type="radio" name="v24-preset" value={value} checked={selected === playerCount} onChange={() => { setManuallySelected(true); setSelected(playerCount); }} />
              {playerCount} คน
            </label>;
          })}
        </div>
      </fieldset>
      <fieldset className="preset-picker standard-picker">
        <legend>ชุดมาตรฐาน</legend>
        <label>
          <input type="radio" name="v24-preset" value="standard-12" checked={selected === "standard-12"} onChange={() => { setManuallySelected(true); setSelected("standard-12"); }} />
          12 คน / 10 ชั่วโมง
        </label>
      </fieldset>
      {preset ? <div className="preset-card">
        <div className="preset-summary">
          <strong className="preset-title">{selected === "standard-12" ? "ชุดมาตรฐาน 12 คน / 10 ชั่วโมง" : `Office · ${preset.playerCount} คน / ${formatDuration(preset.durationMinutes)}`}</strong>
          <ul className="preset-roles" aria-label="บทบาทในชุดแนะนำ">
            {listedRoles?.map((role) => <li key={role}><span>{roleNames[role]}</span><b>×{preset.roleCounts[role]}</b></li>)}
          </ul>
          <p className="preset-context">{selected === "standard-12"
            ? "ตามแผนเดิม · คนละบริบทกับ Office ไม่รับรองว่าเหมาะกับช่วงประชุมยาว"
            : "ชุดทดลองระหว่างทำงาน · สมมติมีโอกาสโจมตีทุก 45–60 นาที ยังไม่รับรองความสูสี"}</p>
        </div>
        <div className="preset-footer">
          <p>{waiting ? `รอผู้เล่นอีก ${waiting} คน` : joinedPlayers === preset.playerCount ? "จำนวนผู้เล่นตรงกับชุด" : `มีผู้เล่นเกินชุด ${joinedPlayers - preset.playerCount} คน`}</p>
          <button className="secondary-action" disabled={busy} onClick={() => onApply(preset)}>ใช้ชุดแนะนำ</button>
        </div>
      </div> : <p className="muted">เลือกจำนวนที่วางแผนเอง: Guide มีชุดแนะนำเฉพาะ 5–12 คน</p>}
      {changed && <p className="guide-changed" role="status">ปรับจากชุดแนะนำแล้ว</p>}
      <details className="guide-details">
        <summary>ข้อควรทราบก่อนใช้ชุดนี้</summary>
        <ul>
          {preset && <li>{preset.note}</li>}
          {preset && preset.roleCounts.reporter > 0 && <li>Reporter ต้องเหลือผู้มีชีวิตมากกว่าครึ่ง: เริ่ม {preset.playerCount} คน ต้องเหลืออย่างน้อย {reporterMinimum(preset.playerCount)} คน</li>}
          <li>Hunt บังคับ kill แรกและ kill ถัดไปภายใน 120 นาที การเพิ่มเวลาเกมไม่หยุดนาฬิกานี้</li>
          <li>เป้าหมายทั่วไปต้องโดน 2 ครั้ง ห่างอย่างน้อย 45 นาที; การปลด Wife ใช้โควต้าโจมตีด้วย</li>
          <li>ชุด Office พัก Athlete, Doctor และ Bomber เพื่อลดต้นทุนการฆ่าและภาระติดตามระหว่างทำงาน</li>
          <li>ชุด Office ให้เวลาเผื่อการทำงาน แต่ไม่รับประกันว่า City จะมีเสียงมากกว่า หาก Killer โจมตีได้ถี่</li>
          <li>เวลาในชุดรวมช่วงหยุดโจมตี 30 นาทีแล้ว โหวตเพิ่มอีก 3 นาที และอาจรอ Host เกินกำหนด</li>
        </ul>
        {selected === "standard-12" && <p>ชุดมาตรฐานเป็นบริบทต่างจาก Office และไม่ได้รับรองว่าเหมาะกับประชุมยาวหรือเล่นไม่ต่อเนื่อง</p>}
      </details>
    </section>
  );
}
