import { ChevronsLeftRightIcon, EyeIcon, LockIcon, LockOpenIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReplayEntry, ReplayState } from '@shared/state';
import { Button } from '@/components/ui/button';
import { act } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Props {
  replay: ReplayState;
  visible: number; // rows shown before the list scrolls
  desktop?: boolean;
}

const STEP = 1; // seconds per tap
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');

/**
 * Timing of one scene. Locked (the default) the whole scene moves earlier or later and keeps its length;
 * unlocked the start and the end move on their own, to make it longer or shorter.
 */
function Timing({ scene, desktop, deleting, onDelete }: { scene: ReplayEntry; desktop?: boolean; deleting: boolean; onDelete: () => void }) {
  const [locked, setLocked] = useState(true);
  const trim = (inSeconds: number, outSeconds: number) => act('replay/trim', { id: scene.id, in: inSeconds, out: outSeconds });
  const button = cn('border border-input bg-transparent px-0 font-black', desktop ? 'h-9 text-xs' : 'h-9 text-[11px]');
  const pair = (label: string, earlier: () => void, later: () => void, what: string) => (
    <div className="flex min-w-0 grow basis-0 flex-col gap-1">
      <span className="text-[10px] font-light text-muted-foreground">{label}</span>
      <div className="grid grid-cols-2 gap-1">
        <Button variant="outline" className={button} aria-label={`${what} ${STEP} Sekunde früher`} onClick={earlier}>◀ {STEP} s</Button>
        <Button variant="outline" className={button} aria-label={`${what} ${STEP} Sekunde später`} onClick={later}>{STEP} s ▶</Button>
      </div>
    </div>
  );

  return (
    <div className={cn('flex flex-col gap-2 border-t border-background', desktop ? 'px-2.5 py-2' : 'px-2 py-1.5')}>
      <div className="flex items-end gap-2">
        {locked
          ? pair(`Szene verschieben · Länge bleibt ${scene.seconds} s`, () => trim(-STEP, -STEP), () => trim(STEP, STEP), 'Szene')
          : (
            <>
              {pair(`Start ${signed(scene.inShift)} s`, () => trim(-STEP, 0), () => trim(STEP, 0), 'Start')}
              {pair(`Ende ${signed(scene.outShift)} s`, () => trim(0, -STEP), () => trim(0, STEP), 'Ende')}
            </>
          )}
        <Button
          variant="outline"
          className={cn('h-9 w-9 shrink-0 border p-0', locked ? 'border-muted-foreground bg-muted-foreground text-background hover:bg-muted-foreground hover:text-background' : 'border-input bg-transparent')}
          aria-pressed={locked}
          aria-label={locked ? 'Länge ist fix. Antippen, um Start und Ende einzeln zu verschieben' : 'Start und Ende einzeln. Antippen, um die Länge zu fixieren'}
          onClick={() => setLocked(!locked)}
        >
          {locked ? <LockIcon /> : <LockOpenIcon />}
        </Button>
        <Button
          variant="outline"
          className={cn('h-9 shrink-0 border px-2 text-[11px] font-black', deleting ? 'border-primary bg-primary' : 'border-input bg-transparent text-muted-foreground')}
          aria-label={deleting ? `${scene.type} von ${scene.time} wirklich löschen` : `${scene.type} von ${scene.time} löschen`}
          onClick={onDelete}
        >
          {deleting ? 'LÖSCHEN?' : <Trash2Icon />}
        </Button>
      </div>
      <span className="text-[11px] font-light text-muted-foreground tabular-nums">
        Länge {scene.seconds} s · Start {signed(scene.inShift)} s · Ende {signed(scene.outShift)} s gegenüber der Markierung
      </span>
    </div>
  );
}

/** Recent replays: star for the highlight video, camera angles, preview in vMix, play to output; timing and delete behind the last button. */
export function ReplayList({ replay, visible, desktop }: Props) {
  const control = desktop ? 'h-11' : 'h-[38px]';
  const rowHeight = desktop ? 56 : 48;
  const gap = desktop ? 12 : 4;
  const [deleting, setDeleting] = useState<number | null>(null); // replay whose delete button is armed
  const [editing, setEditing] = useState<number | null>(null); // replay whose timing controls are open
  // Which vMix event tab is shown: a period, the highlights, or (null) whatever period is current.
  const [chosen, setChosen] = useState<number | 'highlights' | null>(null);
  const view = chosen ?? replay.period;
  const scenes = replay.list.filter((r) => (view === 'highlights' ? r.highlight : r.period === view));

  useEffect(() => {
    if (deleting === null) return;
    const timer = setTimeout(() => setDeleting(null), 3000);
    return () => clearTimeout(timer);
  }, [deleting]);

  function remove(id: number) {
    if (deleting !== id) { setDeleting(id); return; }
    setDeleting(null);
    void act('replay/delete', { id });
  }

  const tab = (key: number | 'highlights', label: string, count: number, title: string) => (
    <Button
      key={key}
      variant="outline"
      className={cn(
        'border px-0 font-black tabular-nums', desktop ? 'h-8 text-xs' : 'h-8 text-[11px]',
        key === view ? 'border-muted-foreground bg-muted-foreground text-background hover:bg-muted-foreground hover:text-background' : 'border-secondary bg-secondary',
      )}
      aria-pressed={key === view}
      aria-label={`${title}, ${count} Szenen`}
      onClick={() => setChosen(key === replay.period ? null : key)}
    >
      {label}<span className="ml-1 font-light">{count}</span>
    </Button>
  );

  return (
    <>
      <div className="grid auto-cols-fr grid-flow-col gap-1.5">
        {replay.periods.map((p, i) => tab(i, p.short, p.count, p.label))}
        {tab('highlights', '★', replay.highlightCount, 'Highlights')}
      </div>
      {scenes.length === 0 && (
        <span className="py-1.5 text-xs font-light text-muted-foreground">
          {view === 'highlights' ? 'Noch keine Highlights.' : `Noch keine Replays im Abschnitt ${replay.periods[view]?.label ?? ''}.`}
        </span>
      )}
      <div
        className={cn('flex flex-col overflow-y-auto overscroll-contain', desktop ? 'gap-3' : 'gap-1')}
        style={{ maxHeight: visible * rowHeight + (visible - 1) * gap + rowHeight / 2 }} // half a row peeks out to show there is more
      >
      {scenes.map((r) => {
        return (
          <div key={r.id} className={cn('shrink-0 rounded-md text-foreground', r.playing ? 'bg-primary' : 'bg-card')}>
          <div className={cn('flex items-center', desktop ? 'h-14 gap-1.5 px-1.5' : 'h-12 gap-[5px] pr-[5px] pl-0.5')}>
            <Button
              variant="ghost"
              disabled={r.locked}
              className={cn(control, 'shrink-0 p-0 hover:bg-transparent disabled:opacity-100', desktop ? 'w-8 text-xl' : 'w-7 text-lg', !r.highlight && 'text-muted-foreground')}
              aria-label={r.locked ? `${r.type}, immer im Highlight-Video` : r.highlight ? 'Aus Highlight-Video entfernen' : 'Ins Highlight-Video aufnehmen'}
              aria-pressed={r.highlight}
              onClick={() => act('replay/fav', { id: r.id, fav: !r.highlight })}
            >
              {r.highlight ? '★' : '☆'}
            </Button>
            {desktop ? (
              // Type over time, so the row also fits a column of under 400 px.
              <span className="flex min-w-0 grow flex-col">
                <span className="truncate text-[13px] leading-tight font-black">{r.type.toUpperCase()}</span>
                <span className="text-xs font-light text-muted-foreground tabular-nums">{r.time}</span>
              </span>
            ) : (
              <>
                <span className="w-[34px] shrink-0 text-xs font-semibold tabular-nums">{r.time}</span>
                <span className="min-w-0 grow truncate text-xs font-black">{r.type.toUpperCase()}</span>
              </>
            )}
            <div className="flex gap-1">
              {replay.cams.map((cam) => {
                const on = r.cams.includes(cam);
                return (
                  <Button
                    key={cam}
                    variant="outline"
                    className={cn(
                      control, 'border p-0 font-black', desktop ? 'w-9 text-[15px]' : 'w-7 text-[13px]',
                      on
                        ? 'border-muted-foreground bg-muted-foreground text-background hover:bg-muted-foreground hover:text-background'
                        : 'border-dashed border-input bg-transparent text-dim',
                    )}
                    aria-label={`CAM ${cam} ${on ? 'aus Replay entfernen' : 'zum Replay hinzufügen'}`}
                    aria-pressed={on}
                    onClick={() => act('replay/cam', { id: r.id, cam, on: !on })}
                  >
                    {cam}
                  </Button>
                );
              })}
            </div>
            <Button
              variant="outline"
              className={cn(control, 'shrink-0 border border-input bg-transparent p-0', desktop ? 'w-9' : 'w-[34px]')}
              aria-label={`${r.type} von ${r.time} in der vMix-Preview ansehen`}
              onClick={() => act('replay/preview', { id: r.id })}
            >
              <EyeIcon />
            </Button>
            <Button
              variant="outline"
              className={cn(control, 'shrink-0 gap-1 border p-0 font-black', desktop ? 'w-[64px] text-[13px]' : 'w-10 text-[11px]', r.playing ? 'border-background bg-background hover:bg-background' : 'border-input bg-transparent')}
              aria-label={`${r.type} von ${r.time} mit Stinger abspielen`}
              onClick={() => act('replay/play', { id: r.id })}
            >
              {r.playing ? 'ON AIR' : <><span className="text-primary">▶</span>{desktop && 'PLAY'}</>}
            </Button>
            <Button
              variant="outline"
              className={cn(
                control, 'shrink-0 border p-0', desktop ? 'w-8' : 'w-7',
                editing === r.id ? 'border-muted-foreground bg-muted-foreground text-background hover:bg-muted-foreground hover:text-background' : 'border-transparent bg-transparent text-muted-foreground',
              )}
              aria-expanded={editing === r.id}
              aria-label={`${r.type} von ${r.time}: Zeitpunkt anpassen oder löschen`}
              onClick={() => setEditing(editing === r.id ? null : r.id)}
            >
              <ChevronsLeftRightIcon />
            </Button>
          </div>
          {editing === r.id && <Timing scene={r} desktop={desktop} deleting={deleting === r.id} onDelete={() => remove(r.id)} />}
          </div>
        );
      })}
      </div>
    </>
  );
}
