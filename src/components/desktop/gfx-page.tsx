import { useRef, useState } from 'react';
import { toast } from 'sonner';
import type { GfxRequest, GfxSide } from '@shared/actions';
import type { GfxState, GfxTeam, OverlayState, PanelState } from '@shared/state';
import { Caption } from '@/components/caption';
import { Button } from '@/components/ui/button';
import { ScoreboardMode, ScoreboardPanel } from '@/components/scoreboard';
import { ShootoutPanel } from '@/components/shootout';
import { SponsorPanel } from '@/components/sponsor';
import { Input } from '@/components/ui/input';
import { useNow } from '@/hooks/use-now';
import { act } from '@/lib/api';
import { GFX_KEYS, penaltyKey } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DesktopShell, Label } from './shell';

const show = (req: GfxRequest) => act('gfx/show', req);
const soft = 'border-2 border-secondary bg-secondary font-black';
const picked = 'border-muted-foreground bg-muted-foreground text-background hover:bg-muted-foreground hover:text-background';

/** Reads a config file whatever its encoding: TCunihockey accepts UTF-8, UTF-16 and ANSI. */
async function readText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return new TextDecoder('windows-1252').decode(bytes); }
}

function Team({ side, team, gfx, manual }: { side: GfxSide; team: GfxTeam; gfx: GfxState; manual: boolean }) {
  const [nr, setNr] = useState<string | null>(null);
  const player = team.players.find((p) => p.nr === nr);
  const six = gfx.live?.kind === 'startingSix' && gfx.live.team === side ? gfx.live.six : null;
  const action = 'h-11 px-0 text-[13px]';

  return (
    <div className="flex flex-col gap-3">
      <Label title={`${side === 'home' ? 'HEIM' : 'GAST'} · ${team.long.toUpperCase()}`} hint={team.short} />

      <div className="flex flex-col gap-2">
        <span className="text-xs font-light text-muted-foreground">
          {player ? `${player.nr} · ${player.name}${player.top ? ' · Topskorer' : ''}` : manual ? 'Spielerin wählen. TOR zählt +1, die Uhr läuft weiter. Strafe: mit Spielerin Einblender und Uhr, ohne nur Uhr.' : 'Spielerin wählen, dann Einblender'}
        </span>
        <div className="grid grid-cols-8 gap-1.5">
          {team.players.map((p) => (
            <Button
              key={p.nr}
              variant="outline"
              className={cn('h-10 border px-0 text-sm font-black tabular-nums', p.nr === nr ? picked : 'border-secondary bg-secondary')}
              aria-pressed={p.nr === nr}
              aria-label={`${p.nr} ${p.name}`}
              title={p.name}
              onClick={() => setNr(p.nr === nr ? null : p.nr)}
            >
              {p.nr}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          <Button className="h-11 text-[13px] font-black" disabled={!nr} onClick={() => show({ kind: 'goal', team: side, player: nr ?? undefined })}>{manual ? 'TOR +1' : 'TOR'}</Button>
          <Button variant="outline" className={cn(action, soft)} disabled={!nr} onClick={() => show({ kind: 'name', team: side, player: nr ?? undefined })}>NAME</Button>
          <Button variant="outline" className={cn(action, soft)} disabled={!nr} onClick={() => show({ kind: 'bestPlayer', team: side, player: nr ?? undefined })}>BEST PLAYER</Button>
        </div>
        <div className="grid auto-cols-fr grid-flow-col gap-1.5">
          {gfx.penalties.map((p) => (
            <Button
              key={p}
              variant="outline"
              className={cn(action, soft)}
              disabled={!nr && !manual}
              aria-label={nr || !manual ? `Strafe ${p}` : `Strafe ${p} nur auf die Matchuhr`}
              // By hand without a player: the penalty only goes on the clock (e.g. a bench penalty).
              onClick={() => (nr ? show({ kind: 'penalty', team: side, player: nr, value: p }) : act('scoreboard/addPenalty', { team: side, label: p }))}
            >
              {p}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <Button variant="outline" className={cn(action, soft)} onClick={() => show({ kind: 'goal', team: side, player: 'own' })}>{manual ? 'EIGENTOR +1' : 'EIGENTOR'}</Button>
          <Button variant="outline" className={cn(action, soft)} onClick={() => show({ kind: 'timeout', team: side })}>TIME OUT</Button>
        </div>
      </div>

      {/* Before the game. */}
      <Label title="VOR DEM SPIEL" className="mt-3" />
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

function Key({ keys, children }: { keys: string; children: string }) {
  return <span><span className="font-semibold text-foreground">{keys}</span> {children}</span>;
}

/** Everything that goes on one vMix overlay channel, under a heading that says what the channel shows right now. */
function Group({ channel, title, overlays, action, className, children }: { channel: number; title: string; overlays: OverlayState[]; action?: React.ReactNode; className?: string; children?: React.ReactNode }) {
  const o = overlays.find((x) => x.channel === channel);
  const status = o?.on ? (o.text && o.text !== o.role ? o.text : 'eingeblendet') : o?.paused ? 'kommt von selbst zurück' : 'aus';
  return (
    <section aria-label={`Overlay ${channel}: ${title}`} className={cn('flex min-w-0 flex-col gap-3', className)}>
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-b-2 border-muted-foreground pb-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-[15px] font-black tracking-widest">{title}</span>
          <span className={cn('truncate text-xs tabular-nums', o?.on ? 'font-semibold' : 'font-light text-muted-foreground')}>
            <span className={o?.on ? 'text-primary' : 'text-input'}>●</span> Overlay {channel} · {status}
          </span>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** On-screen graphics from the game config: opener, people, line-ups, starting six, goals, penalties, results. */
export function GfxPage({ state, embedded }: { state: PanelState; embedded?: boolean }) {
  const { gfx } = state;
  const fileInput = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [shootoutOpen, setShootoutOpen] = useState(false);
  const now = useNow();

  async function load(file: File | undefined) {
    if (!file) return;
    const res = await act('gfx/import', { text: await readText(file) });
    if (res) {
      const { game, sponsors } = res.result;
      toast.success(`«${file.name}» geladen: ${[game && 'Spiel', sponsors > 0 && `${sponsors} Sponsoren`].filter(Boolean).join(' und ')}`);
    }
    if (fileInput.current) fileInput.current.value = '';
  }

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

  const { scoreboard, shootout, sponsor, overlays } = state;
  const names = { home: gfx.home?.long ?? 'Heim', away: gfx.away?.long ?? 'Gast' };
  const teams = !!gfx.home && !!gfx.away;
  const clockChannel = shootout?.overlay ?? overlays.find((o) => o.role === 'Matchuhr')?.channel ?? 1;
  const logoChannel = overlays.find((o) => o.role === 'Logos')?.channel;
  const clockPenalties = gfx.penalties.map(penaltyKey).filter(Boolean).join(' ');
  const left = 'min-[1000px]:col-start-1';
  const small = cn('h-9 shrink-0 px-2.5 text-[11px]', soft);
  const config = (
    <section className={cn('flex flex-col gap-3', left)}>
      <Label title="SPIEL-KONFIGURATION" />
      <div className="flex items-center gap-3 rounded-md bg-card p-3">
        <div className="flex min-w-0 grow flex-col gap-0.5">
          <span className="truncate text-sm font-semibold">{teams ? `${names.home} – ${names.away}` : 'Keine Spiel-Konfiguration geladen'}</span>
          <span className="truncate text-xs font-light text-muted-foreground">
            {game ? [game.date, game.time, game.location].filter(Boolean).join(' · ') : 'game-config.txt von unihockey.live/generator'}
          </span>
        </div>
        <Button variant="outline" className={cn('h-11 shrink-0 px-3 text-xs', game ? cn(soft, 'bg-background') : picked)} onClick={() => fileInput.current?.click()}>
          {game ? 'NEU LADEN' : 'KONFIG LADEN'}
        </Button>
      </div>
    </section>
  );

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
          {scoreboard?.manual && (
            <>
              <Key keys={GFX_KEYS.run}>Uhr Start / Stopp</Key>
              <Key keys={GFX_KEYS.second}>±1 s, mit ⇧ ±10 s</Key>
              <Key keys={`${GFX_KEYS.home} ${GFX_KEYS.away}`}>Tor Heim / Gast, mit ⇧ ein Tor weg</Key>
              {clockPenalties && <Key keys={clockPenalties}>Strafe Heim auf die Uhr, mit ⇧ Gast</Key>}
            </>
          )}
        </>
      )}
    >
      {/* Wide: the Einblender (overlay 2) fill the right two thirds, the other overlays stack on the left. */}
      <div className="grid items-start gap-x-6 gap-y-8 min-[1000px]:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] min-[1000px]:grid-rows-[auto_auto_auto_auto_1fr]">
        <input ref={fileInput} type="file" accept=".txt,text/plain" className="hidden" onChange={(e) => load(e.target.files?.[0])} />

        {/* Without a game there is little to show: loading it comes first. */}
        {!game && config}

        {scoreboard && (
          <Group
            channel={clockChannel}
            title="MATCHUHR"
            overlays={overlays}
            className={left}
            action={!shootout?.live && (
              <Button variant="outline" className={small} aria-pressed={scoreboard.onAir} onClick={() => act('scoreboard/show', { on: !scoreboard.onAir })}>
                {scoreboard.onAir ? 'AUSBLENDEN' : 'EINBLENDEN'}
              </Button>
            )}
          >
            <ScoreboardMode scoreboard={scoreboard} />
            {scoreboard.manual && <ScoreboardPanel scoreboard={scoreboard} teams={names} add={teams ? undefined : gfx.penalties} />}
            {shootout && (
              <>
                <Label title="PENALTY-SCHIESSEN" className="mt-3">
                  {!shootout.live && (
                    <Button variant="outline" className={cn(small, 'h-8 bg-background')} aria-expanded={shootoutOpen} onClick={() => setShootoutOpen(!shootoutOpen)}>
                      {shootoutOpen ? 'ZUKLAPPEN' : 'AUFKLAPPEN'}
                    </Button>
                  )}
                </Label>
                {shootout.live || shootoutOpen
                  ? <ShootoutPanel shootout={shootout} home={names.home} away={names.away} />
                  : <span className="text-xs font-light text-muted-foreground">Die Anzeige mit fünf Kreisen pro Team kommt anstelle der Matchuhr ins Bild.</span>}
              </>
            )}
          </Group>
        )}

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

          {game && (
            <>
              <Label title="RESULTAT" hint={gfx.score ? `${gfx.score.home}:${gfx.score.away} ${gfx.periods}` : 'Matchuhr nicht lesbar'} />
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
            <div className="mt-3 grid items-start gap-6 min-[1000px]:grid-cols-2">
              <Team side="home" team={gfx.home} gfx={gfx} manual={!!scoreboard?.manual} />
              <Team side="away" team={gfx.away} gfx={gfx} manual={!!scoreboard?.manual} />
            </div>
          ) : (
            <span className="text-sm leading-relaxed font-light text-muted-foreground">
              Sobald eine Spiel-Konfiguration geladen ist, stehen hier Tor, Strafe, Name und Best Player für die Spielerinnen beider Teams, dazu Aufstellung, Starting 6 und Coach.
            </span>
          )}

          <div className="mt-3 grid items-start gap-6 min-[1000px]:grid-cols-2">
            <div className="flex flex-col gap-3">
              <Label title="FREIER TEXT" />
              <div className="flex gap-2">
                <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Text für den Einblender" className="h-11 border-2 text-sm" aria-label="Freier Text" />
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
            action={<Button variant="outline" className={small} onClick={() => fileInput.current?.click()}>LISTE LADEN</Button>}
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

        {game && config}
      </div>
    </DesktopShell>
  );
}
