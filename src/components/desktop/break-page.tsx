import { useState } from 'react';
import type { PanelState } from '@shared/state';
import { AudioPresetButton, AudioSources } from '@/components/audio';
import { Caption } from '@/components/caption';
import { SponsorAuto, SponsorRow } from '@/components/sponsor';
import { Button } from '@/components/ui/button';
import { useNow } from '@/hooks/use-now';
import { act } from '@/lib/api';
import { hhmm, mmss } from '@/lib/time';
import { cn } from '@/lib/utils';
import { RunDownControls, RunDownList, TestRun } from './run-down';
import { DesktopShell, Label } from './shell';

const LENGTHS = [10, 12, 15];

/** The break: start it with one button, watch its run-down, audio and sponsors; everything else runs by itself. */
export function BreakPage({ state, embedded }: { state: PanelState; embedded?: boolean }) {
  const now = useNow();
  const rundown = state.breakRundown;
  const [minutes, setMinutes] = useState(rundown?.start?.minutes ?? 10);
  const { audio, sponsor, replay } = state;

  if (!rundown?.start) {
    return (
      <DesktopShell state={state} view="pause" embedded={embedded} footer={null}>
        <span className="text-sm font-light text-muted-foreground">In config.json ist kein Pausen-Ablauf mit Schnellstart hinterlegt.</span>
      </DesktopShell>
    );
  }

  const active = state.schedule.id === rundown.id && now < rundown.anchor;
  const lengths = LENGTHS.includes(rundown.start.minutes) ? LENGTHS : [rundown.start.minutes, ...LENGTHS].sort((a, b) => a - b);

  return (
    <DesktopShell
      state={state}
      view="pause"
      embedded={embedded}
      footer={<span>Die Regie wechselt beim Start der Pause hierher und zum Anspiel zurück auf den Live-Screen.</span>}
    >
      <div className="flex flex-col gap-3">
        <Label title="PAUSE" hint={active ? `Wiederanpfiff ${hhmm(rundown.anchor)}` : 'noch nicht gestartet'} />
        {active ? (
          <div className="flex flex-col gap-1.5 rounded-md bg-card p-5">
            <Caption>ANSPIEL IN</Caption>
            <span className="text-[56px] leading-none font-black tabular-nums">{mmss((rundown.anchor - now) / 1000)}</span>
            <span className="text-[13px] font-light text-muted-foreground">Verschiebt sich das Anspiel: mit −1 Min / +1 Min beim Ablauf anpassen.</span>
          </div>
        ) : (
          <>
            <div className="grid auto-cols-fr grid-flow-col gap-3">
              {lengths.map((m) => (
                <Button
                  key={m}
                  variant="outline"
                  className={cn('h-11 border-2 border-secondary bg-secondary text-[13px] font-black', m === minutes && 'border-muted-foreground bg-muted-foreground text-background hover:bg-muted-foreground hover:text-background')}
                  aria-pressed={m === minutes}
                  onClick={() => setMinutes(m)}
                >
                  {m} Min
                </Button>
              ))}
            </div>
            <Button className="h-24 flex-col gap-0.5 whitespace-normal" onClick={() => act('schedule/start', { id: rundown.id, minutes })}>
              <span className="text-xl font-black tracking-wide">▶ {rundown.start.label}</span>
              {rundown.start.sub && <span className="text-[13px] font-medium">{rundown.start.sub}</span>}
              {rundown.start.note && <span className="text-[11px] font-light">{rundown.start.note}</span>}
            </Button>
          </>
        )}
        <TestRun schedule={rundown} streaming={state.streaming} what="die Pause" />
      </div>

      <div className="flex flex-col gap-3">
        <Label title="ABLAUF PAUSE"><RunDownControls schedule={rundown} /></Label>
        <RunDownList schedule={rundown} now={now} idle={!active} />
        <span className="text-xs leading-relaxed font-light text-muted-foreground">
          {active ? 'Schritte mit «auto» löst die Regie zur angegebenen Zeit selbst aus.' : 'Zeiten relativ zum Wiederanpfiff. Nach dem Start stehen hier die Uhrzeiten.'} ▶ ist für den Notfall von Hand.
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {audio && (
          <>
            <Label title="TON" hint="schaltet automatisch" />
            <span className="text-xs leading-relaxed font-light text-muted-foreground">
              Pausenbeginn: Mikrofone stumm. Highlights: Musik an und wieder aus. Anspiel: Mikrofone an. Die Knöpfe sind nur zum Eingreifen.
            </span>
            <div className="grid grid-cols-2 gap-3">
              <AudioPresetButton audio={audio} preset="game" desktop />
              <AudioPresetButton audio={audio} preset="pause" desktop />
            </div>
            <AudioSources audio={audio} />
          </>
        )}

        <Label title="HIGHLIGHTS" hint={`${replay.highlightCount} Szenen`} className="mt-3" />
        <Button
          variant="outline"
          disabled={replay.highlightCount === 0}
          className="h-11 border-2 border-secondary bg-secondary text-[13px] font-black"
          onClick={() => act('highlights/play')}
        >
          <span className="text-primary">▶</span> HIGHLIGHT-CLIP NOCHMALS ABSPIELEN
        </Button>

        {sponsor && (
          <>
            <Label title="SPONSOREN" className="mt-3" />
            <SponsorRow sponsor={sponsor} />
            <SponsorAuto sponsor={sponsor} />
          </>
        )}
      </div>
    </DesktopShell>
  );
}
