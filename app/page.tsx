'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LandingGame } from '@/components/landing-game';
import { readActiveRoom } from '@/src/room-session';
import { Hourglass } from 'lucide-react';

export default function HomePage() {
  const router = useRouter();
  const [resuming, setResuming] = useState(true);
  const [inviteCode, setInviteCode] = useState('');

  useEffect(() => {
    const invitation = new URLSearchParams(window.location.search).get('room')?.toUpperCase() ?? '';
    if (/^[A-Z0-9]{6}$/.test(invitation)) {
      setInviteCode(invitation);
      setResuming(false);
      return;
    }
    const active = readActiveRoom();
    if (active && active.code) {
      if (active.role === 'host') {
        router.replace(`/room/${active.code}/host`);
      } else {
        router.replace(`/room/${active.code}`);
      }
    } else {
      setResuming(false);
    }
  }, [router]);

  if (resuming) {
    return (
      <main className='loading-screen'>
        <Hourglass /> กำลังกลับเข้าห้องเดิม...
      </main>
    );
  }

  return <LandingGame initialCode={inviteCode} />;
}
