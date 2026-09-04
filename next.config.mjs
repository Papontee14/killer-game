/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep Next's generated cache outside the OneDrive `.next` reparse point.
  distDir: ".next-killer",
};

export default nextConfig;
