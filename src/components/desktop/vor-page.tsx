import { useState } from 'react';
import type { PanelState } from '@shared/state';
import { ScheduleDialog } from '@/components/ablauf/schedule-dialog';
import { Caption } from '@/components/caption';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useNow } from '@/hooks/use-now';
import { act } from '@/lib/api';
import { hhmm, mmss } from '@/lib/time';
import { cn } from '@/lib/utils';
import { ControllingList } from './controlling';
import { RunDownControls, RunDownList, TestRun } from './run-down';
import { DesktopShell, Label } from './shell';

/** Before the game: start the stream in time, watch the automatic run-down, work through the checklist. */
export function VorPage({ state }: { state: PanelState }) {
  const now = useNow();
  const [dialogOpen, setDialogOpen] = useState(false);
  const { pre, streaming } = state;
  const schedule = state.preRundown;
  const done = pre.checklist.filter((c) => c.done).length;
  const late = now > pre.streamBy;

  return (
    <DesktopShell
      state={state}
      view="vor"
      header={
        <button type="button" className="text-[15px] font-semibold underline decoration-dotted underline-offset-4" onClick={() => setDialogOpen(true)}>
          Spielbeginn {hhmm(pre.kickoff)}
        </button>
      }
      footer={<span>Alles abgehakt und Stream läuft: die Regie wechselt automatisch auf den Live-Screen.</span>}
    >
      <div className="flex flex-col gap-3">
        <Label title="JETZT" hint={`Stream-Start in vMix spätestens ${hhmm(pre.streamBy)}`} />
        <div className={cn('flex flex-col gap-1.5 rounded-md p-5', streaming ? 'bg-card' : 'bg-primary')}>
          <Caption>{streaming ? 'STREAM LÄUFT · ANSPIEL IN' : late ? 'STREAM STARTEN · ÜBERFÄLLIG SEIT' : 'STREAM STARTEN IN'}</Caption>
          <span className="text-[56px] leading-none font-black tabular-nums">
            {mmss(Math.abs((streaming ? pre.kickoff : pre.streamBy) - now) / 1000)}
          </span>
          {pre.reminder && <span className="text-[13px] font-medium">{pre.reminder}</span>}
        </div>
        <Button
          variant="outline"
          disabled={streaming}
          className={cn(
            'h-24 flex-col gap-1 border-2 border-secondary text-[22px] font-black tracking-wide whitespace-normal disabled:opacity-100',
            streaming ? 'bg-secondary' : 'border-muted-foreground bg-muted-foreground text-background hover:bg-muted-foreground hover:text-background',
          )}
          onClick={() => act('stream/start')}
        >
          {streaming ? 'STREAM LÄUFT ✓' : '▶ STREAM STARTEN'}
          <span className="text-xs font-light tracking-normal">
            {streaming
              ? `Stream${state.recording ? ', Recording' : ''} und Replay-Aufnahme laufen`
              : `startet Stream${pre.recordGame ? ', Recording' : ''} und Replay-Aufnahme zusammen`}
          </span>
        </Button>
        <label className="flex items-center justify-between gap-3 rounded-md bg-card px-3.5 py-2.5">
          <span className="flex flex-col gap-0.5">
            <span className="text-[13px] font-semibold">Spiel lokal aufnehmen</span>
            <span className="text-xs font-light text-muted-foreground">vMix-Recording beim Stream-Start mitstarten</span>
          </span>
          <Switch checked={pre.recordGame} disabled={streaming} onCheckedChange={(enabled) => act('settings/record', { enabled })} />
        </label>
        {pre.emergency && (
          <div className="flex flex-col gap-1.5 rounded-md bg-card p-3.5">
            <span className="text-[13px] font-semibold">{pre.emergency.title}</span>
            <span className="text-[13px] leading-relaxed font-light text-muted-foreground">{pre.emergency.text}</span>
          </div>
        )}
        <ControllingList items={state.controlling.filter((c) => !c.post)} title="CONTROLLING HEUTE" hint="wie swiss unihockey prüft" />
      </div>

      <div className="flex flex-col gap-3">
        <Label title="ABLAUF BIS ZUM ANSPIEL"><RunDownControls schedule={schedule} /></Label>
        <RunDownList schedule={schedule} now={now} />
        <TestRun schedule={schedule} streaming={streaming} what="den Ablauf bis zum Anspiel" />
        <span className="text-xs leading-relaxed font-light text-muted-foreground">
          Schritte mit «auto» löst die Regie zur angegebenen Zeit selbst aus, solange der Stream läuft und AUTO an ist. ▶ ist für den Notfall von Hand.
        </span>
      </div>

      <div className="flex flex-col gap-3">
        <Label title="CHECKLISTE" hint={`${done} von ${pre.checklist.length} erledigt`} />
        <div className="flex flex-col gap-1.5">
          {pre.checklist.map((c) => (
            <Button
              key={c.id}
              variant="secondary"
              disabled={c.auto}
              className={cn('h-auto min-h-12 justify-start gap-3 border-2 border-secondary px-3 py-1.5 text-left whitespace-normal text-foreground disabled:opacity-100', c.done && 'bg-background hover:bg-background')}
              aria-pressed={c.done}
              onClick={() => act('tick', { id: c.id, done: !c.done })}
            >
              <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-md border-2 text-sm font-black', c.done ? 'border-muted-foreground bg-muted-foreground text-background' : 'border-input')}>
                {c.done && '✓'}
              </span>
              <span className="flex min-w-0 grow flex-col gap-px">
                <span className="text-[13px] font-semibold">{c.title}</span>
                <span className="text-[11px] font-light text-muted-foreground">{c.sub}{c.auto && ' · prüft die Regie selbst'}</span>
              </span>
            </Button>
          ))}
        </div>
        <Button
          variant="ghost"
          disabled={streaming}
          className="h-9 self-start px-0 text-xs font-light text-muted-foreground underline underline-offset-2"
          onClick={() => window.confirm('Checkliste, Controlling und Replay-Liste der Regie zurücksetzen?') && act('match/reset')}
        >
          Neues Spiel: Checkliste und Controlling zurücksetzen
        </Button>
      </div>

      {dialogOpen && <ScheduleDialog schedule={schedule} open onOpenChange={setDialogOpen} />}
    </DesktopShell>
  );
}
