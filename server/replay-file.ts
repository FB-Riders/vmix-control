// Reads the file vMix Replay keeps of its events ("replay2.xml" in the replay session folder). The API does not
// report which events a list holds; this file does. vMix rewrites it when an event is created or the replay
// recording starts or stops, so a text or an in/out point changed since then is not in it yet.

/** One event as vMix holds it. */
export interface FileEvent {
  id: number; // vMix's own number; a copy gets the next free one
  start: number; // in point, seconds into the recording
  seconds: number; // length
  cameras: number[]; // replay cameras that are on, 1 to 8
  text: string; // first text column
  at: number | null; // wall clock of the in point, epoch ms; null if the recording does not cover it
}

const TICKS = 10_000_000; // the file counts in 100 ns
const inner = (xml: string, tag: string) => xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] ?? '';
const all = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]);
const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** The events of every list that has any, by list number (1 to 20, as in vMix's "Events" tabs), in vMix's order. */
export function parseReplayFile(xml: string): Record<number, FileEvent[]> {
  const events = inner(xml, 'events');
  if (!/<replay>/.test(xml) || !/<list\b/.test(events)) throw new Error('keine Replay-Datei von vMix');

  // The first camera's recording segments tell at what time of day a position in the recording was.
  const segments = all(inner(xml, 'stream'), 'segment')
    .map((s) => ({ at: Date.parse(inner(s, 'timestamp').replace(/(\.\d{3})\d+/, '$1')), start: Number(inner(s, 'videoStartTime')) }))
    .filter((s) => Number.isFinite(s.at) && Number.isFinite(s.start))
    .sort((a, b) => a.start - b.start);
  const clock = (ticks: number) => {
    const seg = segments.findLast((s) => s.start <= ticks);
    return seg ? seg.at + (ticks - seg.start) / (TICKS / 1000) : null;
  };

  const lists: Record<number, FileEvent[]> = {};
  let number = 0;
  for (const list of events.matchAll(/<list\b[^>]*?(?:\/>|>([\s\S]*?)<\/list>)/g)) {
    number++;
    const found = all(list[1] ?? '', 'event').map((e): FileEvent => {
      const start = Number(inner(e, 'inPoint'));
      const text = all(e, 'description').map((d) => decode(d).trim())[0] ?? '';
      return {
        id: Number(inner(e, 'id')),
        start: start / TICKS,
        seconds: Math.round(((Number(inner(e, 'outPoint')) - start) / TICKS) * 10) / 10,
        cameras: all(e, 'selectedAngles').flatMap((on, i) => (on.trim() === 'True' ? [i + 1] : [])),
        text: text === '-' ? '' : text, // vMix fills an empty column with a dash
        at: clock(start),
      };
    });
    if (found.length) lists[number] = found;
  }
  return lists;
}
