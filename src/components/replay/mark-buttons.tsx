import type { ReplayState } from '@shared/state';
import { Button } from '@/components/ui/button';
import type { Marking } from '@/hooks/use-marking';
import { act } from '@/lib/api';
import { KEYS } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Props {
  replay: ReplayState;
  marking: Marking;
  recording: boolean; // vMix replay is recording; without it there is nothing to mark
  desktop?: boolean;
}

/** The mark buttons; after a mark they turn into the type picker for a few seconds. */
export function MarkButtons({ replay, marking, recording, desktop }: Props) {
  const height = desktop ? 'h-24' : 'h-[60px]';
  const keyHint = (key: string | undefined) => desktop && key && <span className="text-[11px] font-light tracking-normal">Taste {key}</span>;

  if (!recording) {
    return (
      <Button
        variant="outline"
        className={cn(height, 'flex-col gap-0.5 border-2 border-secondary border-b-primary bg-secondary font-black whitespace-normal', desktop ? 'text-xl' : 'text-[15px]')}
        onClick={() => act('toggle', { what: 'replayRec', on: true })}
      >
        ▶ REPLAY-AUFNAHME STARTEN
        <span className="text-[11px] font-light">läuft in vMix nicht, ohne sie gibt es keine Replays</span>
      </Button>
    );
  }

  if (marking.pending) {
    return (
      <div className={cn('grid grid-cols-4', desktop ? 'gap-3' : 'gap-1.5')}>
        {replay.types.map((t, i) => (
          <Button
            key={t}
            variant="secondary"
            className={cn(height, 'flex-col gap-0.5 font-black text-foreground', desktop ? 'text-lg' : 'text-[15px]')}
            onClick={() => marking.pickType(t)}
          >
            {t}
            {keyHint(KEYS.type[i])}
          </Button>
        ))}
      </div>
    );
  }

  return (
    <div className={cn('grid grid-cols-3', desktop ? 'gap-3' : 'gap-2')}>
      {replay.marks.map((m, i) => (
        <Button
          key={m.id}
          variant="outline"
          className={cn(height, 'flex-col gap-0.5 border-2 border-secondary border-b-primary bg-secondary font-black', desktop ? 'text-[22px]' : 'text-[17px] tracking-wide')}
          aria-label={`Replay markieren: ${m.sub}`}
          onClick={() => marking.mark(m.id)}
        >
          {m.label}
          <span className={cn('font-medium tracking-normal', desktop ? 'text-[13px]' : 'text-[11px]')}>{m.sub}</span>
          {keyHint(KEYS.mark[i])}
        </Button>
      ))}
    </div>
  );
}

/** Which period new replays are filed under: follow the scoreboard, or set it by hand. */
export function PeriodSelect({ replay }: { replay: ReplayState }) {
  const option = 'h-8 border px-0 text-xs font-black';
  const on = 'border-muted-foreground bg-muted-foreground text-background hover:bg-muted-foreground hover:text-background';
  const off = 'border-secondary bg-secondary';
  return (
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-xs font-light text-muted-foreground">Abschnitt</span>
      <div className="grid grow auto-cols-fr grid-flow-col gap-1.5">
        <Button
          variant="outline"
          className={cn(option, replay.periodAuto ? on : off)}
          aria-pressed={replay.periodAuto}
          aria-label="Abschnitt von der Matchuhr übernehmen"
          onClick={() => act('replay/period', { period: null })}
        >
          AUTO
        </Button>
        {replay.periods.map((p, i) => (
          <Button
            key={p.tab}
            variant="outline"
            className={cn(option, i === replay.period ? (replay.periodAuto ? 'border-muted-foreground bg-secondary' : on) : off)}
            aria-pressed={i === replay.period}
            aria-label={`Replays unter ${p.label} ablegen`}
            onClick={() => act('replay/period', { period: i })}
          >
            {p.short}
          </Button>
        ))}
      </div>
    </div>
  );
}
