import type { ControllingItem } from '@shared/state';
import { cn } from '@/lib/utils';

/** The league's checklist for this stream, filled in from what actually went out. */
export function ControllingList({ items, title, hint }: { items: ControllingItem[]; title: string; hint: string }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-1 flex flex-col border-t">
      <div className="flex h-9 items-center justify-between text-[13px]">
        <span className="font-semibold tracking-widest">{title}</span>
        <span className="font-light text-muted-foreground">{hint}</span>
      </div>
      {items.map((c) => (
        <div key={c.label} className="flex h-8 items-center gap-3 border-t text-[13px]">
          <span className="grow truncate font-light">{c.label}</span>
          <span className="font-medium text-muted-foreground tabular-nums">{c.info}</span>
          <span className={cn('w-5 text-right font-black', !c.ok && 'text-dim')} aria-label={c.ok ? 'erfüllt' : 'offen'}>{c.ok ? '✓' : '○'}</span>
        </div>
      ))}
    </div>
  );
}
