import { useRef } from 'react';
import { toast } from 'sonner';
import type { GfxState } from '@shared/state';
import { Button } from '@/components/ui/button';
import { act } from '@/lib/api';
import { cn } from '@/lib/utils';

/** Reads a config file whatever its encoding: TCunihockey accepts UTF-8, UTF-16 and ANSI. */
async function readText(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return new TextDecoder('windows-1252').decode(bytes); }
}

/** A file picker for a game config or a sponsor list: render `input` somewhere, call `open` from a button. */
export function useConfigFile() {
  const ref = useRef<HTMLInputElement>(null);

  async function load(file: File | undefined) {
    if (!file) return;
    const res = await act('gfx/import', { text: await readText(file) });
    if (res) {
      const { game, sponsors } = res.result;
      toast.success(`«${file.name}» geladen: ${[game && 'Spiel', sponsors > 0 && `${sponsors} Sponsoren`].filter(Boolean).join(' und ')}`);
    }
    if (ref.current) ref.current.value = '';
  }

  return {
    open: () => ref.current?.click(),
    input: <input ref={ref} type="file" accept=".txt,text/plain" className="hidden" onChange={(e) => load(e.target.files?.[0])} />,
  };
}

/** Which game is loaded, and the button to load one. Comes first on the pre-game screen: the graphics depend on it. */
export function GameConfig({ gfx }: { gfx: GfxState }) {
  const { open, input } = useConfigFile();
  const { game, home, away } = gfx;
  return (
    <div className="flex items-center gap-3 rounded-md bg-card p-3">
      {input}
      <div className="flex min-w-0 grow flex-col gap-0.5">
        <span className="truncate text-sm font-semibold">{home && away ? `${home.long} – ${away.long}` : 'Keine Spiel-Konfiguration geladen'}</span>
        <span className="truncate text-xs font-light text-muted-foreground">
          {game ? [game.date, game.time, game.location].filter(Boolean).join(' · ') : 'game-config.txt von unihockey.live/generator'}
        </span>
      </div>
      <Button
        variant="outline"
        className={cn('h-11 shrink-0 border-2 px-3 text-xs font-black', game ? 'border-secondary bg-background' : 'border-muted-foreground bg-muted-foreground text-background hover:bg-muted-foreground hover:text-background')}
        onClick={open}
      >
        {game ? 'NEU LADEN' : 'KONFIG LADEN'}
      </Button>
    </div>
  );
}
