import type { SVGProps, ButtonHTMLAttributes } from "react";

const paths = {
  arrow: "M13 3h3v3h3v3h3v6h-3v3h-3v3h-3v-6H2V9h11V3zm0 6v6h3V9h-3z",
  back: "M8 3h3v6h11v6H11v6H8v-3H5v-3H2V9h3V6h3V3z",
  users: "M4 2h6v3h2v5h-2v3H4v-3H2V5h2V2zm10 2h5v3h2v5h-2v2h-5v-3h2V7h-2V4zM4 15h6v2h3v5H1v-5h3v-2zm11 1h4v2h3v4h-7v-6z",
  crown: "M1 5h3v3h3v3h3V4h4v7h3V8h3V5h3v12H1V5zm2 14h18v3H3v-3z",
  book: "M1 3h8v2h6V3h8v17h-8v2H9v-2H1V3zm3 3v11h5v-9H7V6H4zm11 2v9h5V6h-3v2h-2z",
  heart: "M3 3h6v3h6V3h6v3h3v9h-3v3h-3v3h-3v3H9v-3H6v-3H3v-3H0V6h3V3z",
  home: "M10 1h4v3h3v3h3v3h3v3h-3v10h-6v-7h-4v7H4V13H1v-3h3V7h3V4h3V1z",
  signal: "M2 4h3v16H2V4zm6 4h3v8H8V8zm5-6h3v20h-3V2zm6 5h3v10h-3V7z",
  gear: "M9 1h6v4h3V3h3v6h3v6h-3v6h-3v-2h-3v4H9v-4H6v2H3v-6H0V9h3V3h3v2h3V1zm0 7v8h6V8H9z",
  evidence: "M5 1h14v3h3v19H2V4h3V1zm3 3v3h8V4H8zm-3 7v3h3v-3H5zm6 0v3h8v-3h-8zm-6 6v3h3v-3H5zm6 0v3h8v-3h-8z",
};

export function PixelIcon({ name, size = 24, ...props }: SVGProps<SVGSVGElement> & { name: keyof typeof paths; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke={name === "heart" ? "currentColor" : undefined} strokeWidth={1} aria-hidden="true" shapeRendering="crispEdges" {...props}><path fillRule="evenodd" d={paths[name]} /></svg>;
}

export function PixelButton({ variant = "secondary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" }) {
  return <button type="button" className={`${variant}-action pixel-button ${className}`} {...props} />;
}

/** Public ID only: appearance never depends on a secret role or health. */
export function PlayerAvatar({ id }: { id: string }) {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const index = (hash >>> 0) % 8;
  // Decorative: the adjacent player name provides the accessible identity.
  // eslint-disable-next-line @next/next/no-img-element
  return <span className="avatar"><img src={`/pixel/avatar-${index}.webp`} alt="" width={48} height={48} loading="lazy" /></span>;
}
