"use client";

import { useEffect, useRef, useState } from "react";

export function LiveCamera({
  disabled,
  onCapture,
}: {
  disabled: boolean;
  onCapture: (photo: Blob, capturedAt: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [capturing, setCapturing] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const generation = useRef(0);
  useEffect(() => {
    if (disabled) {
      setOpen(false);
      setReady(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (!open || disabled) return;
    let cancelled = false;
    let stream: MediaStream | undefined;
    const stop = () => {
      stream?.getTracks().forEach((track) => track.stop());
    };
    const start = async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia)
          throw new Error("ต้องเปิดผ่าน HTTPS และใช้เบราว์เซอร์ที่รองรับกล้อง");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stop();
          return;
        }
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play();
        }
      } catch (cause) {
        stop();
        if (!cancelled) {
          setReady(false);
          setError(
            cause instanceof DOMException && cause.name === "NotAllowedError"
              ? "กรุณาอนุญาตให้ใช้กล้อง แล้วลองใหม่"
              : cause instanceof Error
                ? cause.message
                : "เปิดกล้องไม่ได้ กรุณาลองใหม่",
          );
          setOpen(false);
        }
      }
    };
    const hide = () => {
      if (document.hidden) setOpen(false);
    };
    const leave = () => {
      stop();
      setOpen(false);
    };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", leave);
    void start();
    return () => {
      cancelled = true;
      generation.current += 1;
      stop();
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", leave);
    };
  }, [open, disabled]);

  const capture = () => {
    const source = video.current;
    if (!source || !ready || capturing || disabled || !source.videoWidth)
      return;
    const canvas = document.createElement("canvas");
    canvas.width = source.videoWidth;
    canvas.height = source.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setError("ถ่ายรูปไม่ได้ กรุณาลองใหม่");
      return;
    }
    const capturedAt = new Date().toISOString();
    context.drawImage(source, 0, 0);
    const current = generation.current;
    setCapturing(true);
    canvas.toBlob(
      (blob) => {
        if (current !== generation.current) return;
        setCapturing(false);
        if (!blob) {
          setError("ถ่ายรูปไม่ได้ กรุณาลองใหม่");
          return;
        }
        onCapture(blob, capturedAt);
        setOpen(false);
      },
      "image/jpeg",
      0.9,
    );
  };

  return (
    <div className="live-camera">
      {error && <p role="alert">{error}</p>}
      {open && !disabled ? (
        <>
          <video
            ref={video}
            autoPlay
            playsInline
            muted
            aria-label="ภาพจากกล้องสด"
            style={{ width: "100%", borderRadius: 12 }}
            onLoadedData={() => setReady(true)}
          />
          <button
            type="button"
            className="primary-action"
            disabled={!ready || capturing}
            onClick={capture}
          >
            ถ่ายรูป
          </button>
          <button
            type="button"
            className="secondary-action"
            onClick={() => setOpen(false)}
          >
            ปิดกล้อง
          </button>
        </>
      ) : (
        <button
          type="button"
          className="secondary-action"
          disabled={disabled}
          onClick={() => {
            setError("");
            setReady(false);
            setCapturing(false);
            setOpen(true);
          }}
        >
          เปิดกล้อง
        </button>
      )}
    </div>
  );
}
