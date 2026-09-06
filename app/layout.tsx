import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import './globals.css';
import './pwa.css';
import './redesign.css';
import { PwaRegister } from '@/components/pwa-register';

const pixelFont = localFont({
  src: './fonts/TA 8 bit.ttf',
  weight: '400',
  display: 'swap',
  variable: '--font-pixel',
});

export const metadata: Metadata = {
  title: 'Killer | เกมล่าบทบาทลับ',
  description: 'เกม Killer สำหรับเล่นกับกลุ่มเพื่อนผ่านโทรศัพท์คนละเครื่อง',
  applicationName: 'Killer',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Killer',
  },
  icons: {
    icon: '/icon-192.png',
    apple: '/apple-touch-icon.png',
  },
};
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#061210',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang='th' className={pixelFont.variable}>
      <body className={pixelFont.className}>
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
