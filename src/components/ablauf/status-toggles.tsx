import { useState } from 'react';
import type { ToggleTarget } from '@shared/actions';
import type { PanelState } from '@shared/state';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { act } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Chip {
  what: ToggleTarget;
  name: string;
  on: boolean;
  onLabel: string;
  offLabel: string;
}

/** Stream, recording, replay recording and league logos: status at a glance, tap to switch (with confirmation). */
export function StatusToggles({ state }: { state: PanelState }) {
  const [ask, setAsk] = useState<Chip | null>(null);

  const chips: Chip[] = [
    { what: 'stream', name: 'Stream', on: state.streaming, onLabel: 'Stream läuft', offLabel: 'Stream aus' },
    { what: 'rec', name: 'Lokales Recording', on: state.recording, onLabel: 'Lokales Recording', offLabel: 'Recording aus' },
    { what: 'replayRec', name: 'Replay-Aufnahme', on: state.replayRecording, onLabel: 'Replay-Aufnahme', offLabel: 'Replay-Aufnahme aus' },
    ...(state.logos ? [{ what: 'logos' as const, name: 'Liga-Logos', on: state.logos.visible, onLabel: 'Liga-Logos sichtbar', offLabel: 'Liga-Logos aus' }] : []),
  ];

  return (
    <section className="grid grid-cols-2 gap-x-2 gap-y-1">
      {chips.map((c) => (
        <Button
          key={c.what}
          variant="ghost"
          className={cn('h-9 justify-start gap-1.5 px-0 text-[13px] font-medium', !c.on && 'text-dim')}
          onClick={() => setAsk(c)}
        >
          <span className={c.on ? 'text-primary' : 'text-input'}>●</span>
          {c.on ? c.onLabel : c.offLabel}
        </Button>
      ))}

      <AlertDialog open={!!ask} onOpenChange={(open) => !open && setAsk(null)}>
        <AlertDialogContent className="border">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-black">{ask?.name} {ask?.on ? 'ausschalten' : 'einschalten'}?</AlertDialogTitle>
            <AlertDialogDescription>
              {ask?.on ? 'Das stoppt die laufende Ausgabe in vMix sofort.' : 'Das startet die Ausgabe in vMix sofort.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="grid grid-cols-2 bg-transparent">
            <AlertDialogCancel className="h-12 border-2 bg-background font-semibold">Abbrechen</AlertDialogCancel>
            <AlertDialogAction className="h-12 font-black" onClick={() => ask && act('toggle', { what: ask.what, on: !ask.on })}>
              {ask?.on ? 'AUSSCHALTEN' : 'EINSCHALTEN'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
