import type { SponsorState } from '@shared/state';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useNow } from '@/hooks/use-now';
import { act } from '@/lib/api';
import { KEYS } from '@/lib/format';
import { mmss } from '@/lib/time';
import { cn } from '@/lib/utils';

function useCountdown(sponsor: SponsorState): string | null {
  const now = useNow();
  if (sponsor.live !== null) return 'läuft';
  return sponsor.enabled ? mmss((sponsor.nextAt - now) / 1000) : null;
}

/** Live screen (phone): shows the sponsor overlay now; the label tells when the automatic one is due. */
export function SponsorButton({ sponsor }: { sponsor: SponsorState }) {
  const countdown = useCountdown(sponsor);
  return (
    <Button
      variant="outline"
      className="h-12 flex-col gap-px border-2 border-secondary bg-secondary text-xs font-black"
      aria-label="Sponsor-Einblender jetzt zeigen"
      onClick={() => act('sponsor/now')}
    >
      SPONSOR
      <span className="text-[10px] font-light tabular-nums">{countdown ? `Auto · ${countdown}` : 'jetzt zeigen'}</span>
    </Button>
  );
}

/** Desktop: "now" button with the status next to it. */
export function SponsorRow({ sponsor }: { sponsor: SponsorState }) {
  const countdown = useCountdown(sponsor);
  const every = `alle ${Math.round(sponsor.intervalSec / 60)} Min`;
  return (
    <div className="flex items-center gap-3">
      <Button
        variant="outline"
        className="h-11 w-[88px] shrink-0 border-2 border-secondary bg-secondary text-[13px] font-black"
        onClick={() => act('sponsor/now')}
      >
        JETZT
      </Button>
      <div className="flex flex-col gap-0.5">
        <span className="text-[13px] font-medium">Sponsor-Einblender · {sponsor.enabled ? `Auto ${every}` : 'Manuell'}</span>
        <span className="text-xs font-light text-muted-foreground tabular-nums">
          {countdown === 'läuft' ? 'läuft gerade' : countdown ? `nächster in ${countdown}` : 'Automatik aus'} · Taste {KEYS.sponsor}
        </span>
      </div>
    </div>
  );
}

/** Ablauf screen: switch for the automatic sponsor overlay. */
export function SponsorAuto({ sponsor }: { sponsor: SponsorState }) {
  const countdown = useCountdown(sponsor);
  return (
    <section className="flex items-center justify-between gap-3 rounded-md bg-card p-3">
      <div className="flex min-w-0 flex-col">
        <span className="text-sm font-semibold">Sponsor-Einblender automatisch</span>
        <span className="text-xs font-light text-muted-foreground tabular-nums">
          alle {Math.round(sponsor.intervalSec / 60)} Min für {sponsor.durationSec} s · {countdown === 'läuft' ? 'läuft gerade' : countdown ? `nächster in ${countdown}` : 'aus'}
        </span>
      </div>
      <Switch
        checked={sponsor.enabled}
        onCheckedChange={(enabled) => act('sponsor/auto', { enabled })}
        aria-label="Sponsor-Automatik"
      />
    </section>
  );
}

/**
 * Einblender screen: every sponsor by hand (stays until taken off; another one can be picked while one is on),
 * and the automatic rotation with the sponsor that comes next.
 */
export function SponsorPanel({ sponsor }: { sponsor: SponsorState }) {
  const next = sponsor.list.find((s) => s.nr === sponsor.next);
  const tile = 'h-11 border-2 px-1 text-xs font-black';
  return (
    <>
      {sponsor.list.length > 0 ? (
        <div className="grid grid-cols-2 gap-1.5">
          {sponsor.list.map((s) => {
            const live = sponsor.live === s.nr;
            return (
              <Button
                key={s.nr}
                variant={live ? 'default' : 'outline'}
                className={cn(tile, live ? 'border-primary' : 'border-secondary bg-secondary')}
                aria-pressed={live}
                aria-label={live ? `Sponsor ${s.label} ausblenden` : `Sponsor ${s.label} einblenden`}
                onClick={() => (live ? act('sponsor/hide') : act('sponsor/show', { nr: s.nr }))}
              >
                <span className="truncate">{live ? `${s.label.toUpperCase()} · AUS` : s.label.toUpperCase()}</span>
              </Button>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          <Button variant="outline" className={cn(tile, 'border-secondary bg-secondary')} onClick={() => act('sponsor/now')}>JETZT ZEIGEN</Button>
          <Button variant="outline" className={cn(tile, 'border-secondary bg-secondary')} disabled={sponsor.live === null} onClick={() => act('sponsor/hide')}>AUSBLENDEN</Button>
        </div>
      )}
      <SponsorAuto sponsor={sponsor} />
      <span className="text-xs font-light text-muted-foreground">
        {sponsor.list.length > 0
          ? `Automatik: als nächstes ${next?.label ?? '-'}. Während eines Replays wartet sie; ein eingeblendeter Sponsor geht dann weg.`
          : 'Keine Sponsoren-Liste geladen: der Sponsor-Titel wird gezeigt, wie er in vMix steht. TCunihockeys System-Konfiguration mit [Sponsor01] hier laden.'}
      </span>
    </>
  );
}
