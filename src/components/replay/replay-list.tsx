import { EyeIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ReplayState } from '@shared/state';
import { Button } from '@/components/ui/button';
import { act } from '@/lib/api';
import { periodShort } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Props {
  replay: ReplayState;
  visible: number; // rows shown before the list scrolls
  currentPeriod: string;
  desktop?: boolean;
}

/** Recent replays: star for the highlight video, camera angles, preview in vMix, play to output, delete (second tap confirms). */
export function ReplayList({ replay, visible, currentPeriod, desktop }: Props) {
  const control = desktop ? 'h-11' : 'h-[38px]';
  const rowHeight = desktop ? 56 : 48;
  const gap = desktop ? 12 : 4;
  const [deleting, setDeleting] = useState<number | null>(null); // replay whose delete button is armed

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

  if (replay.list.length === 0) {
    return <span className="py-1.5 text-xs font-light text-muted-foreground">Noch keine Replays markiert.</span>;
  }

  return (
    <div
      className={cn('flex flex-col overflow-y-auto overscroll-contain', desktop ? 'gap-3' : 'gap-1')}
      style={{ maxHeight: visible * rowHeight + (visible - 1) * gap + rowHeight / 2 }} // half a row peeks out to show there is more
    >
      {replay.list.map((r) => {
        const time = desktop && r.period && r.period !== currentPeriod ? `${periodShort(r.period)} ${r.time}` : r.time;
        return (
          <div
            key={r.id}
            className={cn('flex shrink-0 items-center rounded-md text-foreground', desktop ? 'h-14 gap-1.5 px-1.5' : 'h-12 gap-[5px] pr-[5px] pl-0.5', r.playing ? 'bg-primary' : 'bg-card')}
          >
            <Button
              variant="ghost"
              disabled={r.locked}
              className={cn(control, 'shrink-0 p-0 hover:bg-transparent disabled:opacity-100', desktop ? 'w-9 text-xl' : 'w-7 text-lg', !r.highlight && 'text-muted-foreground')}
              aria-label={r.locked ? `${r.type}, immer im Highlight-Video` : r.highlight ? 'Aus Highlight-Video entfernen' : 'Ins Highlight-Video aufnehmen'}
              aria-pressed={r.highlight}
              onClick={() => act('replay/fav', { id: r.id, fav: !r.highlight })}
            >
              {r.highlight ? '★' : '☆'}
            </Button>
            <span className={cn('shrink-0 font-semibold tabular-nums', desktop ? 'text-[13px]' : 'w-[34px] text-xs')}>{time}</span>
            <span className={cn('min-w-0 grow truncate font-black', desktop ? 'text-[13px]' : 'text-xs')}>{r.type.toUpperCase()}</span>
            <div className="flex gap-1">
              {replay.cams.map((cam) => {
                const on = r.cams.includes(cam);
                return (
                  <Button
                    key={cam}
                    variant="outline"
                    className={cn(
                      control, 'border-2 p-0 font-black', desktop ? 'w-9 text-[15px]' : 'w-7 text-[13px]',
                      on
                        ? 'border-foreground bg-foreground text-background hover:bg-foreground hover:text-background'
                        : 'border-dashed border-muted-foreground bg-background text-muted-foreground',
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
              className={cn(control, 'shrink-0 border-2 border-foreground bg-background p-0', desktop ? 'w-11' : 'w-[34px]')}
              aria-label={`${r.type} von ${r.time} in der vMix-Preview ansehen`}
              onClick={() => act('replay/preview', { id: r.id })}
            >
              <EyeIcon />
            </Button>
            <Button
              className={cn(control, 'shrink-0 border-2 p-0 font-black', desktop ? 'w-[68px] text-[13px]' : 'w-10 text-[11px]', r.playing ? 'border-background bg-background hover:bg-background' : 'border-primary')}
              aria-label={`${r.type} von ${r.time} mit Stinger abspielen`}
              onClick={() => act('replay/play', { id: r.id })}
            >
              {r.playing ? 'ON AIR' : desktop ? '▶ PLAY' : '▶'}
            </Button>
            <Button
              variant="outline"
              className={cn(
                control, 'shrink-0 border-2 p-0 text-[11px] font-black', desktop ? 'w-9' : 'w-7',
                deleting === r.id ? 'border-foreground bg-foreground text-background hover:bg-foreground hover:text-background' : 'border-transparent bg-transparent text-muted-foreground',
              )}
              aria-label={deleting === r.id ? `${r.type} von ${r.time} wirklich löschen` : `${r.type} von ${r.time} löschen`}
              onClick={() => remove(r.id)}
            >
              {deleting === r.id ? 'OK?' : <Trash2Icon />}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
