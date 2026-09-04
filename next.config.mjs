/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep local caches outside the OneDrive `.next` reparse point, and keep
  // dev and production artifacts separate so webpack cannot load a stale
  // chunk while the other mode is rebuilding.
  distDir: process.env.NEXT_DIST_DIR ?? (process.env.VERCEL ? ".next" : process.env.NODE_ENV === "development" ? ".next-killer-dev" : ".next-killer"),
};

export default nextConfig;
