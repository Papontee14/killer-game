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
export function V24SetupGuide({ joinedPlayers, busy, onApply }: Props) {
  const automatic = joinedPlayers >= 5 && joinedPlayers <= 11 ? joinedPlayers as keyof typeof V24_OFFICE_PRESETS : joinedPlayers === 12 ? "standard-12" : undefined;
  const [selected, setSelected] = useState<PresetId | undefined>(automatic);
  const [manuallySelected, setManuallySelected] = useState(false);
  useEffect(() => {
    if (!manuallySelected) setSelected(automatic);
  }, [automatic, manuallySelected]);
  const preset = useMemo(() => selected === "standard-12"
    ? V24_STANDARD_12_PRESET
    : selected ? V24_OFFICE_PRESETS[selected] : undefined, [selected]);
  const listedRoles = preset && roleOrder
    .filter((role) => preset.roleCounts[role] > 0);
  const waiting = preset ? Math.max(0, preset.playerCount - joinedPlayers) : 0;

  return (
    <section className="panel v24-setup-guide" data-host-section="home" aria-labelledby="setup-guide-title">
      <details className="host-setup-disclosure">
      <summary className="host-setup-summary">
      <div className="setup-guide-heading">
        <div>
          <span className="section-kicker">Guide สำหรับ Host</span>
          <h2 id="setup-guide-title">เลือกชุดแนะนำ</h2>
        </div>
        <span className="count-total">เข้าห้องแล้ว {joinedPlayers} คน</span>
      </div>
      <span className="host-setup-overview">{preset ? `ชุดที่เลือก: ${preset.playerCount} คน / ${formatDuration(preset.durationMinutes)}` : "ยังไม่ได้เลือกชุด"}</span>
      </summary>
      <div className="host-setup-content">
      <p className="guide-lead">เลือกจำนวนคนเพื่อดูบทบาทและเวลา แล้วกดใช้ชุดแนะนำ</p>
      <fieldset className="preset-picker">
        <legend>จำนวนผู้เล่น</legend>
        <div role="radiogroup" aria-label="จำนวนผู้เล่น">
          {Object.keys(V24_OFFICE_PRESETS).map((value) => {
            const playerCount = Number(value) as keyof typeof V24_OFFICE_PRESETS;
            return <label key={value}>
              <input type="radio" name="v24-preset" value={value} checked={selected === playerCount} onChange={() => { setManuallySelected(true); setSelected(playerCount); }} />
              {playerCount} คน
            </label>;
          })}
          <label>
            <input type="radio" name="v24-preset" value="standard-12" checked={selected === "standard-12"} onChange={() => { setManuallySelected(true); setSelected("standard-12"); }} />
            12 คน
          </label>
        </div>
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
      </div>
      </details>
    </section>
  );
}
