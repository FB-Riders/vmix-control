// The complete panel state the server pushes to every client (GET /api/events, server-sent events).
import type { AudioPreset } from './actions';

export interface CamState {
  id: string;
  role: string;
  program: boolean;
  preview: boolean;
}

export interface Score {
  home: string;
  away: string;
  period: string;
  clock: string;
  teams: string; // "Heim – Gast", empty if the scoreboard has no name fields
}

export interface ReplayEntry {
  id: number;
  time: string;
  period: number; // index into ReplayState.periods
  type: string;
  cams: string[];
  highlight: boolean; // has a copy in vMix's highlight tab
  seconds: number; // current length
  inShift: number; // seconds the start was moved since marking, negative = earlier
  outShift: number; // seconds the end was moved since marking
  locked: boolean; // always a highlight (e.g. goals), the star cannot be removed
  playing: boolean;
}

export interface ReplayState {
  seconds: number;
  types: string[];
  defaultType: string;
  cams: string[];
  marks: { id: string; label: string; sub: string; cams: string[] }[];
  list: ReplayEntry[]; // all scenes, newest first
  highlightCount: number;
  periods: { label: string; short: string; tab: number; count: number }[]; // one vMix event tab per period
  period: number; // period new scenes are filed under
  periodAuto: boolean; // it follows the scoreboard
  periodFromScoreboard: number | null; // what the scoreboard says, if readable
  breakPeriod: number; // period whose scenes the break clip shows
  highlightTab: number;
}

export interface AudioState {
  sources: { id: string; name: string; short: string; on: boolean; level: number }[]; // level 0..1
  preset: AudioPreset | null; // null while the sources are in a mixed state
}

export interface SponsorState {
  enabled: boolean;
  nextAt: number;
  activeUntil: number;
  intervalSec: number;
  durationSec: number;
  live: number | null; // number of the sponsor on screen; 0 = the sponsor input as it is in vMix
  next: number | null; // the sponsor the rotation shows next
  list: { nr: number; label: string }[];
  overlay: number;
}

export interface ScheduleStep {
  offset: number; // seconds relative to the anchor time, negative = before
  label: string;
  sub: string;
  tag: string; // e.g. "auto"
  auto: boolean; // the server triggers the action itself when the step is due
  pending: boolean; // must be triggered by the operator and has not been yet
  hero: string;
  durationSec: number;
  action: string | null; // button label, if the step triggers something in vMix
}

export interface ScheduleState {
  id: string;
  title: string;
  anchorLabel: string;
  anchor: number; // epoch ms
  steps: ScheduleStep[];
  all: { id: string; title: string; anchorLabel: string }[];
  starts: { id: string; label: string; sub: string; note: string }[]; // run-downs that can be started with one tap, e.g. the break
  start: { label: string; sub: string; note: string; minutes: number } | null; // this run-down's own one-tap start
  end: { label: string; sub: string } | null; // one-tap way out of it, e.g. back to the game
  running: boolean; // started with its one-tap start and not ended yet
  autoRun: boolean; // automatic steps are armed
  sim: SimState | null; // test run of the pre-game run-down, or its result
}

/** Test run: a run-down's steps are played through in vMix in quick succession, without a stream. */
export interface SimState {
  running: boolean;
  step: number; // step being processed; equals the number of steps once finished
  results: { ok: boolean; text: string }[]; // per processed step; text is the vMix error if it failed
}

/** A manual tick: `id` is what the `tick` action takes. */
export interface Tick {
  id: string;
  title: string;
  sub: string;
  done: boolean;
  auto: boolean; // decided by the panel from vMix's state, not tappable
}

export interface HealthState {
  watches: string[]; // what the panel keeps an eye on while streaming
  alerts: string[]; // what is wrong right now
  loudness: number | null; // estimated from the master meter, roughly LUFS
  loudnessTarget: number;
  commentaryOverAtmo: number | null; // dB
  commentaryTarget: number;
}

export interface ControllingItem {
  label: string;
  info: string;
  ok: boolean;
  post: boolean;
}

export interface VideoState {
  status: 'idle' | 'running' | 'done';
  step: number; // template item being recorded while running
  speed: number; // replay speed in percent
  speeds: number[];
  scenes: number;
  goals: number;
  totalSec: number;
  targetMinutes: [number, number];
  timeline: { title: string; note: string; seconds: number; required: boolean }[];
  uploadBy: number | null; // epoch ms, 4 h after the stream ended
  uploaded: Tick;
}

export interface PreGameState {
  kickoff: number; // epoch ms
  streamBy: number; // epoch ms, latest stream start
  recordGame: boolean; // STREAM STARTEN also starts vMix's local recording
  reminder: string;
  emergency: { title: string; text: string } | null;
  checklist: Tick[];
}

export interface PostGameState {
  steps: Tick[];
  finish: { label: string; sub: string } | null;
  interviews: Tick[];
  video: VideoState | null;
}

export interface GfxPlayer { nr: string; name: string; top: boolean } // top = top scorer

export interface GfxTeam {
  long: string;
  short: string;
  coach: string;
  players: GfxPlayer[];
  startingSix: GfxPlayer[]; // first goalie and first line
}

/** The link to the hall's Bodet Scorepad and what the console last said. */
export interface BodetState {
  connected: boolean; // the Scorepad (or its interface) is connected
  signal: 'none' | 'live' | 'stale'; // none: nothing received yet; stale: the data is old
  peer: string; // who is connected
  port: number;
  error: string; // the port could not be opened
  running: boolean;
  seconds: number; // game time
  period: string;
  score: { home: number; away: number }; // what the console shows; the title gets the panel's own count
  penalties: { home: number[]; away: number[] }; // seconds left per slot, 0 = free
  timeout: 'home' | 'away' | null; // team whose time-out is running
}

/** The match clock driven by hand instead of by the hall's scoreboard. */
export interface ManualScoreboardState {
  manual: boolean; // false: the scoreboard link fills the clock title
  bodet: BodetState | null; // null: the panel has no link of its own, another program fills the title
  counts: boolean; // the panel counts the goals itself (by hand, or with its own scoreboard link); false: the score is whatever the title shows
  onAir: boolean; // the clock is on its overlay channel
  runningSince: number | null; // server time the clock was started; null = it stands still
  elapsedMs: number; // game time as of runningSince (or now, if it stands still)
  limitMs: number; // the clock stops by itself here
  period: string;
  periods: string[];
  score: { home: number; away: number };
  penalties: { home: number[]; away: number[] }; // remaining ms per slot as of runningSince, 0 = free
}

export type Shot = 'goal' | 'miss';

/** Penalty shoot-out display. `row` = the circles of the current round, `goals` / `attempts` = the whole shoot-out. */
export interface ShootoutState {
  live: boolean;
  home: { row: Shot[]; goals: number; attempts: number };
  away: { row: Shot[]; goals: number; attempts: number };
  slots: number;
  overlay: number;
}

/** On-screen graphics filled from the game config (what TCunihockey used to do). */
export interface GfxState {
  game: { title: string; date: string; time: string; location: string; referees: string[]; commentators: string[] } | null;
  home: GfxTeam | null;
  away: GfxTeam | null;
  live: { kind: string; team?: 'home' | 'away'; summary: string; until: number | null; six: { shown: number; total: number } | null } | null;
  score: { home: string; away: string } | null; // as read from the scoreboard
  periods: string; // period results so far, e.g. "(1:0, 2:1)"
  penalties: string[];
  shortcuts: string[];
  results: { id: string; label: string }[];
  overlay: number;
}

/** One vMix overlay channel the panel uses, or that has something on it. */
export interface OverlayState {
  channel: number;
  role: string; // what the channel is for, e.g. "Matchuhr"; empty if the panel does not use it
  on: boolean; // vMix shows an input on it right now
  text: string; // what is on it, or (taken off for a replay) what comes back; empty if nothing
  paused: boolean; // taken off by the panel for a replay, the highlights or the break; comes back by itself
}

export interface PanelState {
  now: number; // server clock, epoch ms
  connected: boolean; // server reaches vMix
  streaming: boolean;
  recording: boolean;
  replayRecording: boolean;
  programTitle: string;
  overlays: OverlayState[]; // as vMix shows them, also if switched in vMix itself
  cams: CamState[];
  score: Score | null;
  replay: ReplayState;
  audio: AudioState | null;
  music: { name: string; track: string; playing: boolean } | null; // background music input
  gfx: GfxState | null; // null if no graphics are configured
  scoreboard: ManualScoreboardState | null; // null if no match clock is configured
  shootout: ShootoutState | null; // null if no shoot-out title is configured
  breakSound: { music: boolean } | null; // break video: its own sound, or muted with the background music over it
  sponsor: SponsorState | null;
  logos: { visible: boolean } | null; // all league logos are on
  health: HealthState;
  controlling: ControllingItem[];
  pre: PreGameState;
  post: PostGameState;
  schedule: ScheduleState; // the run-down that is active right now
  preRundown: ScheduleState; // the run-down to the first bully
  breakRundown: ScheduleState | null; // the break run-down, whether it is active or not
  warnings: string[];
}
