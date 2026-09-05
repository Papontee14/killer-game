import type { Evidence, RoomState } from "./types";

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function u16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}
function u32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true);
}
function zip(entries: Array<{ name: string; bytes: Uint8Array }>) {
  const encoder = new TextEncoder();
  const files: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const sum = crc32(entry.bytes);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    u32(lv, 0, 0x04034b50);
    u16(lv, 4, 20);
    u16(lv, 6, 0x800);
    u32(lv, 14, sum);
    u32(lv, 18, entry.bytes.length);
    u32(lv, 22, entry.bytes.length);
    u16(lv, 26, name.length);
    local.set(name, 30);
    files.push(local, entry.bytes);
    const dir = new Uint8Array(46 + name.length);
    const dv = new DataView(dir.buffer);
    u32(dv, 0, 0x02014b50);
    u16(dv, 4, 20);
    u16(dv, 6, 20);
    u16(dv, 8, 0x800);
    u32(dv, 16, sum);
    u32(dv, 20, entry.bytes.length);
    u32(dv, 24, entry.bytes.length);
    u16(dv, 28, name.length);
    u32(dv, 42, offset);
    dir.set(name, 46);
    central.push(dir);
    offset += local.length + entry.bytes.length;
  }
  const centralSize = central.reduce((sum, item) => sum + item.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50);
  u16(ev, 8, entries.length);
  u16(ev, 10, entries.length);
  u32(ev, 12, centralSize);
  u32(ev, 16, offset);
  return new Blob(
    [...files, ...central, end].map(
      (part) =>
        part.buffer.slice(
          part.byteOffset,
          part.byteOffset + part.byteLength,
        ) as ArrayBuffer,
    ),
    { type: "application/zip" },
  );
}
async function imageBytes(source: string) {
  const match = source.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
  if (match) {
    const binary = atob(match[2]);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return { bytes, extension: match[1].split("/")[1].replace("jpeg", "jpg") };
  }
  const response = await fetch(source);
  if (!response.ok) throw new Error("ดาวน์โหลดรูปหลักฐานไม่สำเร็จ");
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    extension: "jpg",
  };
}
async function evidenceEntry(evidence: Evidence, index: number) {
  if (!evidence.imageData) throw new Error("โหลดรูปหลักฐานไม่ได้ กรุณาลองใหม่");
  const { bytes, extension } = await imageBytes(evidence.imageData);
  return {
    name: `evidence-${String(index + 1).padStart(2, "0")}.${extension}`,
    bytes,
  };
}
export async function downloadEvidenceArchive(room: RoomState) {
  if (typeof window === "undefined")
    throw new Error("ดาวน์โหลดได้จากหน้า Host เท่านั้น");
  const entries = await Promise.all(room.evidences.map(evidenceEntry));
  entries.unshift({
    name: "game-summary.json",
    bytes: new TextEncoder().encode(
      JSON.stringify(
        {
          code: room.code,
          hostName: room.hostName,
          phase: room.phase,
          winner: room.winner,
          players: room.players,
          roles: room.privateStates,
          events: room.events,
          evidence: room.evidences.map(
            ({ imageData, storagePath, ...metadata }) => metadata,
          ),
        },
        null,
        2,
      ),
    ),
  });
  const url = URL.createObjectURL(zip(entries));
  const link = document.createElement("a");
  link.href = url;
  link.download = `killer-${room.code}-evidence.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return entries.length;
}
