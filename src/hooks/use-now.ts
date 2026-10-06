import { useEffect, useState } from 'react';
import { serverNow } from './use-panel';

/** Server time in ms, re-rendering the caller a few times per second for clocks and countdowns. */
export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
