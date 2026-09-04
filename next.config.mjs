/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep the local build cache outside the OneDrive `.next` reparse point.
  // Vercel's Next.js runtime expects the standard `.next` directory.
  distDir: process.env.NEXT_DIST_DIR ?? (process.env.VERCEL ? ".next" : ".next-killer"),
};

export default nextConfig;
