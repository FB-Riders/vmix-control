import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { gfxRequest } from '../shared/actions';

const vmixCall = z.union([
  z.object({ wait: z.number().positive() }),
  // A video clip: lined up in vMix's preview, taken to program from its start, and (unless wait is false, e.g. for a
  // looping clip) the sequence goes on when it has finished. `seconds` overrides the clip's own length.
  z.object({ clip: z.string(), wait: z.boolean().default(true), seconds: z.number().positive().optional() }),
  // Things the panel does itself rather than a single vMix function.
  z.object({ panel: z.enum(['audioGame', 'audioPause', 'playHighlights', 'highlightClip', 'periodClip', 'breakSound', 'overlaysOff', 'overlaysOn', 'waitPlayback', 'startAll', 'stopAll', 'logosOn', 'logosOff']) }),
  // An on-screen graphic filled from the game config (as on the Einblender screen), or "hide" to take it off again.
  z.object({ gfx: z.union([z.literal('hide'), gfxRequest]) }),
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
    // The clock driven from the panel when the link to the hall's scoreboard fails (league clock title only).
    manual: z.object({
      periodMinutes: z.number().positive().default(20),
      stopOnGoal: z.boolean().default(false), // true: a goal also stops the clock, as TCunihockey can
      // By hand, a penalty graphic also starts the penalty on the clock. Lengths not listed (10') stay off the clock.
      penaltyClock: z.record(z.string(), z.number().int().positive()).default({ "2'": 120, "2'+2'": 240, "5'": 300 }),
      penaltyColor: z.string().default('#FFF000FF'), // box of a running penalty, as in the title: red, green, blue, opacity
      periods: z.array(z.string()).default(['1', '2', '3', 'O', 'P']),
    }).prefault({}),
    // The link to the hall's Bodet Scorepad. Without it another program has to fill the clock title.
    bodet: z.object({
      enabled: z.boolean().default(true),
      mode: z.enum(['listen', 'connect']).default('listen'), // listen: the Scorepad connects to this computer; connect: the panel dials the RJ45/RS232 interface
      host: z.string().default(''), // listen: address to bind (empty = all); connect: address of the interface
      port: z.number().int().min(1).max(65535).default(4001),
      staleMs: z.number().positive().default(5000),
      overtime: z.string().default('O'), // period field during extra time, as the clock by hand shows it
      timeoutGraphic: z.boolean().default(true), // a time-out on the console fades the team's time-out graphic in and out
    }).optional(),
    overlay: z.number().int().min(1).max(8).optional(),
  }).optional(),
  replay: z.object({
    seconds: z.number().positive(),
    fps: z.number().positive().default(50), // vMix moves in and out points by frames
    channel: z.string().default(''),
    // vMix Replay event tabs: one per period for the marked scenes, one for the highlights (copies of starred scenes).
    periods: z.array(z.object({ label: z.string(), short: z.string(), tab: z.number().int().min(1).max(20) })).min(1).default([
      { label: '1. Drittel', short: '1', tab: 11 },
      { label: '2. Drittel', short: '2', tab: 12 },
      { label: '3. Drittel', short: '3', tab: 13 },
      { label: 'Verlängerung', short: 'VL', tab: 14 },
    ]),
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
    breakVideo: z.string().optional(), // break video whose sound can be swapped for the music; it may run inside another input (a frame around it)
    breakSound: z.enum(['video', 'music']).default('video'), // what a break starts with: the video's own sound, or the video muted under the music list
    loudnessTarget: z.number().default(-16),
    loudnessTolerance: z.number().default(3),
    loudnessOffset: z.number().default(0), // calibration of the estimate against a real loudness meter
    commentaryOverAtmo: z.number().default(10),
  }).optional(),
  sponsor: z.object({
    inputs: z.array(z.string()),
    overlay: z.number().int().min(1).max(8),
    intervalSec: z.number().positive(), // automatic rotation: from one fade-in to the next
    durationSec: z.number().positive(),
    // Sponsors put into the first input (the league's sponsor title) one at a time: button label, heading above the
    // logo, full path of the logo on the vMix computer. Empty = the inputs are shown as they are.
    list: z.array(z.object({ label: z.string(), title: z.string().default(''), picture: z.string() })).max(8).default([]),
    order: z.array(z.number().int().positive()).default([]), // rotation as positions in `list`, from 1; empty = as listed
  }).optional(),
  logos: z.array(z.object({ name: z.string(), input: z.string(), overlay: z.number().int().min(1).max(8) })).default([]),
  // The league wants its logos on for the whole broadcast. Only these inputs run without them (the official league trailer).
  logosOffFor: z.array(z.string()).default([]),
  // On-screen graphics from the game config, shown through the league's vMix titles.
  graphics: z.object({
    overlay: z.number().int().min(1).max(8).default(2),
    logoPath: z.string().default(''), // folder with <TeamShort>.png on the vMix computer; empty = leave the logos alone
    logoExt: z.string().default('.png'),
    titles: z.object({
      board: z.string(), leagueInfo: z.string(), teamInfo: z.string(), playerEvent: z.string(), playerName: z.string(),
      lineupHome: z.string(), lineupAway: z.string(), startingSix: z.string(),
    }),
    opener: z.object({ top: z.string(), main: z.string(), bottom: z.string() }).default({ top: '{date}', main: '{time}', bottom: '{location}' }),
    penalties: z.array(z.string()).default(["2'", "2'+2'", "5'", "10'"]),
    shortcuts: z.array(z.string()).default([]),
    // Graphics that go off by themselves, kind -> seconds on screen. All others stay until they are taken off.
    autoHideSec: z.record(z.string(), z.number().positive()).default({ goal: 8, penalty: 8, name: 8, bestPlayer: 8 }),
    // Penalty shoot-out display: takes the match clock's place on its overlay channel. Colours of the five circles per team.
    shootout: z.object({
      input: z.string(),
      colors: z.object({ open: z.string().default('#FFFFFF'), goal: z.string().default('#2EA043'), miss: z.string().default('#CD1619') }).prefault({}),
    }).optional(),
    labels: z.object({
      ownGoal: z.string().default('Eigentor'),
      startingSix: z.string().default('Starting 6'),
      bestPlayer: z.string().default('Best Player'),
      timeout: z.string().default('Time Out'),
      coach: z.string().default('Coach'),
      commentator: z.string().default('Kommentar'),
      referee: z.string().default('Schiedsrichter'),
      lineup: z.string().default('Aufstellung'),
      lines: z.array(z.string()).default(['Linie 1', 'Linie 2', 'Linie 3', 'Linie 4']),
      goalies: z.string().default('Goalies'),
      result: z.object({
        first: z.string().default('Resultat 1. Drittel'),
        second: z.string().default('Resultat 2. Drittel'),
        third: z.string().default('Resultat 3. Drittel'),
        end: z.string().default('Schlussresultat'),
        overtime: z.string().default('Schlussresultat (n.V.)'),
        penalties: z.string().default('Schlussresultat (n.P.)'),
      }).prefault({}),
    }).prefault({}),
  }).optional(),
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
  const tabs = [...cfg.replay.periods.map((p) => p.tab), cfg.replay.highlightTab];
  if (new Set(tabs).size !== tabs.length) {
    console.error(`config.json: Die Replay-Tabs müssen alle verschieden sein (Abschnitte ${tabs.slice(0, -1).join(', ')}, Highlights ${cfg.replay.highlightTab})`);
    process.exit(1);
  }
  return cfg;
}
