"use client";
import { Brand } from "./brand";
import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";

const PrivacyContext = createContext(false);
export const usePrivacyHidden = () => useContext(PrivacyContext);
export function capturePrivateView() {
  return {
    focus: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    x: window.scrollX, y: window.scrollY,
    scroll: Array.from(document.querySelectorAll<HTMLElement>(".private-view *"))
      .filter(node => node.scrollTop || node.scrollLeft)
      .map(node => ({ node, top: node.scrollTop, left: node.scrollLeft })),
  };
}
export type PrivateViewSnapshot = ReturnType<typeof capturePrivateView>;

export function PrivacyBoundary({ hidden, snapshot, onReveal, children }: {
  hidden: boolean;
  snapshot: PrivateViewSnapshot | null;
  onReveal: () => void | Promise<void>;
  children: ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);
  const returnButton = useRef<HTMLButtonElement>(null);
  const wasHidden = useRef(false);
  const [revealing, setRevealing] = useState(false);
  useLayoutEffect(() => {
    content.current?.toggleAttribute("inert", hidden);
    if (hidden) {
      returnButton.current?.focus({ preventScroll: true });
    } else if (wasHidden.current) {
      // Dialogs reopen in their layout effects before restoring their scroll/focus.
      const frame = requestAnimationFrame(() => {
        const dialog = content.current?.querySelector<HTMLDialogElement>("dialog[open]");
        const previous = snapshot?.focus;
        const canRestore = previous?.isConnected && previous.getClientRects().length &&
          !previous.matches(":disabled") && (!dialog || dialog.contains(previous));
        const fallback = dialog?.querySelector<HTMLElement>("button:not(:disabled), input, select") ??
          content.current?.querySelector<HTMLElement>('[aria-label="ซ่อนหน้าจอ"], button, a');
        (canRestore ? previous : fallback)?.focus({ preventScroll: true });
        snapshot?.scroll.forEach(({ node, top, left }) => {
          if (node.isConnected) { node.scrollTop = top; node.scrollLeft = left; }
        });
        window.scrollTo({ left: snapshot?.x ?? 0, top: snapshot?.y ?? 0, behavior: "instant" });
      });
      wasHidden.current = hidden;
      return () => cancelAnimationFrame(frame);
    }
    wasHidden.current = hidden;
  }, [hidden, snapshot]);
  return <PrivacyContext.Provider value={hidden}>
    <div ref={content} className="private-view" hidden={hidden} aria-hidden={hidden || undefined}>{children}</div>
    {hidden && <main className="privacy-screen" role="dialog" aria-modal="true" aria-labelledby="privacy-screen-title">
      <Brand small />
      <h1 id="privacy-screen-title">ซ่อนหน้าจอแล้ว</h1>
      <button ref={returnButton} className="primary-action" disabled={revealing} aria-busy={revealing} onClick={async () => {
        setRevealing(true);
        try { await onReveal(); } finally { setRevealing(false); }
      }}>กลับเข้าเกม</button>
    </main>}
  </PrivacyContext.Provider>;
}
