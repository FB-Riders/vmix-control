import { useEffect, useRef, useState } from 'react';
import { AblaufPage } from '@/components/ablauf/ablauf-page';
import { BreakPage } from '@/components/desktop/break-page';
import { DebugBar } from '@/components/debug-bar';
import { DesktopPage } from '@/components/desktop/desktop-page';
import { GfxPage } from '@/components/desktop/gfx-page';
import { NachPage } from '@/components/desktop/nach-page';
import type { DesktopView } from '@/components/desktop/shell';
import { VorPage } from '@/components/desktop/vor-page';
import { LivePage } from '@/components/live/live-page';
import { Toaster } from '@/components/ui/sonner';
import { useDebugOpen } from '@/hooks/use-debug';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { useMarking } from '@/hooks/use-marking';
import { useMediaQuery } from '@/hooks/use-media-query';
import { usePanel } from '@/hooks/use-panel';
import { cn } from '@/lib/utils';

// Phone navigation: the same three phases as on the desktop.
const TABS = [
  { id: 'ablauf', label: 'VOR' },
  { id: 'live', label: 'LIVE' },
  { id: 'grafik', label: 'GRAFIK' },
  { id: 'pause', label: 'PAUSE' },
  { id: 'nach', label: 'NACH' },
] as const;

const currentHash = () => window.location.hash.slice(1);

export default function App() {
  const { state, online } = usePanel();
  const [hash, setHash] = useState(currentHash);
  const marking = useMarking();
  const desktop = useMediaQuery('(min-width: 1000px)');
  const debug = useDebugOpen();

  useEffect(() => {
    const onHash = () => setHash(currentHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // Desktop: before kickoff the pre-game screen comes first; once everything is ticked and the stream runs, go live.
  const ready = !!state && state.streaming && state.pre.checklist.every((c) => c.done);
  const view: DesktopView = hash === 'nach' ? 'nach'
    : hash === 'pause' ? 'pause'
    : hash === 'grafik' ? 'grafik'
    : hash === 'live' ? 'live'
    : hash === 'vor' || hash === 'ablauf' ? 'vor'
    : state && state.now < state.pre.kickoff && !ready ? 'vor' : 'live';
  const wasReady = useRef(ready);
  useEffect(() => {
    if (ready && !wasReady.current && currentHash() === 'vor') window.location.hash = 'live';
    wasReady.current = ready;
  }, [ready]);

  // The break screen takes over while the break runs and hands back to live when it is ended.
  const breakActive = !!state?.breakRundown?.running;
  const wasBreak = useRef(breakActive);
  useEffect(() => {
    const h = currentHash();
    if (breakActive && !wasBreak.current && (h === 'live' || h === '')) window.location.hash = 'pause';
    if (!breakActive && wasBreak.current && h === 'pause') window.location.hash = 'live';
    wasBreak.current = breakActive;
  }, [breakActive]);

  useHotkeys(state, marking, desktop && view === 'live');

  const problem = !online ? 'KEINE VERBINDUNG ZUM REGIE-SERVER' : state && !state.connected ? 'KEINE VERBINDUNG ZU VMIX' : null;
  const banner = problem && (
    <div role="alert" className="bg-foreground p-1.5 text-center text-xs font-black tracking-widest text-background">{problem}</div>
  );

  if (desktop && !state) {
    return <div className="flex h-dvh items-center justify-center text-sm font-light text-muted-foreground">Verbinde …</div>;
  }

  if (desktop && state) {
    // The page scrolls in its own pane, so an open debug bar sits below it instead of floating over it.
    return (
      <div className="flex h-dvh flex-col">
        {banner}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {view === 'vor' ? <VorPage state={state} /> : view === 'grafik' ? <GfxPage state={state} /> : view === 'pause' ? <BreakPage state={state} /> : view === 'nach' ? <NachPage state={state} /> : <DesktopPage state={state} marking={marking} />}
        </div>
        {debug && <DebugBar className="h-[38dvh] shrink-0" />}
        <Toaster position="top-center" />
      </div>
    );
  }

  const tab = hash === 'nach' ? 'nach' : hash === 'grafik' ? 'grafik' : hash === 'pause' ? 'pause' : hash === 'ablauf' || hash === 'vor' ? 'ablauf' : 'live';
  return (
    <div className="mx-auto flex h-dvh max-w-[480px] flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      {state ? (
        tab === 'live' ? <LivePage state={state} marking={marking} />
          : tab === 'grafik' ? <div className="min-h-0 flex-1 overflow-y-auto"><GfxPage state={state} embedded /></div>
          : tab === 'pause' ? <div className="min-h-0 flex-1 overflow-y-auto"><BreakPage state={state} embedded /></div>
          : tab === 'nach' ? <div className="min-h-0 flex-1 overflow-y-auto"><NachPage state={state} embedded /></div>
          : <AblaufPage state={state} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-sm font-light text-muted-foreground">Verbinde …</div>
      )}

      {state?.health.alerts.map((a) => (
        <div key={a} role="alert" className="bg-primary px-3 py-1.5 text-center text-xs font-black">{a}</div>
      ))}
      {banner}
      {debug && <DebugBar className="h-[45dvh] shrink-0" />}

      <nav aria-label="Phase" className="grid h-14 shrink-0 grid-cols-5 border-t">
        {TABS.map((t) => (
          <a
            key={t.id}
            href={`#${t.id}`}
            aria-current={tab === t.id ? 'page' : undefined}
            className={cn(
              'flex items-center justify-center border-t-[3px] border-transparent text-[11px] font-medium tracking-wider text-muted-foreground',
              tab === t.id && 'border-primary font-black text-foreground',
            )}
          >
            {t.label}
          </a>
        ))}
      </nav>

      <Toaster position="top-center" />
    </div>
  );
}
