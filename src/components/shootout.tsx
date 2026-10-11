import type { GfxSide } from '@shared/actions';
import type { ShootoutState } from '@shared/state';
import { Button } from '@/components/ui/button';
import { act } from '@/lib/api';
import { cn } from '@/lib/utils';

const soft = 'border-2 border-secondary bg-secondary font-black';

function Side({ side, name, shootout }: { side: GfxSide; name: string; shootout: ShootoutState }) {
  const { row, goals, attempts } = shootout[side];
  return (
    <div className="flex flex-col gap-2 rounded-md bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm font-semibold">{name}</span>
        <span className="shrink-0 text-xs font-light text-muted-foreground tabular-nums">{goals} Tore aus {attempts}</span>
      </div>
      {/* The circles as they are on screen: filled = scored, crossed = missed, empty = still open. */}
      <div className="flex gap-1.5" aria-label={`${name}: ${row.map((s) => (s === 'goal' ? 'Tor' : 'kein Tor')).join(', ') || 'noch kein Versuch'}`}>
        {Array.from({ length: shootout.slots }, (_, i) => (
          <span
            key={i}
            className={cn(
              'flex size-7 items-center justify-center rounded-full border-2 text-xs font-black',
              row[i] === 'goal' ? 'border-foreground bg-foreground text-background' : row[i] === 'miss' ? 'border-primary text-primary' : 'border-input',
            )}
          >
            {row[i] === 'goal' ? '●' : row[i] === 'miss' ? '✕' : ''}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
        <Button variant="outline" className={cn('h-11 px-0 text-[13px]', soft, 'bg-background')} onClick={() => act('shootout/shot', { team: side, result: 'goal' })}>TOR</Button>
        <Button variant="outline" className={cn('h-11 px-0 text-[13px]', soft, 'bg-background')} onClick={() => act('shootout/shot', { team: side, result: 'miss' })}>KEIN TOR</Button>
        <Button
          variant="outline"
          className="h-11 w-11 border-2 border-input bg-transparent p-0 text-base"
          disabled={row.length === 0}
          aria-label={`Letzten Versuch von ${name} zurücknehmen`}
          onClick={() => act('shootout/undo', { team: side })}
        >
          ↶
        </Button>
      </div>
    </div>
  );
}

/** Einblender screen: the penalty shoot-out display that takes the match clock's place, and its attempts. */
export function ShootoutPanel({ shootout, home, away }: { shootout: ShootoutState; home: string; away: string }) {
  return (
    <>
      <Button
        variant={shootout.live ? 'default' : 'outline'}
        className={cn('h-11 text-[13px] font-black', !shootout.live && soft)}
        aria-pressed={shootout.live}
        onClick={() => act('shootout/show', { on: !shootout.live })}
      >
        {shootout.live ? 'ZURÜCK ZUR MATCHUHR' : 'ANZEIGE STATT MATCHUHR EINBLENDEN'}
      </Button>
      <Side side="home" name={home} shootout={shootout} />
      <Side side="away" name={away} shootout={shootout} />
      <div className="grid grid-cols-2 gap-1.5">
        <Button variant="outline" className="h-9 border-2 border-input bg-transparent px-1 text-[11px] font-black" onClick={() => act('shootout/reset', { all: false })}>KREISE LEEREN</Button>
        <Button variant="outline" className="h-9 border-2 border-input bg-transparent px-1 text-[11px] font-black" onClick={() => act('shootout/reset', { all: true })}>ALLES ZURÜCKSETZEN</Button>
      </div>
      <span className="text-xs font-light text-muted-foreground">
        Nach fünf Versuchen pro Team leert der nächste Versuch die Kreise. Der Spielstand kommt weiter von der Anzeigetafel.
      </span>
    </>
  );
}
