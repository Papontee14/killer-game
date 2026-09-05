"use client";

import { useRef, useState, type ChangeEvent } from "react";

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      if (image.naturalWidth && image.naturalHeight) resolve(image);
      else reject(new Error("รูปภาพไม่มีขนาดที่ใช้งานได้"));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("ไม่สามารถอ่านไฟล์รูปภาพนี้ได้"));
    };
    image.src = url;
  });
}

function canvasToJpeg(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("ไม่สามารถแปลงรูปเป็น JPEG ได้"));
      },
      "image/jpeg",
      0.95,
    );
  });
}

export async function prepareCameraPhoto(file: File) {
  if (!file.size || !file.type.startsWith("image/"))
    throw new Error("กรุณาถ่ายรูปจากกล้องก่อนส่ง");

  const image = await loadImage(file);
  if (file.type.toLowerCase() === "image/jpeg") return file;

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("ไม่สามารถเตรียมรูปสำหรับส่งได้");
  context.drawImage(image, 0, 0);
  return canvasToJpeg(canvas);
}

export function NativeCamera({
  disabled,
  onOpen,
  onCapture,
  onError,
}: {
  disabled: boolean;
  onOpen: () => void;
  onCapture: (photo: Blob, capturedAt: string) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [processing, setProcessing] = useState(false);

  const openCamera = () => {
    if (disabled || processing) return;
    onOpen();
    input.current?.click();
  };

  const receivePhoto = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const capturedAt = new Date().toISOString();
    setProcessing(true);
    try {
      await onCapture(await prepareCameraPhoto(file), capturedAt);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : "ไม่สามารถเตรียมรูปภาพได้");
    } finally {
      setProcessing(false);
    }
  };

  return (
    <>
      <input
        ref={input}
        className="camera-input"
        type="file"
        accept="image/*"
        capture="environment"
        disabled={disabled || processing}
        aria-label="ถ่ายรูปจากกล้องมือถือ"
        onChange={receivePhoto}
      />
      <button
        type="button"
        className="secondary-action camera-capture-button"
        disabled={disabled || processing}
        onClick={openCamera}
      >
        {processing ? "กำลังเตรียมรูป..." : "เปิดกล้องมือถือ"}
      </button>
    </>
  );
}
