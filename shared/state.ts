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
  period: string; // period at the time of marking
  type: string;
  cams: string[];
  highlight: boolean; // goes into the highlight list
  locked: boolean; // always a highlight (e.g. goals), the star cannot be removed
  playing: boolean;
}

export interface ReplayState {
  seconds: number;
  types: string[];
  defaultType: string;
  cams: string[];
  marks: { id: string; label: string; sub: string; cams: string[] }[];
  list: ReplayEntry[];
  highlightCount: number;
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
}

export interface ScheduleStep {
  offset: number; // seconds relative to the anchor time, negative = before
  label: string;
  sub: string;
  tag: string; // e.g. "auto"
  auto: boolean; // the server triggers the action itself when the step is due
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

export interface PanelState {
  now: number; // server clock, epoch ms
  connected: boolean; // server reaches vMix
  streaming: boolean;
  recording: boolean;
  replayRecording: boolean;
  programTitle: string;
  cams: CamState[];
  score: Score | null;
  replay: ReplayState;
  audio: AudioState | null;
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
