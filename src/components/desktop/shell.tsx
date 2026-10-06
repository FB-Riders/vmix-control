import type { PanelState } from '@shared/state';
import { Caption } from '@/components/caption';
import { Indicator } from '@/components/live/status-header';
import { Badge } from '@/components/ui/badge';
import { useNow } from '@/hooks/use-now';
import { hhmmss } from '@/lib/time';
import { cn } from '@/lib/utils';

export type DesktopView = 'vor' | 'live' | 'pause' | 'nach';
const VIEWS: { id: DesktopView; label: string }[] = [
  { id: 'vor', label: 'VOR DEM SPIEL' },
  { id: 'live', label: 'LIVE' },
  { id: 'pause', label: 'PAUSE' },
  { id: 'nach', label: 'NACH DEM SPIEL' },
];

/** The phases of a match day as tabs across the top. */
function PhaseTabs({ view, streaming }: { view: DesktopView; streaming: boolean }) {
  return (
    <nav aria-label="Phase" className="grid grid-cols-4 border-b">
      {VIEWS.map((v, i) => (
        <a
          key={v.id}
          href={`#${v.id}`}
          aria-current={v.id === view ? 'page' : undefined}
          className={cn(
            'flex h-12 items-center justify-center gap-2.5 border-b-[3px] border-transparent text-[13px] font-medium tracking-widest text-dim',
            v.id === view && 'border-primary bg-card font-black text-foreground',
          )}
        >
          <span className="font-light tabular-nums">{i + 1}</span>
          {v.label}
          {v.id === 'live' && streaming && <span className="text-primary" aria-label="Stream läuft">●</span>}
        </a>
      ))}
    </nav>
  );
}

export function Label({ title, hint, live, className, children }: { title: string; hint?: string; live?: boolean; className?: string; children?: React.ReactNode }) {
  return (
    <div className={cn('flex h-5 items-center justify-between gap-2', className)}>
      <Caption className={cn('text-[13px]', live && 'font-black text-primary')}>{title}</Caption>
      {children ?? (hint && <span className="text-xs font-light text-muted-foreground tabular-nums">{hint}</span>)}
    </div>
  );
}

interface Props {
  state: PanelState;
  view: DesktopView;
  header?: React.ReactNode; // right of the team names
  footer: React.ReactNode | null;
  children: React.ReactNode; // the three columns
  embedded?: boolean; // inside the phone layout, which brings its own navigation
}

/** Frame of the three desktop screens: status header, watchdog bar, column grid, footer navigation. */
export function DesktopShell({ state, view, header, footer, children, embedded }: Props) {
  const now = useNow();
  const { health, score } = state;

  return (
    <div className={cn('flex flex-col', !embedded && 'min-h-dvh')}>
      {!embedded && <PhaseTabs view={view} streaming={state.streaming} />}
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b px-6 py-3.5">
        <div className="flex flex-wrap items-center gap-4">
          <Badge variant={state.streaming ? 'default' : 'secondary'} className="h-auto rounded-sm px-2.5 py-[5px] text-sm font-black tracking-widest">
            {state.streaming ? 'ON AIR' : 'OFF AIR'}
          </Badge>
          {score?.teams && <span className="text-[15px] font-light text-muted-foreground">{score.teams}</span>}
          {header}
        </div>
        <div className="flex flex-wrap items-center gap-5 text-[13px] font-medium text-muted-foreground">
          <Indicator label="STREAM" on={state.streaming} />
          <Indicator label="REC" on={state.recording} />
          <Indicator label="REPLAY" on={state.replayRecording} />
          {state.logos && <Indicator label="LOGOS" on={state.logos.visible} />}
          {health.loudness !== null && <span className="tabular-nums">TON ≈ {health.loudness.toFixed(1)} LUFS</span>}
          <span className="text-[15px] font-semibold text-foreground tabular-nums">{hhmmss(now)}</span>
        </div>
      </header>

      <div
        role="status"
        className={cn('flex flex-wrap items-center gap-x-5 gap-y-2 px-6 py-2.5 text-xs font-light', health.alerts.length ? 'bg-primary text-foreground' : 'bg-card text-muted-foreground')}
      >
        <span className="font-black tracking-widest text-foreground">{state.streaming ? 'WÄCHTER AKTIV' : 'WÄCHTER · startet mit dem Stream'}</span>
        {health.alerts.length
          ? health.alerts.map((a) => <span key={a} className="text-[13px] font-semibold">{a}</span>)
          : health.watches.map((w) => <span key={w}>{w}</span>)}
        {state.streaming && !health.alerts.length && <span className="ml-auto font-semibold text-foreground">alles im Soll ✓</span>}
      </div>

      <main className="grid grow grid-cols-[repeat(auto-fit,minmax(min(400px,100%),1fr))] content-start items-start gap-6 px-6 py-5">
        {children}
      </main>

      {state.warnings.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-t px-6 py-2 text-xs font-light text-muted-foreground">
          <span className="font-semibold text-foreground">config.json prüfen</span>
          {state.warnings.map((w) => <span key={w}>{w}</span>)}
        </div>
      )}

      <footer className="flex flex-wrap gap-x-6 gap-y-2 border-t px-6 py-3 text-xs font-light text-muted-foreground">
        {footer}
      </footer>
    </div>
  );
}
