import { Skull } from "lucide-react";
import type { RoomState } from "@/src/types";

export function KillerProgress({ room, playerId }: { room: RoomState; playerId: string }) {
  const allies = room.players.filter((player) => player.id !== playerId && room.privateStates[player.id]?.isActiveKiller);
  const name = (id: string) => room.players.find((player) => player.id === id)?.name ?? "ผู้เล่น";
  const labels = { pending: "รอ Host ตรวจ", rejected: "ปฏิเสธ", approved: "อนุมัติแล้ว" };
  return <>
    <div className="panel killer-alliance"><Skull size={19} /><strong>KILLER ALLIANCE</strong>
      {allies.length ? allies.map((ally) => <p key={ally.id}>คู่ Killer: {ally.name}{ally.health === "dead" ? " (ถูกกำจัดแล้ว)" : ""}</p>) : <p>ขณะนี้คุณเป็น Killer คนเดียว</p>}
    </div>
    <div className="panel"><h2>หลักฐานร่วมของทีม</h2>
      {room.killerEvidenceProgress.length === 0 ? <p>ยังไม่มีหลักฐาน</p> : <div className="event-feed">
        {room.killerEvidenceProgress.map((item) => <div className="event-row" key={item.id}><div>
          <p>{name(item.killerId)} → {name(item.targetId)}</p>
          <p>{labels[item.status]}{item.result ? ` · ${item.result === "elimination confirmed" ? "กำจัดสำเร็จ" : "เป้าหมายยังมีชีวิต"}` : ""}</p>
          <time>{new Date(item.createdAt).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}</time>
        </div></div>)}
      </div>}
    </div>
  </>;
}
