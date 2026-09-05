'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LandingGame } from '@/components/landing-game';
import { readActiveRoom } from '@/src/room-session';
import { Hourglass } from 'lucide-react';

export default function HomePage() {
  const router = useRouter();
  const [resuming, setResuming] = useState(true);

  useEffect(() => {
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

  return <LandingGame />;
}
