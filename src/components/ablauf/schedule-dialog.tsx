import { useState } from 'react';
import type { ScheduleState } from '@shared/state';
import { Caption } from '@/components/caption';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { act } from '@/lib/api';
import { hhmm } from '@/lib/time';
import { cn } from '@/lib/utils';

interface Props {
  schedule: ScheduleState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Pick the run-down (pre-game or break) and when its zero point is. */
export function ScheduleDialog({ schedule, open, onOpenChange }: Props) {
  const [id, setId] = useState(schedule.id);
  const [time, setTime] = useState(hhmm(schedule.anchor));
  const selected = schedule.all.find((s) => s.id === id) ?? schedule.all[0];

  function pick(next: string) {
    setId(next);
    setTime(next === schedule.id ? hhmm(schedule.anchor) : '');
  }

  function apply(input: { time?: string; inMinutes?: number }) {
    void act('schedule/set', { id, ...input });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-3 border" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-base font-black tracking-widest">ABLAUF</DialogTitle>
          <DialogDescription className="sr-only">Ablauf und Zeitpunkt wählen</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {schedule.all.map((s) => (
            <Button
              key={s.id}
              variant="secondary"
              className={cn('h-12 border-2 border-secondary font-semibold tracking-widest', s.id === id && 'border-foreground bg-background text-foreground')}
              aria-pressed={s.id === id}
              onClick={() => pick(s.id)}
            >
              {s.title}
            </Button>
          ))}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="anchor-time" className="text-xs font-semibold tracking-widest">{selected.anchorLabel} UM</Label>
          <Input
            id="anchor-time"
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="h-12 border-2 text-lg font-semibold"
          />
        </div>
        <Button className="h-12 font-black tracking-widest" onClick={() => apply(time ? { time } : {})}>ÜBERNEHMEN</Button>
        <Caption>ODER AB JETZT</Caption>
        <div className="grid grid-cols-3 gap-2">
          {[5, 10, 15].map((m) => (
            <Button key={m} variant="secondary" className="h-12 font-semibold text-foreground" onClick={() => apply({ inMinutes: m })}>
              in {m} Min
            </Button>
          ))}
        </div>
        <Button variant="ghost" className="h-12 font-semibold tracking-widest" onClick={() => onOpenChange(false)}>ABBRECHEN</Button>
      </DialogContent>
    </Dialog>
  );
}
