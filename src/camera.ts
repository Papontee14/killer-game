/** Capture an actual live frame. File-input capture remains the mobile fallback. */
export async function captureLivePhoto() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("อุปกรณ์นี้ไม่รองรับกล้อง");
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  try {
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    await video.play();
    await new Promise<void>((resolve) => { if (video.readyState >= 2) resolve(); else video.onloadeddata = () => resolve(); });
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    return { dataUrl: canvas.toDataURL("image/jpeg", 0.88), capturedAt: new Date().toISOString() };
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}
