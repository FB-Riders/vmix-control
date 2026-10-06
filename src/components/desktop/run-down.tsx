import type { ScheduleState } from '@shared/state';
import { Button } from '@/components/ui/button';
import { act } from '@/lib/api';
import { cn } from '@/lib/utils';

const small = 'h-7 border px-2 text-[11px] font-semibold';

/** Arms or disarms the automatic steps and nudges the run-down when the bully moves. */
export function RunDownControls({ schedule }: { schedule: ScheduleState }) {
  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="outline"
        className={cn(small, schedule.autoRun ? 'border-foreground bg-foreground text-background hover:bg-foreground hover:text-background' : 'border-primary bg-primary hover:bg-primary')}
        aria-pressed={schedule.autoRun}
        onClick={() => act('schedule/auto', { enabled: !schedule.autoRun })}
      >
        AUTO {schedule.autoRun ? 'AN' : 'AUS'}
      </Button>
      <Button variant="outline" className={cn(small, 'border-muted-foreground bg-background')} aria-label="Ablauf 1 Minute früher" onClick={() => act('schedule/shift', { minutes: -1 })}>−1 Min</Button>
      <Button variant="outline" className={cn(small, 'border-muted-foreground bg-background')} aria-label="Ablauf 1 Minute später" onClick={() => act('schedule/shift', { minutes: 1 })}>+1 Min</Button>
    </div>
  );
}
