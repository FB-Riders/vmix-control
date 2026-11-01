import type { PanelState } from '@shared/state';
import { BodetStatus, ScoreboardMode, ScoreboardPanel, ScoreCount } from '@/components/scoreboard';
import { ShootoutPanel } from '@/components/shootout';
import { Button } from '@/components/ui/button';
import { act } from '@/lib/api';
import { GFX_KEYS, penaltyKey } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DesktopShell, Group, Key, Label } from './shell';

const small = 'h-9 shrink-0 border-2 border-secondary bg-secondary px-2.5 text-[11px] font-black';

/** The match clock, its source, the score and the penalty shoot-out. Rarely needed while the hall's scoreboard delivers. */
export function ClockPage({ state, embedded }: { state: PanelState; embedded?: boolean }) {
  const { scoreboard, shootout, overlays, gfx } = state;

  if (!scoreboard) {
    return (
      <DesktopShell state={state} view="matchuhr" embedded={embedded} footer={null}>
        <span className="text-sm font-light text-muted-foreground">In config.json ist keine Matchuhr hinterlegt (Abschnitt «scoreboard»).</span>
      </DesktopShell>
    );
  }

  const names = { home: gfx?.home?.long ?? 'Heim', away: gfx?.away?.long ?? 'Gast' };
  const channel = shootout?.overlay ?? overlays.find((o) => o.role === 'Matchuhr')?.channel ?? 1;
  const clockPenalties = gfx?.penalties.map(penaltyKey).filter(Boolean).join(' ');

  return (
    <DesktopShell
      state={state}
      view="matchuhr"
      embedded={embedded}
      footer={embedded ? null : (
        <>
          <Key keys={GFX_KEYS.clock}>Matchuhr ein / aus</Key>
          {scoreboard.counts && <Key keys={`${GFX_KEYS.home} ${GFX_KEYS.away}`}>Tor Heim / Gast, mit ⇧ ein Tor weg</Key>}
          {scoreboard.manual && (
            <>
              <Key keys={GFX_KEYS.run}>Uhr Start / Stopp</Key>
              <Key keys={GFX_KEYS.second}>±1 s, mit ⇧ ±10 s</Key>
              {clockPenalties && <Key keys={clockPenalties}>Strafe Heim auf die Uhr, mit ⇧ Gast</Key>}
            </>
          )}
        </>
      )}
    >
      <Group
        channel={channel}
        title="MATCHUHR"
        overlays={overlays}
        action={!shootout?.live && (
          <Button variant="outline" className={cn(small)} aria-pressed={scoreboard.onAir} onClick={() => act('scoreboard/show', { on: !scoreboard.onAir })}>
            {scoreboard.onAir ? 'AUSBLENDEN' : 'EINBLENDEN'}
          </Button>
        )}
      >
        <ScoreboardMode scoreboard={scoreboard} />
        {!scoreboard.manual && <BodetStatus scoreboard={scoreboard} teams={names} />}
        {scoreboard.manual && <ScoreboardPanel scoreboard={scoreboard} teams={names} add={gfx?.penalties} />}
      </Group>

      <div className="flex min-w-0 flex-col gap-3">
        {scoreboard.counts && (
          <>
            <Label title="SPIELSTAND" />
            <ScoreCount scoreboard={scoreboard} teams={names} />
          </>
        )}
        {shootout && (
          <>
            <Label title="PENALTY-SCHIESSEN" className={scoreboard.counts ? 'mt-3' : undefined} />
            <ShootoutPanel shootout={shootout} home={names.home} away={names.away} />
          </>
        )}
      </div>
    </DesktopShell>
  );
}
