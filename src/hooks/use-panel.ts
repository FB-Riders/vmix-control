import { useEffect, useState } from 'react';
import type { PanelState } from '@shared/state';

let skew = 0; // server clock minus this phone's clock

/** Current time on the server's clock, so every phone shows the same countdowns. */
export const serverNow = () => Date.now() + skew;

/** Live panel state, pushed by the server over server-sent events. */
export function usePanel() {
  const [state, setState] = useState<PanelState | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onmessage = (e) => {
      const next = JSON.parse(e.data as string) as PanelState;
      skew = next.now - Date.now();
      setState(next);
      setOnline(true);
    };
    es.onerror = () => setOnline(false); // EventSource reconnects on its own
    return () => es.close();
  }, []);

  return { state, online };
}
