import { useState } from 'react';
import type { PanelState } from '@shared/state';
import { Caption } from '@/components/caption';
import { SponsorAuto } from '@/components/sponsor';
import { Button } from '@/components/ui/button';
import { useNow } from '@/hooks/use-now';
import { act } from '@/lib/api';
import { hhmm, hhmmss, mmss, offsetLabel } from '@/lib/time';
import { cn } from '@/lib/utils';
import { ScheduleDialog } from './schedule-dialog';
import { StatusToggles } from './status-toggles';

export function AblaufPage({ state }: { state: PanelState }) {
  const now = useNow();
  const [dialogOpen, setDialogOpen] = useState(false);
  const { schedule } = state;
  const at = (offset: number) => schedule.anchor + offset * 1000;
  const nextIndex = schedule.steps.findIndex((s) => at(s.offset) > now);
  const next = schedule.steps[nextIndex];

  return (
    <>
      <header className="border-b">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 pt-4 pb-3 text-left active:opacity-60"
          aria-label="Ablauf und Zeit ändern"
          onClick={() => setDialogOpen(true)}
        >
          <span className="flex flex-col">
            <span className="text-[13px] font-light tracking-widest text-muted-foreground">{schedule.anchorLabel} {hhmm(schedule.anchor)}</span>
            <span className="text-2xl font-black tracking-wide text-primary">ABLAUF · {schedule.title}</span>
          </span>
          <span className="text-sm font-semibold tabular-nums">{hhmmss(now)}</span>
        </button>
      </header>

      <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        <section className="flex flex-col gap-2.5 rounded-md bg-primary p-3.5">
          {next ? (
            <>
              <div className="flex items-baseline justify-between">
                <Caption>NÄCHSTER SCHRITT IN</Caption>
                <span className="text-[28px] leading-none font-black tabular-nums">{mmss((at(next.offset) - now) / 1000)}</span>
              </div>
              <span className="text-xl leading-tight font-black">{next.hero}</span>
              {next.action && (
                <Button
                  className="h-12 bg-background text-[15px] font-black tracking-widest hover:bg-background"
                  onClick={() => act('schedule/action', { step: nextIndex })}
                >
                  ▶ {next.action}
                </Button>
              )}
            </>
          ) : (
            <>
              <Caption>ABLAUF BEENDET</Caption>
              {schedule.starts.length === 0 && <span className="text-xl leading-tight font-black">Oben den Ablauf wechseln.</span>}
              {schedule.starts.map((s) => (
                <Button
                  key={s.id}
                  className="h-14 flex-col gap-0.5 bg-background hover:bg-background"
                  onClick={() => act('schedule/start', { id: s.id })}
                >
                  <span className="text-[15px] font-black tracking-widest">▶ {s.label}</span>
                  {s.sub && <span className="text-xs font-light">{s.sub}</span>}
                </Button>
              ))}
            </>
          )}
        </section>

        <ol className="flex flex-col">
          {schedule.steps.map((s, i) => {
            const done = at(s.offset) <= now;
            const running = done && now < at(s.offset + s.durationSec);
            const isNext = i === nextIndex;
            return (
              <li key={i} className={cn('flex min-h-[38px] items-center gap-3 border-b py-2 last:border-b-0', done && 'text-muted-foreground')}>
                <span className={cn('w-14 shrink-0 text-[13px] font-semibold tabular-nums', isNext && 'font-black')}>{offsetLabel(s.offset)}</span>
                <span className={cn('grow text-sm font-light', isNext && 'font-semibold')}>{s.label}</span>
                {s.action && !isNext && (
                  <Button
                    variant="outline"
                    className="h-8 border-2 border-current bg-background px-3"
                    aria-label={s.action}
                    onClick={() => act('schedule/action', { step: i })}
                  >
                    ▶
                  </Button>
                )}
                {done && <span className="text-[13px] whitespace-nowrap">{running ? 'läuft' : '✓'}</span>}
              </li>
            );
          })}
        </ol>

        {state.sponsor && <SponsorAuto sponsor={state.sponsor} />}
        <StatusToggles state={state} />

        {state.warnings.length > 0 && (
          <section className="flex flex-col gap-0.5 text-xs font-light text-muted-foreground">
            <span className="font-semibold text-foreground">config.json prüfen</span>
            {state.warnings.map((w) => <span key={w}>{w}</span>)}
          </section>
        )}
      </main>

      {dialogOpen && <ScheduleDialog schedule={schedule} open onOpenChange={setDialogOpen} />}
    </>
  );
}
