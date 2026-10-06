import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const vmixCall = z.union([
  z.object({ wait: z.number().positive() }),
  // Things the panel does itself rather than a single vMix function.
  z.object({ panel: z.enum(['audioGame', 'audioPause', 'playHighlights', 'highlightClip', 'periodClip', 'breakSound', 'overlaysOff', 'overlaysOn', 'waitPlayback', 'startAll', 'stopAll', 'logosOn', 'logosOff']) }),
  z.object({
    Function: z.string(),
    Input: z.union([z.string(), z.number()]).optional(),
    Value: z.union([z.string(), z.number()]).optional(),
    Duration: z.number().optional(),
    Mix: z.number().optional(),
  }),
]);
export type VmixCall = z.infer<typeof vmixCall>;

const schedule = z.object({
  id: z.string(),
  title: z.string(),
  anchorLabel: z.string(),
  anchorTime: z.string().optional(),
  // One-tap start, e.g. the break: anchor = now + minutes, then the calls run.
  start: z.object({ label: z.string(), sub: z.string().default(''), note: z.string().default(''), minutes: z.number().positive(), calls: z.array(vmixCall).default([]) }).optional(),
  // One-tap end, e.g. back from the break: runs the calls; the run-down counts as over from then on.
  end: z.object({ label: z.string(), sub: z.string().default(''), calls: z.array(vmixCall).default([]) }).optional(),
  steps: z.array(z.object({
    at: z.string(),
    label: z.string(),
    sub: z.string().default(''),
    tag: z.string().default(''),
    hero: z.string().optional(),
    durationSec: z.number().optional(),
    // auto: the server runs the calls by itself when the step is due (only while streaming and auto-run is on).
    // required: has no fixed time; it stays the next thing to do until the operator has triggered it.
    action: z.object({ label: z.string(), auto: z.boolean().default(false), required: z.boolean().default(false), calls: z.array(vmixCall) }).optional(),
  })),
});

const configSchema = z.object({
  port: z.number().default(8090),
  vmix: z.object({ host: z.string().default('127.0.0.1'), port: z.number().default(8088) }),
  cams: z.array(z.object({ id: z.string(), role: z.string(), input: z.string(), replayCamera: z.number().int().min(1).max(8) })).min(1),
  scoreboard: z.object({
    input: z.string(),
    home: z.string().default(''),
    away: z.string().default(''),
    period: z.string().default(''),
    periodFormat: z.string().default('{}'), // e.g. "{}. Drittel" when the title only holds the number
    clock: z.union([z.string(), z.array(z.string())]).default(''), // several fields are joined (clock split into digits)
    homeName: z.string().default(''),
    awayName: z.string().default(''),
    overlay: z.number().int().min(1).max(8).optional(),
  }).optional(),
  replay: z.object({
    seconds: z.number().positive(),
    channel: z.string().default(''),
    // vMix Replay event tabs: one per period for the marked scenes, one for the highlights (copies of starred scenes).
    periods: z.array(z.object({ label: z.string(), short: z.string(), tab: z.number().int().min(1).max(20) })).min(1),
    highlightTab: z.number().int().min(1).max(20).default(10),
    autoHighlightTypes: z.array(z.string()).default([]),
    hideScoreboard: z.boolean().default(false),
    highlightMusic: z.string().default(''), // audio input played under the highlight reel
    // Clips shown before and after the reel by the `highlightClip` step; the whole block is skipped without highlights.
    highlightClip: z.object({ intro: z.array(z.string()).default([]), outro: z.array(z.string()).default([]) }).default({ intro: [], outro: [] }),
    defaultType: z.string(),
    types: z.array(z.string()).min(1),
    marks: z.array(z.object({ id: z.string(), label: z.string(), sub: z.string(), cams: z.array(z.string()).min(1) })).min(1),
  }),
  audio: z.object({
    sources: z.array(z.object({ id: z.string(), name: z.string(), short: z.string(), input: z.string(), role: z.enum(['commentary', 'atmo']).optional() })).min(1),
    music: z.object({ name: z.string(), input: z.string() }).optional(), // background music with its own play/pause control
    breakVideo: z.string().optional(), // break video whose sound can be swapped for the music
    loudnessTarget: z.number().default(-16),
    loudnessTolerance: z.number().default(3),
    loudnessOffset: z.number().default(0), // calibration of the estimate against a real loudness meter
    commentaryOverAtmo: z.number().default(10),
  }).optional(),
  sponsor: z.object({
    inputs: z.array(z.string()),
    overlay: z.number().int().min(1).max(8),
    intervalSec: z.number().positive(),
    durationSec: z.number().positive(),
  }).optional(),
  logos: z.array(z.object({ name: z.string(), input: z.string(), overlay: z.number().int().min(1).max(8) })).default([]),
  preGame: z.object({
    streamLeadMinutes: z.number().positive().default(30),
    onStreamStart: z.array(vmixCall).default([]), // run by STREAM STARTEN before the stream goes out
    recordGame: z.boolean().default(true), // default of the "record the game locally" switch
    reminder: z.string().default(''),
    emergency: z.object({ title: z.string(), text: z.string() }).optional(),
    checklist: z.array(z.object({
      id: z.string(), title: z.string(), sub: z.string().default(''),
      auto: z.enum(['cams', 'logos']).optional(), // ticked by the panel from vMix's state
      onlyIf: z.enum(['recordGame']).optional(), // only part of the list while that setting is on
    })).default([]),
  }).default({ streamLeadMinutes: 30, onStreamStart: [], recordGame: true, reminder: '', checklist: [] }),
  controlling: z.array(z.object({
    label: z.string(),
    check: z.enum(['streamLead', 'onAir', 'logos', 'audio', 'stalls', 'noInterruption', 'videoExported', 'ticks']),
    minutes: z.number().optional(), // streamLead
    input: z.string().optional(), // onAir
    schedule: z.string().optional(), // onAir: only while this run-down is active ...
    round: z.number().int().optional(), // ... for the n-th time today
    ids: z.array(z.string()).optional(), // ticks
    post: z.boolean().default(false), // only relevant after the game
  })).default([]),
  postGame: z.object({
    steps: z.array(z.object({ id: z.string(), title: z.string(), info: z.string().default('') })).default([]),
    finish: z.object({ label: z.string(), sub: z.string().default(''), calls: z.array(vmixCall) }).optional(),
    interviews: z.array(z.object({ id: z.string(), title: z.string(), sub: z.string().default('') })).default([]),
    highlightVideo: z.object({
      targetMinutes: z.tuple([z.number(), z.number()]).default([3, 5]),
      speeds: z.array(z.number().min(10).max(100)).default([75, 100]),
      template: z.array(z.union([
        z.object({ highlights: z.literal(true) }),
        z.object({ title: z.string(), input: z.string(), seconds: z.number().positive().optional(), required: z.boolean().default(false) }),
      ])),
    }).optional(),
  }).default({ steps: [], interviews: [] }),
  schedules: z.array(schedule).min(1),
});
export type Config = z.infer<typeof configSchema>;

export function loadConfig(root: string): Config {
  const file = path.join(root, 'config.json');
  const parsed = configSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (!parsed.success) {
    console.error(`config.json ist ungültig:\n${z.prettifyError(parsed.error)}`);
    process.exit(1);
  }
  const cfg = parsed.data;
  const camIds = new Set(cfg.cams.map((c) => c.id));
  for (const m of cfg.replay.marks) for (const c of m.cams) {
    if (!camIds.has(c)) { console.error(`config.json: Replay-Markierung «${m.id}» nennt unbekannte Kamera «${c}»`); process.exit(1); }
  }
  return cfg;
}
