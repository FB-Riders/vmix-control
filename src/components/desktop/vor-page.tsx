import { useState } from 'react';
import type { PanelState } from '@shared/state';
import { ScheduleDialog } from '@/components/ablauf/schedule-dialog';
import { Caption } from '@/components/caption';
import { Button } from '@/components/ui/button';
import { useNow } from '@/hooks/use-now';
import { act } from '@/lib/api';
import { hhmm, hhmmss, mmss } from '@/lib/time';
import { cn } from '@/lib/utils';
import { RunDownControls } from './run-down';
import { DesktopShell, Label } from './shell';

/** Before the game: start the stream in time, watch the automatic run-down, work through the checklist. */
export function VorPage({ state }: { state: PanelState }) {
  const now = useNow();
  const [dialogOpen, setDialogOpen] = useState(false);
  const { pre, schedule, streaming } = state;
  const at = (offset: number) => schedule.anchor + offset * 1000;
  const nextIndex = schedule.steps.findIndex((s) => at(s.offset) > now);
  const done = pre.checklist.filter((c) => c.done).length;
  const late = now > pre.streamBy;

  return (
    <DesktopShell
      state={state}
      view="vor"
      badge="VOR DEM SPIEL"
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
            'h-24 flex-col gap-1 border-2 border-foreground text-[22px] font-black tracking-wide whitespace-normal disabled:opacity-100',
            streaming ? 'bg-background' : 'bg-foreground text-background hover:bg-foreground hover:text-background',
          )}
          onClick={() => act('stream/start')}
        >
          {streaming ? 'STREAM LÄUFT ✓' : '▶ STREAM STARTEN'}
          <span className="text-xs font-light tracking-normal">
            {streaming ? 'Stream, Recording und Replay-Aufnahme laufen' : 'startet Stream, Recording und Replay-Aufnahme zusammen'}
          </span>
        </Button>
        {pre.emergency && (
          <div className="flex flex-col gap-1.5 rounded-md bg-card p-3.5">
            <span className="text-[13px] font-semibold">{pre.emergency.title}</span>
            <span className="text-[13px] leading-relaxed font-light text-muted-foreground">{pre.emergency.text}</span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <Label title="ABLAUF BIS ZUM ANSPIEL"><RunDownControls schedule={schedule} /></Label>
        <ol className="flex flex-col">
          {schedule.steps.map((s, i) => {
            const past = at(s.offset) <= now;
            const isNext = i === nextIndex;
            const tag = isNext && !s.auto ? 'jetzt' : past ? '✓' : s.tag;
            return (
              <li key={i} className={cn('flex min-h-14 items-center gap-3 border-b px-3 py-2', isNext && 'bg-card', past && 'text-muted-foreground')}>
                <span className="w-16 shrink-0 text-[15px] font-black tabular-nums">{s.offset % 60 === 0 ? hhmm(at(s.offset)) : hhmmss(at(s.offset))}</span>
                <div className="flex min-w-0 grow flex-col gap-0.5">
                  <span className="text-sm font-semibold">{s.label}</span>
                  <span className="text-xs font-light text-muted-foreground">{s.sub}</span>
                </div>
                {s.action && (
                  <Button
                    variant="outline"
                    className="h-8 border border-muted-foreground bg-background px-2.5 text-[11px] font-semibold"
                    aria-label={`${s.label} jetzt von Hand auslösen`}
                    onClick={() => act('schedule/action', { step: i })}
                  >
                    ▶
                  </Button>
                )}
                {tag && (
                  <span className={cn('rounded-sm border px-2 py-[3px] text-[11px] font-black tracking-widest', isNext && !s.auto ? 'border-primary bg-primary' : past ? 'border-transparent' : 'border-foreground')}>
                    {tag}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
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
              <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-md border-2 text-sm font-black', c.done ? 'border-foreground bg-foreground text-background' : 'border-muted-foreground')}>
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
