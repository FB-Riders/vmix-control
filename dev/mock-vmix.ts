// Minimal stand-in for the vMix Web API, for trying the panel without vMix (e.g. on a Mac).
// Start with: npm run mock   (listens on port 8088)
import http from 'node:http';

interface MockInput { title: string; type: string; text?: Record<string, string>; colors?: Record<string, string>; audio?: number; muted?: boolean; duration?: number; layers?: string[]; number: number; key: string }

const inputs: MockInput[] = ([
  // Named as in the club's vMix preset, so config.json fits without changes.
  { title: 'Links', type: 'Capture' },
  { title: 'Haupt', type: 'Capture', audio: 0.04 },
  { title: 'Rechts', type: 'Capture' },
  { title: 'Replay', type: 'Replay' },
  { title: 'Replay B', type: 'ReplayPreview' },
  { title: 'Scoreboard', type: 'GT', text: { 'ScoreHome.Text': '2', 'ScoreAway.Text': '1', 'Period.Text': '2. Drittel', 'Clock.Text': '08:34', 'HomeName.Text': 'FB Riders', 'AwayName.Text': 'Gast' } },
  { title: 'Sponsor', type: 'Image' },
  { title: 'League ID', type: 'Image' },
  { title: 'LUPL-SU_league_id.gtzip', type: 'GT' },
  { title: 'LUPL-SU_scoreboard_penaltyshooting.gtzip', type: 'GT' },
  // As the scoreboard link leaves it: one digit per field.
  { title: 'LUPL-SU_scoreboard_clock.gtzip', type: 'GT', text: { 'TxtHomeScore.Text': '2', 'TxtAwayScore.Text': '1', 'TxtClockPeriod.Text': '2', 'TxtClockTimeM10.Text': '0', 'TxtClockTimeM01.Text': '8', 'TxtClockTimeT.Text': ':', 'TxtClockTimeS10.Text': '3', 'TxtClockTimeS01.Text': '4', 'TxtHomeName.Text': 'RIDERS', 'TxtAwayName.Text': 'GAST' } },
  ...['sponsor', 'board', 'league_info', 'team_info', 'team_player_event', 'team_player_name', 'team_lineup_home', 'team_lineup_away', 'team_startingsix'].map((t) => ({ title: `LUPL-SU_${t}.gtzip`, type: 'GT', colors: { 'RectTop.Fill.Color': '#FFF00000', 'RectBottom.Fill.Color': '#FFF00000' } })),
  { title: 'Livestream Pro', type: 'Image' },
  { title: 'Liga-Trailer', type: 'Video', duration: 60000 },
  { title: 'Liga-Trailer Short', type: 'Video', duration: 10000 },
  { title: 'Mobiliar-Clip', type: 'Video', duration: 12000 },
  { title: 'Lidl-Clip', type: 'Video', duration: 12000 },
  { title: 'Audio UR44C Input 1+2', type: 'Audio', audio: 0.12 },
  { title: 'Highlights - Music', type: 'AudioFile' },
  { title: 'Intro L-UPL.mp4', type: 'Video', duration: 27072 },
  { title: 'Only Women 4k v1.mp4', type: 'Video', duration: 4032 },
  { title: 'Intro_Floori_1080p.mp4', type: 'Video', duration: 8000 },
  { title: 'Pausenvideo_FBRiders_Loop_5min.mp4', type: 'Video', duration: 300000 },
  { title: 'Pause', type: 'Colour', layers: ['Pausenvideo_FBRiders_Loop_5min.mp4'] }, // the league's frame around the break video
  { title: 'Presenter - Lidl Schweiz Partner Unihockey Women v2.mp4', type: 'Video', duration: 6000 },
  { title: 'mob_jubel_web_D.mp4', type: 'Video', duration: 10000 },
  { title: 'General Music - 4. Never Be The Same.wav', type: 'VideoList', duration: 227894 },
  { title: 'Highlights - Sound - Ice and Flames.wav', type: 'AudioFile' },
] as Omit<MockInput, 'number' | 'key'>[]).map((i, n) => ({ ...i, number: n + 1, key: `00000000-0000-0000-0000-${String(n + 1).padStart(12, '0')}` }));

const s = { active: 2, preview: 1, streaming: false, recording: false, replayRec: true, events: 0, overlays: [0, 0, 0, 0] };
const playingClips = new Set<number>();
const bool = (b: boolean) => (b ? 'True' : 'False');
const find = (ref: string | null) => inputs.find((i) => i.title === ref || i.key === ref || String(i.number) === ref);

// Jittering meters so the level bars move like real audio.
function audioAttrs(i: MockInput): string {
  if (i.audio === undefined) return '';
  const level = i.audio * (0.6 + Math.random() * 0.8);
  return ` muted="${bool(!!i.muted)}" volume="100" meterF1="${level.toFixed(4)}" meterF2="${(level * 0.9).toFixed(4)}"`;
}

// Master follows the unmuted sources; a clip on air brings its own sound.
function masterLevel(): number {
  const live = inputs.filter((i) => i.audio !== undefined && !i.muted).reduce((sum, i) => sum + (i.audio ?? 0), 0);
  const clip = inputs.find((i) => i.number === s.active)?.type === 'Video' ? 0.15 : 0;
  return (live + clip) * (0.7 + Math.random() * 0.6);
}

function xml(): string {
  return `<vmix><version>29.0.0.0</version><inputs>${inputs.map((i) => `
<input key="${i.key}" number="${i.number}" type="${i.type}" title="${i.title}" state="${i.type !== 'Video' || playingClips.has(i.number) ? 'Running' : 'Paused'}" duration="${i.duration ?? 0}"${audioAttrs(i)}>${i.title}${
    Object.entries(i.text ?? {}).map(([k, v], n) => `<text index="${n}" name="${k}">${v}</text>`).join('')}${
    Object.entries(i.colors ?? {}).map(([k, v], n) => `<color index="${n}" name="${k}">${v}</color>`).join('')}${
    (i.layers ?? []).map((t, n) => `<overlay index="${n}" key="${inputs.find((x) => x.title === t)?.key ?? ''}" />`).join('')}${
    i.type === 'Replay' ? `<replay live="True" recording="${bool(s.replayRec)}" channelMode="AB" events="${s.events}" />` : ''}</input>`).join('')}
</inputs><audio><master volume="100" muted="False" meterF1="${masterLevel().toFixed(4)}" meterF2="${masterLevel().toFixed(4)}" /></audio><overlays>${s.overlays.map((o, n) => `<overlay number="${n + 1}">${o || ''}</overlay>`).join('')}</overlays>
<preview>${s.preview}</preview><active>${s.active}</active>
<recording>${bool(s.recording)}</recording><streaming>${bool(s.streaming)}</streaming></vmix>`;
}

function exec(fn: string, q: URLSearchParams): boolean {
  const inp = find(q.get('Input'));
  const ov = fn.match(/^OverlayInput(\d)(In|Out)$/);
  if (fn === 'CutDirect' || fn === 'Restart' || fn === 'Play' || fn === 'Pause') {
    if (!inp) return false;
    if (fn === 'CutDirect') s.active = inp.number;
    if (fn === 'Play') playingClips.add(inp.number);
  }
  else if (fn === 'AudioOn' || fn === 'AudioOff') { if (!inp) return false; inp.muted = fn === 'AudioOff'; }
  else if (fn === 'LoopOn') { if (!inp) return false; }
  else if (/^Set(Text|Image|Color|ImageVisibleOn|ImageVisibleOff)$/.test(fn)) {
    const name = q.get('SelectedName');
    if (!inp || !name) return false;
    if (fn === 'SetText') inp.text = { ...inp.text, [name]: q.get('Value') ?? '' };
    if (fn === 'SetColor') inp.colors = { ...inp.colors, [name]: q.get('Value') ?? '' };
  }
  else if (fn === 'TitleBeginAnimation') { if (!inp || !q.get('Value')) return false; }
  else if (fn === 'PreviewInput') { if (!inp) return false; s.preview = inp.number; }
  else if (fn === 'Cut' || fn === 'Fade') [s.active, s.preview] = [s.preview, s.active];
  else if (fn === 'ReplayMarkInOutLive') s.events++;
  else if (/^ReplayPlay(Last|Selected|All)Events?ToOutput$/.test(fn)) {
    const back = s.active;
    s.active = 5; // replay channel B, as in the real preset
    setTimeout(() => { s.active = back; }, 4000);
  }
  else if (ov) s.overlays[Number(ov[1]) - 1] = ov[2] === 'In' ? inp?.number ?? 0 : 0;
  else if (/^(Start|Stop)Streaming$/.test(fn)) s.streaming = fn.startsWith('Start');
  else if (/^(Start|Stop)Recording$/.test(fn)) s.recording = fn.startsWith('Start');
  else if (/^Replay(Start|Stop)Recording$/.test(fn)) s.replayRec = fn.includes('Start');
  else if (!/^Replay((Last|Selected)Event(SingleCameraOn|CameraOn|CameraOff)|Set(Last|Selected)EventText|Select(Last|Previous)Event|Copy(Last|Selected)Event|Delete(Last|Selected)Event|MoveSelected(In|Out)Point|Play(Last|Selected)Event|SelectEvents\d+|SetSpeed)$/.test(fn)) return false;
  return true;
}

http.createServer((req, res) => {
  const q = new URL(req.url ?? '/', 'http://x').searchParams;
  const fn = q.get('Function');
  if (!fn) { res.writeHead(200, { 'Content-Type': 'text/xml' }); res.end(xml()); return; }
  const ok = exec(fn, q);
  console.log(ok ? 'OK ' : 'ERR', req.url);
  res.writeHead(ok ? 200 : 500);
  res.end(ok ? 'Function completed successfully.' : 'Error');
}).listen(8088, () => console.log('Mock vMix API on http://127.0.0.1:8088/api/'));
