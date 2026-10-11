import { useState } from 'react';
import type { GfxSide } from '@shared/actions';
import type { ManualScoreboardState } from '@shared/state';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useNow } from '@/hooks/use-now';
import { act } from '@/lib/api';
import { cn } from '@/lib/utils';

const soft = 'border-2 border-secondary bg-secondary font-black';
const plain = 'border-2 border-input bg-transparent font-black';
const two = (n: number) => String(n).padStart(2, '0');
const clock = (seconds: number) => `${two(Math.floor(seconds / 60))}:${two(seconds % 60)}`;
const PERIOD_NAMES: Record<string, string> = { O: 'Verlängerung', P: 'Penalty-Schiessen' };

/** Game time and penalties as they are on screen right now: the server gives them as of the moment the clock was started. */
function useClock(sb: ManualScoreboardState) {
  const now = useNow(100);
  const elapsed = Math.min(sb.limitMs, sb.elapsedMs + (sb.runningSince === null ? 0 : Math.max(0, now - sb.runningSince)));
  const ran = elapsed - sb.elapsedMs;
  const left = (ms: number) => Math.ceil(Math.max(0, ms - ran) / 1000);
  return { seconds: Math.floor(elapsed / 1000), penalties: { home: sb.penalties.home.map(left), away: sb.penalties.away.map(left) } };
}

/** Clock by hand: score and the two penalty slots of one team. */
export function ScoreboardTeam({ side, name, scoreboard: sb, add }: { side: GfxSide; name: string; scoreboard: ManualScoreboardState; add?: string[] }) {
  const penalties = useClock(sb).penalties[side];
  return (
    <div className="flex flex-col gap-2 rounded-md bg-card p-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 grow truncate text-sm font-semibold">{name}</span>
        <Button variant="outline" className={cn('h-11 w-11 p-0 text-base', plain)} disabled={sb.score[side] === 0} aria-label={`${name}: ein Tor abziehen`} onClick={() => act('scoreboard/goal', { team: side, delta: -1 })}>−1</Button>
        <span className="w-9 text-center text-2xl font-black tabular-nums" aria-label={`${name}: ${sb.score[side]} Tore`}>{sb.score[side]}</span>
        <Button variant="outline" className={cn('h-11 w-14 p-0 text-base', soft, 'bg-background')} aria-label={`${name}: ein Tor dazu`} onClick={() => act('scoreboard/goal', { team: side, delta: 1 })}>+1</Button>
      </div>
      {/* Penalties are started with the penalty buttons below; here they only run and can be taken off. */}
      <div className="grid grid-cols-2 gap-1.5">
        {penalties.map((seconds, i) => (
          <div key={i} className={cn('flex h-9 items-center justify-between rounded-md border-2 pr-0.5 pl-2', seconds > 0 ? 'border-foreground' : 'border-input')}>
            <span className={cn('text-[13px] tabular-nums', seconds > 0 ? 'font-black' : 'font-light text-muted-foreground')} aria-label={`Strafe ${i + 1}: ${seconds > 0 ? clock(seconds) : 'frei'}`}>
              {seconds > 0 ? clock(seconds) : 'keine Strafe'}
            </span>
            {seconds > 0 && (
              <Button variant="ghost" className="h-7 w-7 p-0 text-xs" aria-label={`${name}, Strafe ${i + 1} löschen`} onClick={() => act('scoreboard/penalty', { team: side, slot: i + 1, seconds: 0 })}>✕</Button>
            )}
          </div>
        ))}
      </div>
      {/* Only where there are no penalty buttons of a team column (no game config loaded). */}
      {add && (
        <div className="grid auto-cols-fr grid-flow-col gap-1.5">
          {add.map((label) => (
            <Button key={label} variant="outline" className={cn('h-9 px-0 text-xs', soft, 'bg-background')} aria-label={`${name}: Strafe ${label} auf die Matchuhr`} onClick={() => act('scoreboard/addPenalty', { team: side, label })}>
              {label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The central switch: who fills the match clock, the hall's scoreboard (Bodet) or the operator. */
export function ScoreboardMode({ scoreboard: sb }: { scoreboard: ManualScoreboardState }) {
  const option = (manual: boolean, title: string, sub: string) => {
    const on = sb.manual === manual;
    return (
      <Button
        variant="outline"
        className={cn('h-14 flex-col gap-0 border-2 px-1', on ? 'border-muted-foreground bg-muted-foreground text-background hover:bg-muted-foreground hover:text-background' : 'border-secondary bg-secondary')}
        aria-pressed={on}
        onClick={() => { if (!on) void act('scoreboard/mode', { manual }); }}
      >
        <span className="text-[13px] font-black">{title}</span>
        <span className="text-[11px] font-medium">{sub}</span>
      </Button>
    );
  };
  return (
    <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Quelle der Matchuhr">
      {option(false, 'ANZEIGETAFEL', 'Bodet füllt die Matchuhr')}
      {option(true, 'VON HAND', 'Regie führt Zeit und Spielstand')}
    </div>
  );
}

/**
 * Clock by hand: game time, period, score and penalties of both teams, reset. `add` puts penalty buttons under the
 * teams, for when there are no team columns with penalty buttons (no game config loaded).
 */
export function ScoreboardPanel({ scoreboard: sb, teams, add }: { scoreboard: ManualScoreboardState; teams: { home: string; away: string }; add?: string[] }) {
  const { seconds } = useClock(sb);
  const [time, setTime] = useState('');
  const [resetting, setResetting] = useState(false);
  const running = sb.runningSince !== null;
  const typed = time.trim().match(/^(\d{1,2}):([0-5]\d)$/);

  return (
    <>
      <div className="grid grid-cols-[1fr_auto] items-stretch gap-2">
        <Button className={cn('h-20 flex-col gap-0', !running && soft)} variant={running ? 'default' : 'outline'} aria-pressed={running} onClick={() => act('scoreboard/run', { on: !running })}>
          <span className="text-3xl leading-none font-black tabular-nums">{clock(seconds)}</span>
          <span className="text-[11px] font-black tracking-wide">{running ? 'LÄUFT · STOPP' : seconds * 1000 >= sb.limitMs ? 'ABSCHNITT ZU ENDE' : 'STEHT · START'}</span>
        </Button>
        <div className="grid w-[104px] grid-cols-2 gap-1">
          {[-10, 10, -1, 1].map((n) => (
            <Button key={n} variant="outline" className={cn('h-full px-0 text-xs', plain)} aria-label={`Spielzeit ${Math.abs(n)} Sekunden ${n < 0 ? 'zurück' : 'vor'}`} onClick={() => act('scoreboard/adjust', { seconds: n })}>
              {n > 0 ? `+${n}` : `−${-n}`} s
            </Button>
          ))}
        </div>
      </div>

      <div className="grid auto-cols-fr grid-flow-col gap-1.5" role="group" aria-label="Spielabschnitt. Ein Wechsel stellt die Zeit auf 00:00, Strafen bleiben">
        {sb.periods.map((p) => (
          <Button
            key={p}
            variant="outline"
            className={cn('h-10 border-2 px-0 text-[13px] font-black', p === sb.period ? 'border-muted-foreground bg-muted-foreground text-background hover:bg-muted-foreground hover:text-background disabled:opacity-100' : 'border-secondary bg-secondary')}
            aria-pressed={p === sb.period}
            aria-label={PERIOD_NAMES[p] ?? `${p}. Drittel`}
            disabled={p === sb.period}
            onClick={() => act('scoreboard/period', { period: p })}
          >
            {p}
          </Button>
        ))}
      </div>

      <ScoreboardTeam side="home" name={teams.home} scoreboard={sb} add={add} />
      <ScoreboardTeam side="away" name={teams.away} scoreboard={sb} add={add} />

      <div className="flex gap-2">
        <Input value={time} onChange={(e) => setTime(e.target.value)} placeholder="Zeit setzen, z. B. 12:30" inputMode="numeric" className="h-9 border-2 text-sm tabular-nums" aria-label="Spielzeit als Minuten und Sekunden" />
        <Button
          variant="outline"
          className={cn('h-9 shrink-0 px-3 text-xs', soft)}
          disabled={!typed || running}
          onClick={async () => { if (typed && await act('scoreboard/time', { seconds: Number(typed[1]) * 60 + Number(typed[2]) })) setTime(''); }}
        >
          {running ? 'ERST STOPPEN' : 'SETZEN'}
        </Button>
      </div>

      <Button
        variant="outline"
        className={cn('h-10 px-1 text-xs', resetting ? 'border-2 border-primary bg-primary font-black' : plain)}
        onClick={() => {
          if (!resetting) { setResetting(true); setTimeout(() => setResetting(false), 3000); return; }
          setResetting(false);
          void act('scoreboard/reset');
        }}
      >
        {resetting ? 'WIRKLICH ALLES AUF 0?' : 'SPIEL ZURÜCKSETZEN'}
      </Button>
    </>
  );
}
