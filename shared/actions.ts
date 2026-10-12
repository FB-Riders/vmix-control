import { z } from 'zod';

// Every action the panel can trigger: POST /api/<name> with this JSON body.
// The server validates with these schemas; the client only imports the inferred types.
/** One on-screen graphic to show. Which fields are needed depends on the kind. */
export const gfxRequest = z.object({
  kind: z.enum(['opener', 'result', 'commentators', 'referees', 'text', 'coach', 'timeout', 'lineup', 'startingSix', 'goal', 'penalty', 'name', 'bestPlayer']),
  team: z.enum(['home', 'away']).optional(),
  player: z.string().optional(), // shirt number, or "own" for an own goal
  value: z.string().optional(), // result label id, penalty length, or "1" / "2" for a single commentator or referee
  text: z.string().max(300).optional(), // free text, or the period results under a result
});
export type GfxRequest = z.infer<typeof gfxRequest>;
export type GfxSide = NonNullable<GfxRequest['team']>;

export const actionSchemas = {
  program: z.object({ cam: z.string() }),
  preview: z.object({ cam: z.string() }),
  'replay/mark': z.object({ mark: z.string() }),
  'replay/type': z.object({ id: z.number().int(), type: z.string() }),
  'replay/cam': z.object({ id: z.number().int(), cam: z.string(), on: z.boolean() }),
  'replay/fav': z.object({ id: z.number().int(), fav: z.boolean() }),
  // Moves the start (in) and the end (out) of a scene by seconds; negative = earlier. The same value for both shifts it.
  'replay/trim': z.object({ id: z.number().int(), in: z.number().min(-60).max(60), out: z.number().min(-60).max(60) }),
  'replay/play': z.object({ id: z.number().int() }),
  'replay/preview': z.object({ id: z.number().int() }),
  'replay/delete': z.object({ id: z.number().int() }),
  'replay/period': z.object({ period: z.number().int().nonnegative().nullable() }), // null = follow the scoreboard
  'break/period': z.object({ period: z.number().int().nonnegative() }),
  'audio/preset': z.object({ preset: z.enum(['game', 'pause']) }),
  'audio/source': z.object({ id: z.string(), on: z.boolean() }),
  music: z.object({ play: z.boolean() }),
  'break/sound': z.object({ music: z.boolean() }),
  'sponsor/now': z.object({}), // next sponsor of the rotation, for the configured time
  'sponsor/show': z.object({ nr: z.number().int().positive() }), // this sponsor, until it is taken off
  'sponsor/hide': z.object({}),
  'sponsor/auto': z.object({ enabled: z.boolean() }),
  toggle: z.object({ what: z.enum(['stream', 'rec', 'replayRec', 'logos']), on: z.boolean() }),
  'schedule/set': z.object({
    id: z.string().optional(),
    time: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
    inMinutes: z.number().positive().max(600).optional(),
  }),
  'schedule/start': z.object({ id: z.string(), minutes: z.number().positive().max(60).optional() }),
  'schedule/end': z.object({ id: z.string() }),
  'schedule/shift': z.object({ minutes: z.number().min(-30).max(30), id: z.string().optional() }),
  'schedule/auto': z.object({ enabled: z.boolean() }),
  'stream/start': z.object({}),
  'settings/record': z.object({ enabled: z.boolean() }),
  'post/finish': z.object({}),
  'video/speed': z.object({ speed: z.number().min(10).max(100) }),
  'video/export': z.object({}),
  'gfx/import': z.object({ text: z.string().min(10).max(200_000) }), // a TCunihockey game config
  'gfx/show': gfxRequest,
  'gfx/next': z.object({}), // starting six: next player
  'gfx/hide': z.object({}),
  // Match clock by hand, when the link to the hall's scoreboard fails.
  'scoreboard/mode': z.object({ manual: z.boolean() }),
  'scoreboard/show': z.object({ on: z.boolean() }), // clock on or off its overlay channel
  'scoreboard/run': z.object({ on: z.boolean() }),
  'scoreboard/adjust': z.object({ seconds: z.number().int().min(-600).max(600) }),
  'scoreboard/time': z.object({ seconds: z.number().int().min(0).max(6000) }),
  'scoreboard/period': z.object({ period: z.string() }),
  'scoreboard/goal': z.object({ team: z.enum(['home', 'away']), delta: z.union([z.literal(1), z.literal(-1)]) }),
  'scoreboard/penalty': z.object({ team: z.enum(['home', 'away']), slot: z.number().int().min(1).max(2), seconds: z.number().int().min(0).max(1200) }),
  // A penalty of the given kind (as on the penalty buttons, e.g. "2'") on the clock, without a graphic.
  'scoreboard/addPenalty': z.object({ team: z.enum(['home', 'away']), label: z.string() }),
  'scoreboard/reset': z.object({ what: z.enum(['score', 'clock']) }), // the goal count, or time, period and penalties of the clock by hand
  // Penalty shoot-out display in place of the match clock.
  'shootout/show': z.object({ on: z.boolean() }),
  'shootout/shot': z.object({ team: z.enum(['home', 'away']), result: z.enum(['goal', 'miss']) }),
  'shootout/undo': z.object({ team: z.enum(['home', 'away']) }),
  'shootout/reset': z.object({ all: z.boolean() }), // circles only, or the whole shoot-out
  tick: z.object({ id: z.string(), done: z.boolean() }),
  'match/reset': z.object({}),
  'sim/start': z.object({ schedule: z.string().optional() }),
  'sim/stop': z.object({}),
  'schedule/action': z.object({ step: z.number().int().nonnegative(), id: z.string().optional() }),
  'break/clip': z.object({}),
} as const;

export type ActionName = keyof typeof actionSchemas;
export type ActionInput<K extends ActionName> = z.infer<(typeof actionSchemas)[K]>;
export type ToggleTarget = ActionInput<'toggle'>['what'];
export type AudioPreset = ActionInput<'audio/preset'>['preset'];

interface ActionResults {
  'replay/mark': { id: number; cams: string[] };
  'gfx/import': { game: boolean; sponsors: number }; // what the file held
}
export type ActionResult<K extends ActionName> = K extends keyof ActionResults ? ActionResults[K] : void;
