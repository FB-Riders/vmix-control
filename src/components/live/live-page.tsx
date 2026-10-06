import type { PanelState } from '@shared/state';
import { AudioPresetButton, MusicButton } from '@/components/audio';
import { Caption } from '@/components/caption';
import { MarkButtons, PeriodSelect } from '@/components/replay/mark-buttons';
import { ReplayList } from '@/components/replay/replay-list';
import { SponsorButton } from '@/components/sponsor';
import type { Marking } from '@/hooks/use-marking';
import { camsLabel } from '@/lib/format';
import { ProgramRow, PreviewRow } from './camera-bus';
import { StatusHeader } from './status-header';

export function LivePage({ state, marking }: { state: PanelState; marking: Marking }) {
  const { replay, audio, sponsor } = state;
  const { pending } = marking;

  return (
    <>
      <StatusHeader state={state} />
      <main className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3">
        <section className="flex flex-col gap-1.5">
          <Caption className="font-black text-primary">LIVE · 1 Klick = sofort auf Sendung</Caption>
          <ProgramRow cams={state.cams} />
        </section>

        <section className="flex flex-col gap-1.5">
          <Caption>PREVIEW · vorbereiten</Caption>
          <PreviewRow cams={state.cams} />
        </section>

        <section className="flex flex-col gap-2 border-t pt-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <Caption>{pending ? `MARKIERT ${camsLabel(pending.cams)} · WAS WAR ES?` : 'REPLAY MARKIEREN'}</Caption>
            <span className="text-[11px] font-light text-muted-foreground">
              {pending ? `sonst nach 5 s: ${replay.defaultType}` : '★ = Highlight-Video'}
            </span>
          </div>
          <PeriodSelect replay={replay} />
          <MarkButtons replay={replay} marking={marking} recording={state.replayRecording} />
          <ReplayList replay={replay} visible={3} />
        </section>

        {(audio || sponsor || state.music) && (
          <section className="grid auto-cols-fr grid-flow-col gap-1.5">
            {audio && <AudioPresetButton audio={audio} preset="game" />}
            {audio && <AudioPresetButton audio={audio} preset="pause" />}
            {state.music && <MusicButton music={state.music} />}
            {sponsor && <SponsorButton sponsor={sponsor} />}
          </section>
        )}
      </main>
    </>
  );
}
