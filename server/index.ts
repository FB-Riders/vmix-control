// vMix Regie Panel server: serves the built React app and translates its actions into vMix HTTP API calls.
import os from 'node:os';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { type ActionName, actionSchemas } from '../shared/actions';
import { loadConfig } from './config';
import { Panel, PanelError } from './panel';
import { VmixClient, VmixError } from './vmix';

const ROOT = process.cwd();
const cfg = loadConfig(ROOT);
const port = Number(process.env.PORT ?? cfg.port);
const vmixUrl = `http://${process.env.VMIX_HOST ?? cfg.vmix.host}:${process.env.VMIX_PORT ?? cfg.vmix.port}/api/`;
const panel = new Panel(cfg, new VmixClient(vmixUrl), ROOT);

const app = new Hono();

app.get('/api/events', (c) => streamSSE(c, async (stream) => {
  const unsubscribe = panel.subscribe((state) => { void stream.writeSSE({ data: JSON.stringify(state) }); });
  await new Promise<void>((resolve) => stream.onAbort(resolve));
  unsubscribe();
}));

// What the sound direction saw on program and what it switched, for troubleshooting.
app.get('/api/debug/sound', (c) => c.text(panel.soundLog.join('\n') || 'noch nichts'));

app.post('/api/:name{.+}', async (c) => {
  const name = c.req.param('name');
  if (!Object.hasOwn(actionSchemas, name)) return c.json({ error: 'Unbekannte Aktion' }, 404);
  const action = name as ActionName;
  const input = actionSchemas[action].safeParse(await c.req.json().catch(() => ({})));
  if (!input.success) return c.json({ error: 'Ungültige Anfrage' }, 400);
  try {
    const result = await panel.dispatch(action, input.data);
    return c.json({ ok: true, result: result ?? null });
  } catch (e) {
    if (e instanceof PanelError) return c.json({ error: e.message }, 400);
    return c.json({ error: e instanceof VmixError ? e.message : 'vMix nicht erreichbar' }, 502);
  }
});

app.use('*', serveStatic({ root: './dist/public' }));

serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, async () => {
  await panel.poll();
  const vm = panel.vmixState;
  console.log(`\nvMix Regie Panel läuft. vMix API: ${vmixUrl} (${vm ? `verbunden, vMix ${vm.version}` : 'NICHT erreichbar'})\n`);
  console.log('Auf dem Handy im gleichen Netzwerk öffnen:');
  for (const list of Object.values(os.networkInterfaces())) for (const a of list ?? []) {
    if (a.family === 'IPv4' && !a.internal) console.log(`  http://${a.address}:${port}`);
  }
  console.log(`  http://localhost:${port}  (dieser Computer)\n`);
  if (vm) {
    console.log('Inputs in vMix:');
    vm.inputs.forEach((i) => console.log(`  ${String(i.number).padStart(2)}  ${i.title}  [${i.type}]`));
    const w = panel.state().warnings;
    if (w.length) console.log(`\nBitte config.json prüfen:\n${w.map((x) => `  ! ${x}`).join('\n')}`);
    console.log('');
  }
  panel.start(500);
});
