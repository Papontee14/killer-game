import type { Metadata, Viewport } from "next";
import { Noto_Sans_Thai } from "next/font/google";
import "./globals.css";
import { PwaRegister } from "@/components/pwa-register";

const notoSansThai = Noto_Sans_Thai({ subsets: ["thai", "latin"], weight: ["400", "500", "600", "700", "800", "900"], display: "swap", variable: "--font-noto-thai" });

export const metadata: Metadata = { title: "Killer | เกมล่าบทบาทลับ", description: "เกม Killer สำหรับเล่นกับกลุ่มเพื่อนผ่านโทรศัพท์คนละเครื่อง", applicationName: "Killer", manifest: "/manifest.webmanifest" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, themeColor: "#0d0f12" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="th" className={notoSansThai.variable}><body className={notoSansThai.className}><PwaRegister />{children}</body></html>; }
