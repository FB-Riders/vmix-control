import { useState } from 'react';
import type { PanelState, Tick } from '@shared/state';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { act } from '@/lib/api';
import { hhmm, mmss } from '@/lib/time';
import { cn } from '@/lib/utils';
import { ControllingList } from './controlling';
import { DesktopShell, Label } from './shell';

const toggle = (t: Tick) => act('tick', { id: t.id, done: !t.done });

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex h-20 flex-col justify-center rounded-md border-2 border-foreground px-3">
      <span className="text-2xl font-black tabular-nums">{value}</span>
      <span className="text-[11px] font-light text-muted-foreground">{label}</span>
    </div>
  );
}

/** After the final whistle: wrap up the stream, record the highlight video, tick off the interviews. */
export function NachPage({ state }: { state: PanelState }) {
  const [confirm, setConfirm] = useState(false);
  const { post, score } = state;
  const { video, finish } = post;
  const [min, max] = video?.targetMinutes ?? [0, 0];
  const busy = state.streaming || state.recording;

  return (
    <DesktopShell
      state={state}
      view="nach"
      badge="NACH DEM SPIEL"
      header={score && (score.home || score.away) && <span className="text-[28px] leading-none font-black">{score.home}:{score.away}</span>}
      footer={<span>Das lokale Recording bleibt in vMix gespeichert, falls swiss unihockey es anfordert.</span>}
    >
      <div className="flex flex-col gap-3">
        <Label title="STREAM BEENDEN" hint="frühestens nach Best Player und Handshake" />
        <div className="flex flex-col">
          {post.steps.map((s) => (
            <button
              key={s.id}
              type="button"
              className="flex min-h-12 items-center gap-3 border-b text-left text-sm active:opacity-60"
              aria-pressed={s.done}
              onClick={() => toggle(s)}
            >
              <span className={cn('w-5 text-center font-black', !s.done && 'text-dim')}>{s.done ? '✓' : '○'}</span>
              <span className={cn('grow font-medium', s.done && 'text-muted-foreground')}>{s.title}</span>
              <span className="text-xs font-light text-muted-foreground">{s.sub}</span>
            </button>
          ))}
        </div>
        {finish && (
          <Button className="h-24 flex-col gap-1 whitespace-normal" disabled={!state.streaming} onClick={() => setConfirm(true)}>
            <span className="text-xl font-black tracking-wide">{state.streaming ? `▶ ${finish.label}` : 'STREAM BEENDET ✓'}</span>
            <span className="text-[13px] font-medium">{finish.sub}</span>
          </Button>
        )}
      </div>

      {video && (
        <div className="flex flex-col gap-3">
          <Label title="HIGHLIGHT-VIDEO" hint={video.uploadBy ? `Upload bis ${hhmm(video.uploadBy)} (4 h)` : 'Upload innert 4 h nach Stream-Ende'} />
          <div className="grid grid-cols-3 gap-3">
            <Stat value={mmss(video.totalSec)} label={`Länge · Ziel ${min}–${max} Min`} />
            <Stat value={String(video.scenes)} label={`Szenen · ${video.goals} Tore`} />
            <Stat value={`${video.speed} %`} label="Tempo, passt Länge an" />
          </div>
          <ol className="flex flex-col border-t">
            {video.timeline.map((t, i) => (
              <li key={i} className={cn('flex h-11 items-center gap-3 border-b px-3', t.required && 'bg-card', video.status === 'running' && video.step === i && 'bg-primary')}>
                <span className="w-12 shrink-0 text-[13px] font-semibold tabular-nums">{mmss(t.seconds)}</span>
                <span className="grow truncate text-sm font-semibold">{t.title}</span>
                <span className="text-xs font-light text-muted-foreground">{video.status === 'running' && video.step === i ? 'läuft' : t.note}</span>
              </li>
            ))}
          </ol>
          <span className="text-xs leading-relaxed font-light text-muted-foreground">
            Die Clips der Vorlage sind fest, sie können nicht vergessen werden. Die Regie spielt alles in Echtzeit über den Programmausgang und vMix nimmt es mit den Recording-Einstellungen auf.
          </span>
          <div className="grid auto-cols-fr grid-flow-col gap-3">
            {video.speeds.map((s) => (
              <Button
                key={s}
                variant="outline"
                disabled={video.status === 'running'}
                className={cn('h-14 border-2 border-muted-foreground bg-background text-sm font-black', s === video.speed && 'border-foreground bg-foreground text-background hover:bg-foreground hover:text-background')}
                aria-pressed={s === video.speed}
                onClick={() => act('video/speed', { speed: s })}
              >
                Tempo {s} %
              </Button>
            ))}
          </div>
          <Button
            variant={video.status === 'done' ? 'outline' : 'default'}
            disabled={video.status === 'running' || busy}
            className={cn('h-24 flex-col gap-1 border-2 text-xl font-black tracking-wide whitespace-normal', video.status === 'done' ? 'border-foreground bg-background' : 'border-primary')}
            onClick={() => act('video/export')}
          >
            {video.status === 'done' ? 'AUFGENOMMEN ✓' : video.status === 'running' ? `AUFNAHME LÄUFT · ${video.step + 1}/${video.timeline.length}` : '▶ HIGHLIGHT-VIDEO AUFNEHMEN'}
            <span className="text-xs font-light tracking-normal">
              {video.status === 'done' ? 'Datei liegt im vMix-Aufnahmeordner: jetzt im Hub hochladen'
                : busy ? 'erst Stream und Aufnahme beenden (Abschluss)'
                : `dauert ca. ${mmss(video.totalSec)} Min, nichts anderes schalten`}
            </span>
          </Button>
          {video.status === 'done' && (
            <Button
              variant="outline"
              className={cn('h-11 border-2 text-[13px] font-black', video.uploaded.done ? 'border-muted-foreground bg-background text-muted-foreground' : 'border-foreground bg-foreground text-background hover:bg-foreground hover:text-background')}
              aria-pressed={video.uploaded.done}
              onClick={() => toggle(video.uploaded)}
            >
              {video.uploaded.done ? 'IM HUB HOCHGELADEN ✓' : 'ALS HOCHGELADEN MARKIEREN'}
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <Label title="GAME-FEED" hint={`Soll: ${post.interviews.length} Interviews pro Heimspiel`} />
        {post.interviews.map((iv) => (
          <div key={iv.id} className="flex items-center gap-3 rounded-md bg-card p-3.5">
            <div className="flex min-w-0 grow flex-col gap-0.5">
              <span className="text-sm font-semibold">{iv.title}{iv.done && ' ✓'}</span>
              <span className="text-xs font-light text-muted-foreground">{iv.sub}</span>
            </div>
            <Button
              variant="outline"
              className={cn('h-11 shrink-0 border-2 px-3.5 text-xs font-black', iv.done ? 'border-muted-foreground bg-background text-muted-foreground' : 'border-foreground bg-foreground text-background hover:bg-foreground hover:text-background')}
              aria-pressed={iv.done}
              onClick={() => toggle(iv)}
            >
              {iv.done ? 'HOCHGELADEN' : 'IM HUB HOCHGELADEN?'}
            </Button>
          </div>
        ))}
        <ControllingList items={state.controlling} title="CONTROLLING DIESES SPIEL" hint={`${state.controlling.filter((c) => c.ok).length} von ${state.controlling.length}`} />
      </div>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent className="border">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-black">Abschluss starten?</AlertDialogTitle>
            <AlertDialogDescription>{finish?.sub}. Am Ende stoppen Stream, Recording und Replay-Aufnahme.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="grid grid-cols-2 bg-transparent">
            <AlertDialogCancel className="h-12 border-2 bg-background font-semibold">Abbrechen</AlertDialogCancel>
            <AlertDialogAction className="h-12 font-black" onClick={() => act('post/finish')}>STARTEN</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DesktopShell>
  );
}
