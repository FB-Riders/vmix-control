import type { PanelState } from '@shared/state';
import { AudioPresetButton, AudioSources } from '@/components/audio';
import { Caption } from '@/components/caption';
import { ProgramRow, PreviewRow } from '@/components/live/camera-bus';
import { MarkButtons } from '@/components/replay/mark-buttons';
import { ReplayList } from '@/components/replay/replay-list';
import { SponsorRow } from '@/components/sponsor';
import { Button } from '@/components/ui/button';
import type { Marking } from '@/hooks/use-marking';
import { useNow } from '@/hooks/use-now';
import { act } from '@/lib/api';
import { camsLabel, KEYS } from '@/lib/format';
import { mmss } from '@/lib/time';
import { ControllingList } from './controlling';
import { RunDownControls } from './run-down';
import { DesktopShell, Label } from './shell';

function Key({ keys, children }: { keys: string; children: string }) {
  return <span><span className="font-semibold text-foreground">{keys}</span> {children}</span>;
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex h-14 flex-col justify-center rounded-md border-2 border-foreground px-3">
      <span className="text-xl leading-tight font-black tabular-nums">{value}</span>
      <span className="text-[11px] font-light text-muted-foreground">{label}</span>
    </div>
  );
}

/** The big tile at the top of the run-down column: whatever the operator has to trigger next. */
function NextAction({ state, now }: { state: PanelState; now: number }) {
  const { schedule } = state;
  const nextIndex = schedule.steps.findIndex((s) => schedule.anchor + s.offset * 1000 > now);
  const next = schedule.steps[nextIndex];
  const tile = 'h-24 flex-col gap-0.5 whitespace-normal';

  if (next?.action) {
    return (
      <Button className={tile} onClick={() => act('schedule/action', { step: nextIndex })}>
        <span className="text-xl font-black tracking-wide">▶ {next.action}</span>
        <span className="text-[13px] font-medium">{next.hero}</span>
        {next.auto && <span className="text-[11px] font-light">{schedule.autoRun ? 'läuft automatisch, Knopf nur als Notfall' : 'AUTO ist aus: von Hand auslösen'}</span>}
      </Button>
    );
  }
  if (next) {
    return (
      <div className="flex h-24 flex-col justify-center gap-0.5 rounded-md bg-card px-4">
        <Caption>ALS NÄCHSTES</Caption>
        <span className="text-xl leading-tight font-black">{next.hero}</span>
        <span className="text-[11px] font-light text-muted-foreground">{next.sub}</span>
      </div>
    );
  }
  if (schedule.starts.length === 0) {
    return <div className="flex h-24 items-center rounded-md bg-card px-4 text-xl font-black">Ablauf beendet</div>;
  }
  return (
    <>
      {schedule.starts.map((s) => (
        <Button key={s.id} className={tile} onClick={() => act('schedule/start', { id: s.id })}>
          <span className="text-xl font-black tracking-wide">▶ {s.label}</span>
          {s.sub && <span className="text-[13px] font-medium">{s.sub}</span>}
          {s.note && <span className="text-[11px] font-light">{s.note}</span>}
        </Button>
      ))}
    </>
  );
}

/** During the game, on the vMix computer: everything on one screen, with keyboard shortcuts. */
export function DesktopPage({ state, marking }: { state: PanelState; marking: Marking }) {
  const now = useNow();
  const { score, replay, audio, sponsor, schedule, health } = state;
  const { pending } = marking;
  const pgm = state.cams.find((c) => c.program);
  const pvw = state.cams.find((c) => c.preview && !c.program);
  const next = schedule.steps.find((s) => schedule.anchor + s.offset * 1000 > now);
  const n = state.cams.length;
  const signed = (v: number) => `${v > 0 ? '+' : ''}${v}`;

  return (
    <DesktopShell
      state={state}
      view="live"
      badge="LIVE"
      header={
        <>
          {score && (score.home || score.away) && <span className="text-[28px] leading-none font-black">{score.home}:{score.away}</span>}
          {score && <span className="text-[15px] font-semibold">{[score.period, score.clock].filter(Boolean).join(' · ')}</span>}
        </>
      }
      footer={
        <>
          <Key keys={KEYS.program.slice(0, n).join(' ')}>live</Key>
          <Key keys={KEYS.preview.slice(0, n).join(' ')}>Preview</Key>
          <Key keys={KEYS.mark.slice(0, replay.marks.length).join(' ')}>Replay markieren</Key>
          <Key keys={KEYS.type.slice(0, replay.types.length).join(' ')}>Typ</Key>
          {sponsor && <Key keys={KEYS.sponsor}>Sponsor</Key>}
          {audio && <Key keys={`${KEYS.audioGame} ${KEYS.audioPause}`}>Ton Spiel / Pause</Key>}
        </>
      }
    >
      {/* Run-down, audio, sponsor, controlling */}
      <div className="flex flex-col gap-3">
        <Label title={next ? `ABLAUF · in ${mmss((schedule.anchor + next.offset * 1000 - now) / 1000)}` : `ABLAUF · ${schedule.title}`}>
          <RunDownControls schedule={schedule} />
        </Label>
        <NextAction state={state} now={now} />

        {audio && (
          <>
            <Label title="TON" hint="Master-Limiter in vMix: max −1 dBTP" className="mt-3" />
            <div className="grid grid-cols-2 gap-3">
              <AudioPresetButton audio={audio} preset="game" desktop />
              <AudioPresetButton audio={audio} preset="pause" desktop />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Stat value={health.loudness !== null ? `≈ ${health.loudness.toFixed(1)} LUFS` : '–'} label={`Lautheit geschätzt · Ziel ${health.loudnessTarget}`} />
              <Stat value={health.commentaryOverAtmo !== null ? `${signed(health.commentaryOverAtmo)} dB` : '–'} label={`Kommentar über Atmo · Ziel ${signed(health.commentaryTarget)}`} />
            </div>
            <AudioSources audio={audio} />
          </>
        )}
        {sponsor && <SponsorRow sponsor={sponsor} />}
        <ControllingList items={state.controlling.filter((c) => !c.post)} title="CONTROLLING HEUTE" hint="wie swiss unihockey prüft" />
      </div>

      {/* Cameras */}
      <div className="flex flex-col gap-3">
        <Label title="LIVE" hint="1 Klick = harter Schnitt" live />
        <ProgramRow cams={state.cams} desktop />
        <Label title="PREVIEW" hint="nächste Kamera vorbereiten" className="mt-3" />
        <PreviewRow cams={state.cams} desktop />
        <div className="grid grid-cols-2 gap-3">
          <div className="flex h-24 flex-col justify-center gap-0.5 rounded-md bg-primary px-4">
            <Caption>AUF SENDUNG</Caption>
            <span className="truncate text-[26px] leading-tight font-black">{pgm ? `CAM ${pgm.id}` : state.programTitle || '–'}</span>
            <span className="text-[13px] font-medium">{pgm?.role}</span>
          </div>
          <div className="flex h-24 flex-col justify-center gap-0.5 rounded-md bg-foreground px-4 text-background">
            <Caption>ALS NÄCHSTES</Caption>
            <span className="text-[26px] leading-tight font-black">{pvw ? `CAM ${pvw.id}` : '–'}</span>
            <span className="text-[13px] font-medium">{pvw?.role}</span>
          </div>
        </div>
        <span className="text-xs font-light text-muted-foreground">Bild kontrollieren: im vMix-Multiview auf dem zweiten Bildschirm.</span>
      </div>

      {/* Replays */}
      <div className="flex flex-col gap-3">
        <Label
          title={pending ? `MARKIERT ${camsLabel(pending.cams)} · WAS WAR ES?` : 'REPLAY MARKIEREN'}
          hint={pending ? `sonst nach 5 s: ${replay.defaultType}` : `${replay.seconds} s zurück`}
        />
        <MarkButtons replay={replay} marking={marking} recording={state.replayRecording} desktop />
        <Label title="LETZTE REPLAYS" hint={`★ = Highlight-Video · ${replay.highlightCount} Szenen`} className="mt-3" />
        <ReplayList replay={replay} visible={6} currentPeriod={score?.period ?? ''} desktop />
        <span className="text-xs leading-relaxed font-light text-muted-foreground">
          Tore landen automatisch im Highlight-Video, alles andere mit ★. Abspielen immer mit Stinger, Matchuhr ausgeblendet.
        </span>
      </div>
    </DesktopShell>
  );
}
