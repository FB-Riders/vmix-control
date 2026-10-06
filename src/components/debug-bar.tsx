import { useState } from 'react';
import { toast } from 'sonner';
import type { DebugEntry, DebugKind } from '@shared/debug';
import { Caption } from '@/components/caption';
import { Button } from '@/components/ui/button';
import { setDebugOpen, useDebugInfo } from '@/hooks/use-debug';
import { pad } from '@/lib/time';
import { cn } from '@/lib/utils';

const KINDS: { id: DebugKind; label: string }[] = [
  { id: 'action', label: 'Aktionen' },
  { id: 'vmix', label: 'vMix' },
  { id: 'sound', label: 'Ton' },
  { id: 'sequence', label: 'Abläufe' },
  { id: 'error', label: 'Fehler' },
];
const TAG: Record<DebugKind, string> = { action: 'AKTION', vmix: 'VMIX', sound: 'TON', sequence: 'ABLAUF', error: 'FEHLER' };

function stamp(t: number): string {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${Math.floor(d.getMilliseconds() / 100)}`;
}

const line = (e: DebugEntry) => `${stamp(e.t)} ${TAG[e.kind].padEnd(6)} ${e.text}`;
const small = 'h-7 border px-2 text-[11px] font-semibold';

/** What the panel believes about vMix right now, and everything it did lately: actions, vMix commands, sound, sequences. */
export function DebugBar({ className }: { className?: string }) {
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState<DebugKind[]>([]);
  const info = useDebugInfo(!paused);
  const entries = (info?.log ?? []).filter((e) => !hidden.includes(e.kind)).reverse();

  const toggle = (kind: DebugKind) => setHidden((h) => (h.includes(kind) ? h.filter((k) => k !== kind) : [...h, kind]));
  const copy = () => {
    const status = (info?.status ?? []).map((s) => `${s.label}: ${s.value}`).join('\n');
    const text = `${status}\n\n${(info?.log ?? []).map(line).join('\n')}`;
    navigator.clipboard?.writeText(text).then(() => toast.success('Debug-Protokoll kopiert'), () => toast.error('Kopieren nicht möglich'));
  };

  return (
    <aside aria-label="Debug" className={cn('flex min-h-0 flex-col border-t-2 border-muted-foreground bg-background', className)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-6 py-2">
        <Caption className="font-black">DEBUG</Caption>
        <div className="flex flex-wrap gap-1.5">
          {KINDS.map((k) => (
            <Button
              key={k.id}
              variant="outline"
              className={cn(small, hidden.includes(k.id) ? 'border-secondary bg-transparent text-dim' : 'border-secondary bg-secondary')}
              aria-pressed={!hidden.includes(k.id)}
              onClick={() => toggle(k.id)}
            >
              {k.label}
            </Button>
          ))}
        </div>
        <div className="ml-auto flex gap-1.5">
          <Button variant="outline" className={cn(small, paused ? 'border-primary bg-primary' : 'border-secondary bg-secondary')} aria-pressed={paused} onClick={() => setPaused(!paused)}>
            {paused ? 'ANGEHALTEN' : 'ANHALTEN'}
          </Button>
          <Button variant="outline" className={cn(small, 'border-secondary bg-secondary')} onClick={copy}>KOPIEREN</Button>
          <Button variant="outline" className={cn(small, 'border-secondary bg-secondary')} onClick={() => setDebugOpen(false)}>SCHLIESSEN</Button>
        </div>
      </div>

      <div className="grid min-h-0 grow grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,2fr)] gap-x-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:grid-rows-[minmax(0,1fr)]">
        <dl className="min-h-0 overflow-y-auto overscroll-contain px-6 py-2 text-xs">
          {(info?.status ?? []).map((s) => (
            <div key={s.label} className="flex gap-3 border-b py-1 last:border-b-0">
              <dt className="w-40 shrink-0 font-light text-muted-foreground">{s.label}</dt>
              <dd className="min-w-0 font-medium break-words">{s.value}</dd>
            </div>
          ))}
          {!info && <span className="font-light text-muted-foreground">lädt …</span>}
        </dl>
        <ol className="min-h-0 overflow-y-auto overscroll-contain border-t px-6 py-2 text-xs lg:border-t-0 lg:border-l">
          {entries.map((e, i) => (
            <li key={`${e.t}-${i}`} className="flex gap-2 py-0.5">
              <span className="w-[68px] shrink-0 font-light text-muted-foreground tabular-nums">{stamp(e.t)}</span>
              <span className={cn('w-[52px] shrink-0 text-[10px] leading-4 font-black', e.kind === 'error' ? 'bg-primary text-center text-foreground' : 'text-dim')}>{TAG[e.kind]}</span>
              <span className={cn('min-w-0 break-words', e.kind === 'error' ? 'font-semibold' : 'font-light')}>{e.text}</span>
            </li>
          ))}
          {info && entries.length === 0 && <span className="font-light text-muted-foreground">Noch keine Einträge.</span>}
        </ol>
      </div>
    </aside>
  );
}
