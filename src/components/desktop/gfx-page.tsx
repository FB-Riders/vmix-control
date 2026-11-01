import { useState } from 'react';
import type { GfxRequest, GfxSide } from '@shared/actions';
import type { GfxState, GfxTeam, PanelState } from '@shared/state';
import { Caption } from '@/components/caption';
import { useConfigFile } from '@/components/game-config';
import { Button } from '@/components/ui/button';
import { ClockNotice } from '@/components/scoreboard';
import { SponsorPanel } from '@/components/sponsor';
import { Input } from '@/components/ui/input';
import { useNow } from '@/hooks/use-now';
import { act } from '@/lib/api';
import { GFX_KEYS, penaltyKey } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DesktopShell, Group, Key, Label } from './shell';

const show = (req: GfxRequest) => act('gfx/show', req);
const soft = 'border-2 border-secondary bg-secondary font-black';
const picked = 'border-muted-foreground bg-muted-foreground text-background hover:bg-muted-foreground hover:text-background';

/** During the game, in reading order: which team, which player, what happened. Afterwards it starts over at the team. */
function PlayerEvents({ home, away, gfx, manual, counts }: { home: GfxTeam; away: GfxTeam; gfx: GfxState; manual: boolean; counts: boolean }) {
  const [side, setSide] = useState<GfxSide | null>(null);
  const [nr, setNr] = useState<string | null>(null);
  const team = side === 'home' ? home : side === 'away' ? away : null;
  const player = team?.players.find((p) => p.nr === nr);
  const action = 'h-11 px-0 text-[13px]';

  function pick(next: GfxSide) {
    setSide(next === side ? null : next); // the picked team again: back to the start
    setNr(null);
  }
  /** A failed action keeps the choice, so it can simply be tried again. */
  async function fire(run: Promise<unknown>) {
    if (!await run) return;
    setSide(null);
    setNr(null);
  }

  return (
    <div className="mt-3 flex flex-col gap-3">
      <Label title="1 · TEAM" />
      <div className="grid grid-cols-2 gap-1.5">
        {([['home', 'HEIM', home], ['away', 'GAST', away]] as const).map(([id, label, t]) => (
          <Button key={id} variant="outline" className={cn('h-14 min-w-0 flex-col gap-0 border-2 px-2', side === id ? picked : 'border-secondary bg-secondary')} aria-pressed={side === id} onClick={() => pick(id)}>
            <span className="text-[11px] font-medium tracking-widest">{label}</span>
            <span className="max-w-full truncate text-sm font-black">{t.long.toUpperCase()}</span>
          </Button>
        ))}
      </div>

      <Label title="2 · SPIELERIN" className="mt-1" hint={player ? `${player.nr} · ${player.name}${player.top ? ' · Topskorer' : ''}` : undefined} />
      {team ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-1.5">
          {team.players.map((p) => (
            <Button
              key={p.nr}
              variant="outline"
              className={cn('h-11 min-w-0 justify-start gap-2 border px-2', p.nr === nr ? picked : 'border-secondary bg-secondary')}
              aria-pressed={p.nr === nr}
              title={p.name}
              onClick={() => setNr(p.nr === nr ? null : p.nr)}
            >
              <span className="w-6 shrink-0 text-right text-sm font-black tabular-nums">{p.nr}</span>
              <span className="truncate text-xs font-medium">{p.name}</span>
            </Button>
          ))}
        </div>
      ) : (
        <span className="text-xs font-light text-muted-foreground">Zuerst das Team wählen.</span>
      )}

      <Label title="3 · EREIGNIS" className="mt-1" />
      <span className="text-xs font-light text-muted-foreground">
        {manual ? 'TOR zählt +1, die Uhr läuft weiter. Strafe: mit Spielerin Einblender und Uhr, ohne nur Uhr.' : counts ? 'TOR zählt +1 auf der Matchuhr.' : 'Ein Knopf blendet direkt ein.'}
      </span>
      <div className="grid grid-cols-3 gap-1.5">
        <Button className="h-11 text-[13px] font-black" disabled={!player} onClick={() => side && fire(show({ kind: 'goal', team: side, player: nr ?? undefined }))}>{counts ? 'TOR +1' : 'TOR'}</Button>
        <Button variant="outline" className={cn(action, soft)} disabled={!player} onClick={() => side && fire(show({ kind: 'name', team: side, player: nr ?? undefined }))}>NAME</Button>
        <Button variant="outline" className={cn(action, soft)} disabled={!player} onClick={() => side && fire(show({ kind: 'bestPlayer', team: side, player: nr ?? undefined }))}>BEST PLAYER</Button>
      </div>
      <div className="grid auto-cols-fr grid-flow-col gap-1.5">
        {gfx.penalties.map((p) => (
          <Button
            key={p}
            variant="outline"
            className={cn(action, soft)}
            disabled={!side || (!player && !manual)}
            aria-label={player || !manual ? `Strafe ${p}` : `Strafe ${p} nur auf die Matchuhr`}
            // By hand without a player: the penalty only goes on the clock (e.g. a bench penalty).
            onClick={() => side && fire(player ? show({ kind: 'penalty', team: side, player: player.nr, value: p }) : act('scoreboard/addPenalty', { team: side, label: p }))}
          >
            {p}
          </Button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <Button variant="outline" className={cn(action, soft)} disabled={!side} onClick={() => side && fire(show({ kind: 'goal', team: side, player: 'own' }))}>{counts ? 'EIGENTOR +1' : 'EIGENTOR'}</Button>
        <Button variant="outline" className={cn(action, soft)} disabled={!side} onClick={() => side && fire(show({ kind: 'timeout', team: side }))}>TIME OUT</Button>
      </div>
    </div>
  );
}

/** Before the game, per team: line-up, coach, starting six. */
function TeamPrep({ side, team, gfx }: { side: GfxSide; team: GfxTeam; gfx: GfxState }) {
  const six = gfx.live?.kind === 'startingSix' && gfx.live.team === side ? gfx.live.six : null;
  const action = 'h-11 px-0 text-[13px]';

  return (
    <div className="flex flex-col gap-3">
      <Label title={`VOR DEM SPIEL · ${side === 'home' ? 'HEIM' : 'GAST'}`} hint={team.short} />
      <div className="grid grid-cols-2 gap-1.5">
        <Button variant="outline" className={cn(action, soft)} onClick={() => show({ kind: 'lineup', team: side })}>AUFSTELLUNG</Button>
        <Button variant="outline" className={cn(action, soft)} disabled={!team.coach} onClick={() => show({ kind: 'coach', team: side })}>COACH</Button>
      </div>
      <div className="flex flex-col gap-2 rounded-md bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <Caption>STARTING 6</Caption>
          <span className="text-xs font-light text-muted-foreground">{six && six.shown === 0 ? 'Team-Logo ist eingeblendet' : 'aus der Spiel-Konfiguration'}</span>
        </div>
        <ol className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs">
          {team.startingSix.map((p, i) => (
            <li key={i} className={cn('flex gap-2 truncate', six && i < six.shown ? 'font-semibold' : 'font-light text-muted-foreground')}>
              <span className="w-5 shrink-0 text-right tabular-nums">{p.top ? '★' : p.nr}</span>
              <span className="truncate">{p.name}</span>
            </li>
          ))}
        </ol>
        {six ? (
          <div className="grid grid-cols-[2fr_1fr] gap-2">
            <Button className="h-11 min-w-0 text-[13px] font-black" disabled={six.shown >= six.total} onClick={() => act('gfx/next')}>
              <span className="truncate">{six.shown >= six.total ? `ALLE ${six.total} GEZEIGT` : `▶ ${team.startingSix[six.shown]?.name ?? 'NÄCHSTE'} (${six.shown + 1}/${six.total})`}</span>
            </Button>
            <Button variant="outline" className={cn('h-11 text-[13px]', soft, 'bg-background')} onClick={() => act('gfx/hide')}>ENDE</Button>
          </div>
        ) : (
          <Button variant="outline" className={cn('h-11 text-[13px]', soft, 'bg-background')} disabled={team.startingSix.length === 0} onClick={() => show({ kind: 'startingSix', team: side })}>
            STARTING 6 EINBLENDEN
          </Button>
        )}
      </div>
    </div>
  );
}

/** On-screen graphics from the game config: opener, people, line-ups, starting six, goals, penalties, results. */
export function GfxPage({ state, embedded }: { state: PanelState; embedded?: boolean }) {
  const { gfx } = state;
  const sponsorFile = useConfigFile();
  const [text, setText] = useState('');
  const now = useNow();

  if (!gfx) {
    return (
      <DesktopShell state={state} view="grafik" embedded={embedded} footer={null}>
        <span className="text-sm font-light text-muted-foreground">In config.json sind keine Einblender hinterlegt (Abschnitt «graphics»).</span>
      </DesktopShell>
    );
  }

  const { game, live } = gfx;
  const people = (kind: 'commentators' | 'referees', title: string, names: string[]) => (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-light text-muted-foreground">{title}: {names.join(', ') || 'nicht in der Konfiguration'}</span>
      <div className="grid grid-cols-3 gap-1.5">
        <Button variant="outline" className={cn('h-11 px-0 text-[13px]', soft)} disabled={names.length === 0} onClick={() => show({ kind })}>{names.length > 1 ? 'BEIDE' : 'EINBLENDEN'}</Button>
        {names.length > 1 && names.map((n, i) => (
          <Button key={n} variant="outline" className={cn('h-11 px-1 text-xs', soft)} onClick={() => show({ kind, value: String(i + 1) })}>
            <span className="truncate">{n.split(' ').at(-1)?.toUpperCase()}</span>
          </Button>
        ))}
      </div>
    </div>
  );

  const { scoreboard, sponsor, overlays } = state;
  const logoChannel = overlays.find((o) => o.role === 'Logos')?.channel;
  const clockPenalties = gfx.penalties.map(penaltyKey).filter(Boolean).join(' ');
  const left = 'min-[1000px]:col-start-1';
  const small = cn('h-9 shrink-0 px-2.5 text-[11px]', soft);

  return (
    <DesktopShell
      state={state}
      view="grafik"
      embedded={embedded}
      footer={embedded ? <span>Jede Gruppe ist ein Overlay von vMix: pro Overlay ist immer nur eines aufs Mal im Bild.</span> : (
        <>
          <Key keys={GFX_KEYS.hide}>Einblender aus</Key>
          <Key keys={GFX_KEYS.next}>Starting 6 weiter</Key>
          {scoreboard && <Key keys={GFX_KEYS.clock}>Matchuhr ein / aus</Key>}
          {scoreboard?.counts && <Key keys={`${GFX_KEYS.home} ${GFX_KEYS.away}`}>Tor Heim / Gast, mit ⇧ ein Tor weg</Key>}
          {scoreboard?.manual && (
            <>
              <Key keys={GFX_KEYS.run}>Uhr Start / Stopp</Key>
              <Key keys={GFX_KEYS.second}>±1 s, mit ⇧ ±10 s</Key>
              {clockPenalties && <Key keys={clockPenalties}>Strafe Heim auf die Uhr, mit ⇧ Gast</Key>}
            </>
          )}
        </>
      )}
    >
      {/* Wide: the Einblender (overlay 2) fill the right two thirds, the other overlays stack on the left. */}
      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-x-6 gap-y-8 min-[1000px]:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] min-[1000px]:grid-rows-[auto_auto_auto_auto_1fr]">
        {sponsorFile.input}

        <Group channel={gfx.overlay} title="EINBLENDER" overlays={overlays} className="min-[1000px]:col-start-2 min-[1000px]:row-span-5 min-[1000px]:row-start-1">
          {live ? (
            <Button className="h-20 flex-col gap-0.5 whitespace-normal" onClick={() => act('gfx/hide')}>
              <span className="text-xl font-black tracking-wide">AUSBLENDEN</span>
              <span className="text-[13px] font-medium tabular-nums">{live.summary}{live.until ? ` · geht in ${Math.max(0, Math.ceil((live.until - now) / 1000))} s von selbst weg` : ' · bleibt, bis ausgeblendet'}</span>
            </Button>
          ) : (
            <div className="flex h-20 flex-col justify-center gap-0.5 rounded-md bg-card px-4">
              <span className="text-xl font-black">Nichts eingeblendet</span>
              <span className="text-[13px] font-light text-muted-foreground">Ein Knopf blendet direkt ein. Hier wieder ausblenden.</span>
            </div>
          )}

          {scoreboard && <ClockNotice scoreboard={scoreboard} />}

          {gfx.home && gfx.away && <PlayerEvents home={gfx.home} away={gfx.away} gfx={gfx} manual={!!scoreboard?.manual} counts={!!scoreboard?.counts} />}

          {game && (
            <>
              <Label title="RESULTAT" className="mt-3" hint={gfx.score ? `${gfx.score.home}:${gfx.score.away} ${gfx.periods}` : 'Matchuhr nicht lesbar'} />
              <div className="grid grid-cols-3 gap-1.5 min-[1000px]:grid-cols-6">
                {gfx.results.map((r) => (
                  <Button key={r.id} variant="outline" className={cn('h-11 px-1 text-[11px] whitespace-normal', soft)} disabled={!gfx.score} onClick={() => show({ kind: 'result', value: r.id })}>
                    {r.label.replace('Resultat ', '').replace('Schlussresultat', 'Schluss').toUpperCase()}
                  </Button>
                ))}
              </div>
            </>
          )}

          {gfx.home && gfx.away ? (
            <>
              <div className="mt-3 grid grid-cols-[minmax(0,1fr)] items-start gap-6 min-[1000px]:grid-cols-2">
                <TeamPrep side="home" team={gfx.home} gfx={gfx} />
                <TeamPrep side="away" team={gfx.away} gfx={gfx} />
              </div>
            </>
          ) : (
            <span className="text-sm leading-relaxed font-light text-muted-foreground">
              Sobald eine Spiel-Konfiguration geladen ist (im Tab <a href="#vor" className="font-semibold underline underline-offset-2">Vor dem Spiel</a>), stehen hier Tor, Strafe, Name und Best Player für die Spielerinnen beider Teams, dazu Aufstellung, Starting 6 und Coach.
            </span>
          )}

          <div className="mt-3 grid grid-cols-[minmax(0,1fr)] items-start gap-6 min-[1000px]:grid-cols-2">
            <div className="flex flex-col gap-3">
              <Label title="FREIER TEXT" />
              <div className="flex gap-2">
                <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Text für den Einblender" className="h-11 border-2 text-base min-[1000px]:text-sm" aria-label="Freier Text" />
                <Button variant="outline" className={cn('h-11 shrink-0 px-3 text-xs', soft)} disabled={!text.trim()} onClick={() => show({ kind: 'text', text })}>EINBLENDEN</Button>
              </div>
              {gfx.shortcuts.map((s) => (
                <Button key={s} variant="outline" className={cn('h-auto min-h-11 justify-start px-3 py-1.5 text-left text-xs font-medium whitespace-normal', soft)} onClick={() => show({ kind: 'text', text: s })}>
                  {s}
                </Button>
              ))}
            </div>
            {game && (
              <div className="flex flex-col gap-3">
                <Label title="SPIEL UND PERSONEN" />
                <Button variant="outline" className={cn('h-11 text-[13px]', soft)} onClick={() => show({ kind: 'opener' })}>OPENER · SPIELDATEN</Button>
                {people('commentators', 'Kommentar', game.commentators)}
                {people('referees', 'Schiedsrichter', game.referees)}
              </div>
            )}
          </div>
        </Group>

        {sponsor && (
          <Group
            channel={sponsor.overlay}
            title="SPONSOREN"
            overlays={overlays}
            className={left}
            action={<Button variant="outline" className={small} onClick={sponsorFile.open}>LISTE LADEN</Button>}
          >
            <SponsorPanel sponsor={sponsor} />
          </Group>
        )}

        {state.logos && logoChannel !== undefined && (
          <Group
            channel={logoChannel}
            title="LIGA-LOGOS"
            overlays={overlays}
            className={left}
            action={(
              <Button variant="outline" className={small} aria-pressed={state.logos.visible} onClick={() => act('toggle', { what: 'logos', on: !state.logos?.visible })}>
                {state.logos.visible ? 'AUSBLENDEN' : 'EINBLENDEN'}
              </Button>
            )}
          >
            <span className="text-xs font-light text-muted-foreground">Müssen während der ganzen Übertragung im Bild sein: auch im Vorlauf, in den Pausen, bei Interviews und über Werbung. Nur für den Liga-Trailer nimmt sie das Panel weg und bringt sie danach zurück.</span>
          </Group>
        )}
      </div>
    </DesktopShell>
  );
}
