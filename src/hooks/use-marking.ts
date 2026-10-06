import { useEffect, useState } from 'react';
import { act } from '@/lib/api';

const TYPE_WINDOW_MS = 5000;

/** Marking a replay: one tap creates it, then its type can be picked for 5 s on the same device. */
export function useMarking() {
  const [pending, setPending] = useState<{ id: number; cams: string[] } | null>(null);

  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setPending(null), TYPE_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  async function mark(id: string) {
    const res = await act('replay/mark', { mark: id });
    if (res) setPending(res.result);
  }

  function pickType(type: string) {
    if (!pending) return;
    void act('replay/type', { id: pending.id, type });
    setPending(null);
  }

  return { pending, mark, pickType };
}

export type Marking = ReturnType<typeof useMarking>;
