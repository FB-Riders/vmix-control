import type { PanelState } from '@shared/state';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export function Indicator({ label, on }: { label: string; on: boolean }) {
  return (
    <span className={cn(!on && 'text-dim')}>
      {label} <span className={on ? 'text-primary' : 'text-input'}>●</span>
    </span>
  );
}

export function StatusHeader({ state }: { state: PanelState }) {
  const { score, streaming } = state;
  const cam = state.cams.find((c) => c.program);
  const onAir = cam ? `CAM ${cam.id} · ${cam.role}` : state.programTitle || '–';

  return (
    <header className="flex flex-col gap-1.5 border-b px-4 pt-3.5 pb-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Badge
            variant={streaming ? 'default' : 'secondary'}
            className="h-auto rounded-sm px-[7px] py-[3px] text-xs font-black tracking-widest"
          >
            {streaming ? 'LIVE' : 'OFF AIR'}
          </Badge>
          {score && (score.home || score.away) && <span className="text-lg font-black">{score.home}:{score.away}</span>}
          {score && (
            <span className="truncate text-[13px] font-light text-muted-foreground">
              {[score.period, score.clock].filter(Boolean).join(' · ')}
            </span>
          )}
        </div>
        <div className="flex gap-2.5 text-[11px] font-medium whitespace-nowrap text-muted-foreground">
          <Indicator label="STREAM" on={streaming} />
          <Indicator label="REC" on={state.recording} />
          <Indicator label="RPL" on={state.replayRecording} />
        </div>
      </div>
      <span className="truncate text-[13px] font-medium text-muted-foreground">
        Auf Sendung: <span className="font-semibold text-foreground">{onAir}</span>
      </span>
    </header>
  );
}
