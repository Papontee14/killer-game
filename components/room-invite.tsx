"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { Dialog } from "./game-ui";

export function RoomInvite({ code }: { code: string }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [qr, setQr] = useState("");
  const [status, setStatus] = useState("");
  const [qrError, setQrError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setUrl(`${window.location.origin}/?room=${encodeURIComponent(code)}`);
  }, [code]);
  useEffect(() => {
    if (!open || !url) return;
    let cancelled = false;
    setQr(""); setQrError(false);
    import("qrcode").then(qrcode => qrcode.toDataURL(url, {
      width: 320, margin: 4, errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#ffffff" },
    })).then(data => { if (!cancelled) setQr(data); })
      .catch(() => { if (!cancelled) setQrError(true); });
    return () => { cancelled = true; };
  }, [open, url, attempt]);
  return <>
    <button className="secondary-action" onClick={() => { setOpen(true); setStatus(""); }}>ชวนเพื่อน · ลิงก์ / QR</button>
    {open && <Dialog title={`เข้าห้อง ${code}`} onClose={() => setOpen(false)}>
      <p>สแกน QR หรือเปิดลิงก์ แล้วใส่ชื่อเพื่อเข้าห้อง</p>
      {qr ? <Image className="invite-qr" src={qr} alt={`QR เข้าห้อง ${code}`} width={256} height={256} unoptimized /> :
        qrError ? <button className="secondary-action" onClick={() => setAttempt(value => value + 1)}>โหลด QR อีกครั้ง</button> : <p role="status">กำลังสร้าง QR…</p>}
      <label className="dialog-field">ลิงก์เข้าห้อง
        <input aria-label="ลิงก์เข้าห้อง" readOnly value={url} onFocus={event => event.target.select()} />
      </label>
      <button className="primary-action" onClick={async () => {
        try { await navigator.clipboard.writeText(url); setStatus("คัดลอกลิงก์แล้ว"); }
        catch { setStatus("คัดลอกไม่ได้ แตะช่องลิงก์เพื่อเลือกและคัดลอกเอง"); }
      }}>คัดลอกลิงก์</button>
      <p role="status">{status}</p>
    </Dialog>}
  </>;
}
