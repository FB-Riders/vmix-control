import type { CamState } from '@shared/state';
import { Button } from '@/components/ui/button';
import { act } from '@/lib/api';
import { KEYS } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Props {
  cams: CamState[];
  desktop?: boolean;
}

/** One tap puts the camera on air (hard cut). */
export function ProgramRow({ cams, desktop }: Props) {
  return (
    <div className={cn('grid grid-cols-3', desktop ? 'gap-3' : 'gap-2')}>
      {cams.map((c, i) => (
        <Button
          key={c.id}
          variant={c.program ? 'default' : 'secondary'}
          className={cn('flex-col gap-0.5', desktop ? 'h-24' : 'h-16')}
          aria-label={`CAM ${c.id} sofort live`}
          aria-pressed={c.program}
          onClick={() => act('program', { cam: c.id })}
        >
          <span className={cn('leading-tight font-black', desktop ? 'text-[22px]' : 'text-xl')}>{desktop && 'CAM '}{c.id}</span>
          <span className={cn('font-medium', desktop ? 'text-[13px]' : 'text-[11px]')}>{c.role}</span>
          {desktop && KEYS.program[i] && <span className="text-[11px] font-light">Taste {KEYS.program[i]}</span>}
        </Button>
      ))}
    </div>
  );
}

/** Lines a camera up in vMix's preview. The camera on air cannot be previewed. */
export function PreviewRow({ cams, desktop }: Props) {
  return (
    <div className={cn('grid grid-cols-3', desktop ? 'gap-3' : 'gap-2')}>
      {cams.map((c, i) => (
        <Button
          key={c.id}
          variant="outline"
          disabled={c.program}
          className={cn(
            'flex-col gap-px border-2 border-secondary bg-secondary font-black text-muted-foreground',
            desktop ? 'h-14 text-lg' : 'h-12 text-xl',
            c.preview && !c.program && 'border-muted-foreground bg-muted-foreground text-background hover:bg-muted-foreground hover:text-background',
            c.program && 'border-border bg-background text-input disabled:opacity-100',
          )}
          aria-label={`CAM ${c.id} in Preview`}
          aria-pressed={c.preview}
          onClick={() => act('preview', { cam: c.id })}
        >
          {desktop && 'CAM '}{c.id}
          {desktop && KEYS.preview[i] && <span className="text-[11px] font-light">Taste {KEYS.preview[i]}</span>}
        </Button>
      ))}
    </div>
  );
}
