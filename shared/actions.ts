import { z } from 'zod';

// Every action the panel can trigger: POST /api/<name> with this JSON body.
// The server validates with these schemas; the client only imports the inferred types.
export const actionSchemas = {
  program: z.object({ cam: z.string() }),
  preview: z.object({ cam: z.string() }),
  'replay/mark': z.object({ mark: z.string() }),
  'replay/type': z.object({ id: z.number().int(), type: z.string() }),
  'replay/cam': z.object({ id: z.number().int(), cam: z.string(), on: z.boolean() }),
  'replay/fav': z.object({ id: z.number().int(), fav: z.boolean() }),
  'replay/play': z.object({ id: z.number().int() }),
  'replay/preview': z.object({ id: z.number().int() }),
  'replay/delete': z.object({ id: z.number().int() }),
  'audio/preset': z.object({ preset: z.enum(['game', 'pause']) }),
  'audio/source': z.object({ id: z.string(), on: z.boolean() }),
  'sponsor/now': z.object({}),
  'sponsor/auto': z.object({ enabled: z.boolean() }),
  toggle: z.object({ what: z.enum(['stream', 'rec', 'replayRec', 'logos']), on: z.boolean() }),
  'schedule/set': z.object({
    id: z.string().optional(),
    time: z.string().regex(/^\d{1,2}:\d{2}$/).optional(),
    inMinutes: z.number().positive().max(600).optional(),
  }),
  'schedule/start': z.object({ id: z.string(), minutes: z.number().positive().max(60).optional() }),
  'schedule/shift': z.object({ minutes: z.number().min(-30).max(30), id: z.string().optional() }),
  'schedule/auto': z.object({ enabled: z.boolean() }),
  'stream/start': z.object({}),
  'settings/record': z.object({ enabled: z.boolean() }),
  'post/finish': z.object({}),
  'video/speed': z.object({ speed: z.number().min(10).max(100) }),
  'video/export': z.object({}),
  tick: z.object({ id: z.string(), done: z.boolean() }),
  'match/reset': z.object({}),
  'sim/start': z.object({ schedule: z.string().optional() }),
  'sim/stop': z.object({}),
  'schedule/action': z.object({ step: z.number().int().nonnegative(), id: z.string().optional() }),
  'highlights/play': z.object({}),
} as const;

export type ActionName = keyof typeof actionSchemas;
export type ActionInput<K extends ActionName> = z.infer<(typeof actionSchemas)[K]>;
export type ToggleTarget = ActionInput<'toggle'>['what'];
export type AudioPreset = ActionInput<'audio/preset'>['preset'];

interface ActionResults {
  'replay/mark': { id: number; cams: string[] };
}
export type ActionResult<K extends ActionName> = K extends keyof ActionResults ? ActionResults[K] : void;
