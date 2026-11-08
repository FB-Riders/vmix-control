import { useEffect, useRef, useState } from 'react';
import type { OverlayState } from '@shared/state';
import { cn } from '@/lib/utils';

/** The clock on the clock's channel needs no second word; anything else on a channel is named. */
const onAirText = (o: OverlayState) => (o.text && o.text !== o.role ? o.text : o.on ? 'ein' : '');
const roleName = (o: OverlayState) => (o.role || `Overlay ${o.channel}`).toUpperCase();

/**
 * What vMix has on its overlay channels right now: one entry per channel, lit while something is on it.
 * Each channel has a fixed cell that cuts its text, so a graphic going on or off never makes the strip taller
 * and pushes the page below it (on a phone it would jump).
 *
 * `floating` (phone): once the strip is scrolled out of view, a bar floats pinned at the top of the page with
 * whatever is on air, or that nothing is; `actions` puts a button on a channel's line (the Einblender: AUSBLENDEN). The bar lies over the page and takes no room in it, so it appearing
 * or growing moves nothing.
 */
export function OverlayStrip({ overlays, className, floating, actions }: {
  overlays: OverlayState[];
  className?: string;
  floating?: boolean;
  actions?: Partial<Record<number, React.ReactNode>>; // per channel, shown in the floating bar while it is on
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [away, setAway] = useState(false);

  useEffect(() => {
    const el = strip.current;
    if (!floating || !el) return;
    // Watched against the pane the page scrolls in (on the phone it sits below the notch, not at the screen's top):
    // as soon as any part of the strip is cut off at its top, the bar takes over.
    let root: HTMLElement | null = el.parentElement;
    while (root && !/(auto|scroll)/.test(getComputedStyle(root).overflowY)) root = root.parentElement;
    const io = new IntersectionObserver(
      ([e]) => setAway(e.intersectionRatio < 1 && e.boundingClientRect.top < (e.rootBounds?.top ?? 0) + 1),
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [floating, overlays.length > 0]);

  if (!overlays.length) return null;
  const live = overlays.filter((o) => o.on);

  return (
    <>
      {floating && (
        // Zero height and sticky, right above the strip: it sticks to the top of the scrolling page as soon as the strip
        // starts to leave it, and takes no room in the page.
        <div className="sticky top-0 z-20 h-0">
          {away && (
            <div
              aria-label="Im Bild"
              className={cn(
                'absolute inset-x-0 top-0 flex items-start gap-x-4 border-b-2 bg-background px-4 py-2 text-xs shadow-lg shadow-black',
                live.length ? 'border-primary' : 'border-input',
              )}
            >
              <button type="button" aria-label="Im Bild, zum Anfang" className="flex min-h-7 shrink-0 items-center font-black tracking-widest" onClick={() => strip.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                IM BILD
              </button>
              <span className="flex min-w-0 grow flex-col gap-1">
                {live.length ? live.map((o) => (
                  <span key={o.channel} className="flex min-h-7 min-w-0 items-center gap-1.5">
                    <span className="shrink-0 text-primary">●</span>
                    <span className="shrink-0 font-medium tracking-widest">{roleName(o)}</span>
                    <span className="grow truncate font-semibold">{onAirText(o)}</span>
                    {actions?.[o.channel]}
                  </span>
                )) : (
                  <span className="flex min-h-7 min-w-0 items-center gap-1.5 text-dim">
                    <span className="shrink-0 text-input">●</span>
                    <span className="truncate font-light">nichts eingeblendet</span>
                  </span>
                )}
              </span>
            </div>
          )}
        </div>
      )}

      <div ref={strip} aria-label="Im Bild" data-overlay-strip className={cn('flex items-start gap-x-5 border-b text-xs', className)}>
        <span className="shrink-0 font-black tracking-widest">IM BILD</span>
        <div className="grid min-w-0 grow grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-1.5">
          {overlays.map((o) => (
            <span key={o.channel} className={cn('flex min-w-0 items-center gap-1.5', !o.on && 'text-dim')} title={o.on ? onAirText(o) : undefined}>
              <span className={cn('shrink-0', o.on ? 'text-primary' : 'text-input')}>●</span>
              <span className="shrink-0 font-medium tracking-widest">{roleName(o)}</span>
              {o.on
                ? <span className="truncate font-semibold text-foreground">{onAirText(o)}</span>
                : <span className="truncate font-light">{o.paused ? `${onAirText(o) || 'aus'} · kommt von selbst zurück` : 'aus'}</span>}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}
