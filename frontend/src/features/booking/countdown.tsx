'use client';
import { useEffect, useState } from 'react';

export function useCountdown(targetIso: string | null) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!targetIso) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [targetIso]);
  const ms = targetIso ? Math.max(0, new Date(targetIso).getTime() - now) : 0;
  return { ms, label: `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`, expired: !!targetIso && ms === 0 };
}
