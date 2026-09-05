import type { RoomEvent } from "./types";

export type EventTone = "neutral" | "success" | "warning" | "danger" | "info";
export type EventIcon =
  | "door"
  | "play"
  | "shield"
  | "reject"
  | "check"
  | "skull"
  | "heart"
  | "search"
  | "eye"
  | "mask"
  | "bomb"
  | "trophy"
  | "stop"
  | "radio";
export type EventPresentation = {
  message: string;
  tone: EventTone;
  icon: EventIcon;
};

/** Format stored events without rewriting history or reading current secret state. */
export function presentEvent(
  event: Pick<RoomEvent, "type" | "message">,
  roleLabels: Record<string, string>,
  recipientName?: string,
): EventPresentation {
  const subject = recipientName ?? "คุณ";
  const result = (
    message: string,
    tone: EventTone,
    icon: EventIcon,
  ): EventPresentation => ({ message, tone, icon });
  const exact: Partial<
    Record<RoomEvent["type"], Record<string, EventPresentation>>
  > = {
    system: {
      "ห้องถูกสร้างแล้ว รอผู้เล่นเข้าร่วม": result(
        "สร้างห้องแล้ว รอผู้เล่นเข้าร่วม",
        "neutral",
        "door",
      ),
      "เกมเริ่มแล้ว บทบาทถูกแจกเรียบร้อย": result(
        "เกมเริ่มแล้ว ทุกคนได้รับบทบาทส่วนตัวแล้ว",
        "success",
        "play",
      ),
      "Host สั่งจบเกม": result(
        "Host จบเกมแล้ว โดยไม่มีผู้ชนะ",
        "neutral",
        "stop",
      ),
    },
    warning: {
      ถึงเวลาตำรวจชี้ตัวแล้ว: result(
        "ถึงเวลาตำรวจชี้ตัวแล้ว พักการโจมตีระหว่างรอผล",
        "warning",
        "shield",
      ),
      หลักฐานถูกปฏิเสธ: result(
        `Host ปฏิเสธหลักฐานการโจมตีของ${subject}`,
        "warning",
        "reject",
      ),
      "คุณถูกโจมตีและเสียหัวใจ 1 ดวง": result(
        `${subject}ถูกโจมตี เสียหัวใจ 1 ดวง`,
        "danger",
        "heart",
      ),
    },
    attack: {
      "มีคนถูกโจมตีจาก Killer": result(
        "มีคนถูกโจมตีจาก Killer",
        "danger",
        "heart",
      ),
      "target is still alive": result(
        "Host อนุมัติหลักฐานแล้ว — เป้าหมายยังมีชีวิต",
        "success",
        "check",
      ),
      "elimination confirmed": result(
        "Host อนุมัติหลักฐานแล้ว — กำจัดเป้าหมายสำเร็จ",
        "danger",
        "skull",
      ),
    },
    ability: {
      "Reporter has used an ability.": result(
        "นักข่าวใช้ความสามารถแล้ว",
        "info",
        "search",
      ),
      "Killer has eliminated Killer's Wife. There are now two Killers.": result(
        "Killer กำจัดเมีย Killer แล้ว ขณะนี้มี Killer 2 คน",
        "danger",
        "mask",
      ),
      "คุณกลายเป็น Killer แล้ว": result(
        `${subject}เปลี่ยนเป็น Killer แล้ว ขณะนี้${subject}อยู่ฝ่าย Killer`,
        "danger",
        "mask",
      ),
      ตำรวจคนใหม่ได้รับตำแหน่งแบบส่วนตัว: result(
        `${subject}ได้รับตำแหน่งตำรวจแล้ว${recipientName ? "" : " เก็บบทบาทใหม่เป็นความลับ"}`,
        "info",
        "shield",
      ),
      คุณถูกตรวจบทบาท: result(
        `มีผู้ใช้ความสามารถตรวจบทบาทเริ่มต้นของ${subject}แล้ว`,
        "warning",
        "eye",
      ),
    },
    winner: {
      ฝ่ายเมืองชนะ: result("เกมจบแล้ว — ฝ่ายเมืองชนะ", "success", "trophy"),
      "ฝ่าย Killer ชนะ": result(
        "เกมจบแล้ว — ฝ่าย Killer ชนะ",
        "danger",
        "trophy",
      ),
    },
  };
  const known = exact[event.type]?.[event.message];
  if (known) return known;
  if (event.type === "ability") {
    // Match the final role token only; names may themselves contain “ คือ ”.
    const match = /^บทบาทเริ่มต้นของ ([\s\S]+) คือ ([a-z-]+)$/.exec(
      event.message,
    );
    if (match && Object.hasOwn(roleLabels, match[2]))
      return result(
        `บทบาทเริ่มต้นของ${match[1]}คือ ${roleLabels[match[2]]}`,
        "info",
        "search",
      );
  }
  if (event.type === "warning" && event.message.endsWith(" ถูกกำจัด"))
    return result(
      `${event.message.slice(0, -" ถูกกำจัด".length)}ถูกกำจัดแล้ว`,
      "danger",
      "skull",
    );
  if (event.type === "bomb") {
    if (event.message.endsWith(" ถูกกำจัด — Bomber"))
      return result(
        `${event.message.slice(0, -" ถูกกำจัด — Bomber".length)}ถูกกำจัดแล้ว และมีบทบาทเป็น Bomber — รอ Host จัดการระเบิด`,
        "warning",
        "bomb",
      );
    if (event.message.endsWith(" ถูกกำจัดจากระเบิด"))
      return result(
        `${event.message.slice(0, -" ถูกกำจัดจากระเบิด".length)}ถูกกำจัดจากระเบิด`,
        "danger",
        "bomb",
      );
  }
  return result(event.message, "neutral", "radio");
}
