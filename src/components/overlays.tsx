import type { OverlayState } from '@shared/state';
import { cn } from '@/lib/utils';

/** What vMix has on its overlay channels right now: one entry per channel, lit while something is on it. */
export function OverlayStrip({ overlays, className }: { overlays: OverlayState[]; className?: string }) {
  if (!overlays.length) return null;
  return (
    <div aria-label="Im Bild" className={cn('flex flex-wrap items-center gap-x-5 gap-y-1.5 border-b text-xs', className)}>
      <span className="font-black tracking-widest">IM BILD</span>
      {overlays.map((o) => {
        const role = o.role || `Overlay ${o.channel}`;
        // The clock on the clock's channel needs no second word; anything else on a channel is named.
        const text = o.text && o.text !== o.role ? o.text : o.on ? 'ein' : '';
        return (
          <span key={o.channel} className={cn('flex min-w-0 items-center gap-1.5', !o.on && 'text-dim')}>
            <span className={o.on ? 'text-primary' : 'text-input'}>●</span>
            <span className="font-medium tracking-widest">{role.toUpperCase()}</span>
            {o.on
              ? <span className="truncate font-semibold text-foreground">{text}</span>
              : <span className="truncate font-light">{o.paused ? `${text || 'aus'} · kommt von selbst zurück` : 'aus'}</span>}
          </span>
        );
      })}
    </div>
  );
}
