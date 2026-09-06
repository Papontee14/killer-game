"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, AlertCircle } from "lucide-react";
import jsQR from "jsqr";
import { Dialog } from "./game-ui";
import { parseRoomInvitationCode } from "@/src/game";

export function QrScannerDialog({
  onScanSuccess,
  onClose,
}: {
  onScanSuccess: (roomCode: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string>("");
  const [scanning, setScanning] = useState(false);
  const activeStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    let animationFrameId: number;
    let isCancelled = false;

    async function startCamera() {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          setError("เบราว์เซอร์นี้ไม่รองรับการเปิดกล้อง");
          return;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });

        if (isCancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        activeStreamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setScanning(true);
          requestScanFrame();
        }
      } catch (err) {
        if (isCancelled) return;
        const e = err as Error;
        if (e.name === "NotAllowedError" || e.name === "PermissionDeniedError") {
          setError("ไม่ได้รับอนุญาตให้ใช้กล้อง กรุณาเปิดสิทธิ์การใช้งานกล้องในการตั้งค่าของอุปกรณ์");
        } else {
          setError("ไม่สามารถเปิดกล้องได้: " + (e.message || "เกิดข้อผิดพลาด"));
        }
      }
    }

    function requestScanFrame() {
      if (isCancelled) return;
      animationFrameId = requestAnimationFrame(scanTick);
    }

    function scanTick() {
      if (isCancelled) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (ctx) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const decoded = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert",
          });

          if (decoded && decoded.data) {
            const detectedCode = parseRoomInvitationCode(decoded.data);
            if (detectedCode) {
              onScanSuccess(detectedCode);
              return;
            }
          }
        }
      }

      requestScanFrame();
    }

    startCamera();

    return () => {
      isCancelled = true;
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
      if (activeStreamRef.current) {
        activeStreamRef.current.getTracks().forEach((track) => track.stop());
        activeStreamRef.current = null;
      }
    };
  }, [onScanSuccess]);

  return (
    <Dialog title="สแกน QR เพื่อเข้าห้อง" onClose={onClose}>
      <div className="qr-scanner-container">
        {error ? (
          <div className="qr-scanner-error">
            <AlertCircle size={40} className="error-icon" />
            <p>{error}</p>
            <p className="scanner-help-text">
              คุณสามารถพิมพ์รหัสห้อง 6 หลักได้โดยตรงในหน้าแรก
            </p>
            <button className="secondary-action" onClick={onClose}>
              กลับไปพิมพ์รหัสเอง
            </button>
          </div>
        ) : (
          <>
            <div className="qr-video-wrapper">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className="qr-scanner-video"
              />
              <canvas ref={canvasRef} style={{ display: "none" }} />
              <div className="qr-viewfinder">
                <div className="viewfinder-box">
                  <div className="scan-line" />
                </div>
              </div>
            </div>
            <p className="scanner-instruction">
              ส่องกล้องไปที่ QR Code ชวนเพื่อนของ Host
            </p>
          </>
        )}
      </div>
    </Dialog>
  );
}
