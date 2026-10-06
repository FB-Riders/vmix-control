import type { ScheduleState } from '@shared/state';
import { Button } from '@/components/ui/button';
import { act } from '@/lib/api';
import { hhmm, hhmmss, offsetLabel } from '@/lib/time';
import { cn } from '@/lib/utils';

const small = 'h-7 border px-2 text-[11px] font-semibold';

/** Arms or disarms the automatic steps and nudges the run-down when the bully moves. */
export function RunDownControls({ schedule }: { schedule: ScheduleState }) {
  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="outline"
        className={cn(small, schedule.autoRun ? 'border-muted-foreground bg-muted-foreground text-background hover:bg-muted-foreground hover:text-background' : 'border-primary bg-transparent text-foreground')}
        aria-pressed={schedule.autoRun}
        onClick={() => act('schedule/auto', { enabled: !schedule.autoRun })}
      >
        AUTO {schedule.autoRun ? 'AN' : 'AUS'}
      </Button>
      <Button variant="outline" className={cn(small, 'border-secondary bg-secondary')} aria-label="Ablauf 1 Minute früher" onClick={() => act('schedule/shift', { minutes: -1, id: schedule.id })}>−1 Min</Button>
      <Button variant="outline" className={cn(small, 'border-secondary bg-secondary')} aria-label="Ablauf 1 Minute später" onClick={() => act('schedule/shift', { minutes: 1, id: schedule.id })}>+1 Min</Button>
    </div>
  );
}

/** The steps of the active run-down with their clock times; ▶ triggers a step by hand. During a test run it shows that run's progress instead. */
export function RunDownList({ schedule, now, compact, idle }: { schedule: ScheduleState; now: number; compact?: boolean; idle?: boolean }) {
  // idle: the run-down has not been started, so its steps have no clock time yet and are shown relative to its end.
  const { sim } = schedule;
  const at = (offset: number) => schedule.anchor + offset * 1000;
  const nextIndex = sim ? (sim.running ? sim.step : -1) : idle ? -1 : schedule.steps.findIndex((s) => at(s.offset) > now);
  return (
    <ol className="flex flex-col">
      {schedule.steps.map((s, i) => {
        const result = sim?.results[i];
        const past = sim ? !!result && i !== nextIndex : !idle && at(s.offset) <= now;
        const isNext = i === nextIndex;
        const failed = !!result && !result.ok;
        const hot = failed || (isNext && (!!sim || !s.auto)); // red tag: needs attention
        const tag = failed ? 'FEHLER' : sim ? (isNext ? 'läuft' : past ? '✓' : s.tag) : isNext && !s.auto ? 'jetzt' : past ? '✓' : s.tag;
        return (
          <li key={i} className={cn('flex items-center gap-3 border-b px-3', compact ? 'min-h-10 py-1' : 'min-h-14 py-2', isNext && 'bg-card', past && !failed && 'text-dim')}>
            <span className={cn('w-16 shrink-0 font-black tabular-nums', compact ? 'text-[13px]' : 'text-[15px]')}>
              {idle ? offsetLabel(s.offset) : s.offset % 60 === 0 ? hhmm(at(s.offset)) : hhmmss(at(s.offset))}
            </span>
            <div className="flex min-w-0 grow flex-col gap-0.5">
              <span className={cn('truncate font-semibold', compact ? 'text-[13px]' : 'text-sm')}>{s.label}</span>
              {failed ? <span className="text-xs font-medium">{result.text}</span> : !compact && <span className="text-xs font-light text-muted-foreground">{s.sub}</span>}
            </div>
            {s.action && !sim?.running && (
              <Button
                variant="outline"
                className={cn('border border-secondary bg-secondary px-2.5 text-[11px] font-semibold', compact ? 'h-7' : 'h-8', isNext && 'border-input bg-transparent')}
                aria-label={`${s.label} jetzt von Hand auslösen`}
                onClick={() => act('schedule/action', { step: i, id: schedule.id })}
              >
                ▶
              </Button>
            )}
            {tag && (
              <span className={cn('rounded-sm border px-2 py-[3px] text-[11px] font-black tracking-widest', hot ? 'border-primary bg-primary text-foreground' : past ? 'border-transparent' : 'border-input')}>
                {tag}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Starts, stops and sums up the test run of a run-down. */
export function TestRun({ schedule, streaming, what }: { schedule: ScheduleState; streaming: boolean; what: string }) {
  const { sim } = schedule;
  const total = schedule.steps.length;
  const failed = sim?.results.filter((r) => !r.ok).length ?? 0;
  const finished = !!sim && !sim.running;

  return (
    <div className="flex items-center gap-3 rounded-md bg-card p-3">
      <div className="flex min-w-0 grow flex-col gap-0.5">
        <span className="text-[13px] font-semibold">
          {sim?.running ? `Probelauf läuft · Schritt ${sim.step + 1} von ${total}`
            : finished ? (sim.step < total ? 'Probelauf abgebrochen' : failed ? `Probelauf fertig · ${failed} Schritt${failed === 1 ? '' : 'e'} mit Fehler` : 'Probelauf fertig · alle Schritte ausgelöst')
            : 'Probelauf'}
        </span>
        <span className="text-xs leading-relaxed font-light text-muted-foreground">
          {sim?.running ? 'Wartezeiten sind gekürzt, Clips laufen in voller Länge.'
            : finished ? 'vMix hat die Befehle angenommen; Bild und Ton selbst im Multiview prüfen.'
            : `Spielt ${what} im Zeitraffer in vMix durch: Clips, Kamerawechsel, Ton. Nur ohne laufenden Stream.`}
        </span>
      </div>
      <Button
        variant="outline"
        disabled={streaming && !sim}
        className={cn('h-11 shrink-0 border-2 px-3.5 text-xs font-black', sim ? 'border-secondary bg-background' : 'border-muted-foreground bg-muted-foreground text-background hover:bg-muted-foreground hover:text-background')}
        onClick={() => (sim ? act('sim/stop') : act('sim/start', { schedule: schedule.id }))}
      >
        {sim?.running ? 'STOPPEN' : finished ? 'SCHLIESSEN' : '▶ PROBELAUF'}
      </Button>
    </div>
  );
}
