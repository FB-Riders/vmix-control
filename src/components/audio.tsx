import type { AudioPreset } from '@shared/actions';
import type { AudioState } from '@shared/state';
import { Button } from '@/components/ui/button';
import { act } from '@/lib/api';
import { KEYS } from '@/lib/format';
import { cn } from '@/lib/utils';

interface PresetProps {
  audio: AudioState;
  preset: AudioPreset;
  desktop?: boolean;
}

/** One tap for all audio sources: on for the game, muted for the break. */
export function AudioPresetButton({ audio, preset, desktop }: PresetProps) {
  const game = preset === 'game';
  const active = audio.preset === preset;
  const all = audio.sources.length === 2 ? 'beide' : 'alle';
  const sub = game
    ? desktop ? `${all} an` : audio.sources.map((s) => s.short).join(' + ')
    : `${all} stumm`;
  return (
    <Button
      variant="outline"
      className={cn(
        'flex-col gap-px border-2 border-muted-foreground bg-background font-black',
        desktop ? 'h-14 text-[15px] tracking-widest' : 'h-12 text-xs',
        active && game && 'border-foreground bg-foreground text-background hover:bg-foreground hover:text-background',
        active && !game && 'border-primary bg-primary hover:bg-primary',
      )}
      aria-label={`Ton ${game ? 'Spiel' : 'Pause'}: ${sub}`}
      aria-pressed={active}
      onClick={() => act('audio/preset', { preset })}
    >
      {desktop ? (game ? 'SPIEL' : 'PAUSE') : game ? 'TON SPIEL' : 'TON PAUSE'}
      <span className={cn('font-light tracking-normal', desktop ? 'text-[11px]' : 'text-[10px]')}>
        {sub}{desktop && ` · Taste ${game ? KEYS.audioGame : KEYS.audioPause}`}
      </span>
    </Button>
  );
}

/** Desktop: mute switch and level meter per audio source. */
export function AudioSources({ audio }: { audio: AudioState }) {
  return (
    <>
      {audio.sources.map((s) => (
        <div key={s.id} className="flex items-center gap-3">
          <Button
            variant="outline"
            className={cn(
              'h-11 w-[88px] shrink-0 border-2 text-[13px] font-black',
              s.on ? 'border-foreground bg-foreground text-background hover:bg-foreground hover:text-background' : 'border-primary bg-primary hover:bg-primary',
            )}
            aria-label={`${s.name} ${s.on ? 'stummschalten' : 'einschalten'}`}
            aria-pressed={s.on}
            onClick={() => act('audio/source', { id: s.id, on: !s.on })}
          >
            {s.on ? 'AN' : 'STUMM'}
          </Button>
          <div className="flex min-w-0 grow flex-col gap-1.5">
            <span className="text-[13px] font-medium">{s.name}</span>
            <div className="h-2 rounded-sm bg-card" role="meter" aria-label={`Pegel ${s.name}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(s.level * 100)}>
              <div className="h-2 rounded-sm bg-foreground transition-[width] duration-300" style={{ width: `${s.level * 100}%` }} />
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
