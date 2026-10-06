# vMix Regie Panel

Mobile control surface for vMix. Runs on the vMix computer; every phone in the same network opens it in the browser.

## Run on the vMix computer

1. In vMix: **Settings → Web Controller → enable**, port `8088`.
2. Install [Node.js](https://nodejs.org) (LTS) once.
3. Double-click `start.bat`. It prints the address for the phones, e.g. `http://192.168.1.20:8090`.
   Allow Node through the Windows firewall (private networks) when asked.

`dist/` is the ready-built app and has no install step. The console lists all vMix inputs at start and flags
names in `config.json` that vMix does not know; the same warnings show at the bottom of the run-down screen.

## Views

- **Phone** (narrow screens): LIVE and VOR SPIEL · PAUSE tabs. Alerts from the watchdogs show above the tab bar.
- **Desktop** (window at least 1000 px wide, e.g. on the vMix computer), three screens linked in the footer:
  - **Vor dem Spiel**: countdown to the latest stream start, one button for stream + recording + replay recording,
    the run-down to the bully, the checklist. Shown by default before kickoff; switches to Live once the stream runs
    and everything is ticked. Click "Spielbeginn" to set the kickoff time.
  - **Live**: cameras, replays, audio, run-down, controlling list. Keyboard: `F1–F3` live, `1–3` preview, `Q W E` mark
    replay, `A S D F` replay type, `G` sponsor, `H J` audio game / break. Shortcuts only work while the browser
    window has focus, not while you are working in vMix.
  - **Pause**: choose the break length, PAUSE STARTEN, countdown to the bully, the break run-down, audio, highlights
    and sponsors. The panel switches to this screen when the break is started and back to Live at the bully.
  - **Nach dem Spiel**: wrap-up steps, ABSCHLUSS (ends the stream), highlight video, interviews, full controlling list.

## What the panel checks by itself

Based on the swiss unihockey livestream controlling. While the stream runs the panel watches (bar under the header):

| Watchdog | How it is detected |
| --- | --- |
| Audio drop-out | Master meter silent for 2 s while the audio sources are not muted on purpose. |
| Loudness | **Estimate** from the master meter over the last 30 s, not a true LUFS measurement. Compare it once with vMix's loudness meter and correct with `audio.loudnessOffset`. |
| Commentary over atmo | Difference of the two source meters (`role` in `audio.sources`). |
| League logos missing | One of the `logos` inputs is not on its overlay channel. |
| Clip stalled on air | A video input is on program but not playing (frozen or black). An empty replay channel cannot be detected. |

The **controlling list** is filled from what actually went out: when the stream started, which clips were on
program (and in which break), share of stream time with logos, drop-outs, stalls. vMix does not report bitrate,
dropped frames or the Hub's status, so those are not shown.

## Automatic steps

Run-down steps with `"auto": true` are triggered by the panel at their time, as long as the stream is running and
AUTO is on (button above the run-down). A step that is more than 4 s late is skipped, never caught up. `−1 Min` /
`+1 Min` move the whole run-down when the bully shifts. The ▶ next to a step triggers it by hand.

## Test run (Probelauf)

"▶ PROBELAUF" on the pre-game and break screens plays that run-down through in vMix without waiting for the clock
(for the break including what PAUSE STARTEN does):
every step is triggered in order, idle time between steps is cut to a few seconds, clips run in full. It really cuts
and plays in vMix, so it only starts while no stream is running, and it stops if a stream starts. Each step shows ✓ or
FEHLER with vMix's answer; ✓ means vMix accepted the commands, not that picture and sound were right.

## Highlight video

vMix cannot render a file from a playlist through its API. "HIGHLIGHT-VIDEO AUFNEHMEN" therefore plays the template
(`postGame.highlightVideo.template`: fixed clips and the highlight list) through the program output in real time
while vMix records it with its recording settings. All overlay channels are off for the whole recording and restored afterwards. It only starts when stream and recording are stopped; the file
ends up in vMix's recording folder. Clip lengths come from vMix, the scene length is replay seconds × angles ÷ speed.

## config.json

| Key | Meaning |
| --- | --- |
| `cams[].input` | vMix input name (or number / GUID) of each camera. `replayCamera` is its camera number 1–8 in vMix Replay. vMix plays the angles of an event in that order, so the camera that should come first needs the lowest number. |
| `scoreboard` | Title input and its field names for score, period, clock and team names. `overlay` is the overlay channel it runs on. Remove the block if there is none. |
| `replay.seconds` | Length of a marked replay (seconds back from live). |
| `replay.marks` | The mark buttons and which cameras each one keeps in the event. |
| `replay.mainList` / `highlightList` | vMix replay event lists (1–20) used for marking and for the highlight video. |
| `replay.autoHighlightTypes` | Replay types that always count as highlights (goals). Everything else needs the ★. |
| `replay.highlightMusic` | Audio input started with the highlight reel (`Restart`, `AudioOn`, `Play`) and paused when the scenes are over. |
| `replay.hideScoreboard` | Take the scoreboard overlay off while a replay plays and put it back afterwards. |
| `audio` | `sources` are the inputs the SPIEL / PAUSE buttons switch (`role`: `commentary` / `atmo`). `loudnessTarget`, `loudnessTolerance`, `loudnessOffset`, `commentaryOverAtmo` drive the loudness watchdog. |
| `sponsor` | Inputs shown in rotation on the given overlay channel, every `intervalSec` for `durationSec`. |
| `logos` | League logo inputs and their overlay channels. All of them must be on for LOGOS ● and the controlling. |
| `schedules` | Run-downs. The first one is the pre-game run-down, its anchor is the kickoff. `at` is relative to the anchor (`-08:00` = 8 min before). An `action` is a list of calls (below), with `"auto": true` it runs by itself. A `start` block gives the run-down a one-tap start button (PAUSE STARTEN) that sets the anchor to now + `minutes` and runs its calls. |
| `preGame` | `streamLeadMinutes`, `muteOnStreamStart` (STREAM STARTEN mutes the audio sources first), `recordGame` (default of the "Spiel lokal aufnehmen" switch), the `reminder` text, the `emergency` card and the `checklist`. Checklist items with `auto` (`cams`, `logos`) are ticked by the panel. |
| `controlling` | The controlling list. `check` is one of `streamLead`, `onAir` (input was on program; optionally in the n-th `round` of a `schedule`), `logos`, `audio`, `stalls`, `noInterruption`, `videoExported`, `ticks`. `post: true` shows the item only after the game. |
| `postGame` | Wrap-up `steps`, the `finish` sequence (ABSCHLUSS), `interviews` and the `highlightVideo` template. |

Calls in `action.calls`, `start.calls` and `finish.calls` are vMix API calls such as
`{ "Function": "CutDirect", "Input": "Resultat" }`, pauses `{ "wait": 500 }`, or panel steps `{ "panel": "…" }`:
`audioPause`, `audioGame`, `playHighlights`, `waitPlayback` (until the replay is over), `startAll`, `stopAll`
(stream, recording and replay recording). If one call fails the rest still runs and the failure shows as an alert.

Restart `start.bat` after changing `config.json`. "Neues Spiel" on the pre-game screen clears checklist, controlling
and the panel's replay list (also needed after a test run on match day).

## What each control sends to vMix

| Control | vMix function |
| --- | --- |
| LIVE row | `CutDirect` |
| PREVIEW row | `PreviewInput` |
| STREAM STARTEN / `stopAll` | `Start/StopStreaming`, `Start/StopRecording`, `ReplayStart/StopRecording` |
| Replay mark | `ReplayMarkInOutLive`, `ReplayLastEventSingleCameraOn`, `ReplayLastEventCameraOn`, `ReplaySetLastEventText` |
| Replay type / camera chips | `ReplaySet…EventText`, `Replay…EventCameraOn/Off`; older events are reached with `ReplaySelectLastEvent` + `ReplaySelectPreviousEvent` |
| Replay PLAY | `ReplayPlayLastEventToOutput`, or select + `ReplayPlaySelectedEventToOutput` for older ones (transition/stinger comes from vMix's replay settings). Events are addressed by how many were marked after them, so create replay events only through the panel. |
| Replay preview (eye button) | `PreviewInput` on the replay input, then `ReplayPlayLastEvent` / `ReplayPlaySelectedEvent`. Refused while the replay is on air. |
| Replay delete | `ReplayDeleteLastEvent` / `ReplayDeleteSelectedEvent`. A copy already in the highlight list stays there. |
| ★ / highlights | The star is kept in the panel. `playHighlights` copies new highlights to the highlight list (`ReplayCopy…Event`), then `ReplaySelectEventsN` + `ReplayPlayAllEventsToOutput`, and switches back to the main list afterwards. While the highlights play, every overlay channel, league logos included, is taken off (`OverlayInputNOut`) and put back afterwards. A highlight un-starred after it was copied stays in vMix's list. |
| Highlight video | `StartRecording`, per clip `Restart` + `CutDirect` + `Play`, `ReplaySetSpeed` + highlights, `StopRecording` |
| Audio | `AudioOn` / `AudioOff`; meters come from `meterF1/F2` in the vMix state |
| Sponsor, logos | `OverlayInputNIn` / `OverlayInputNOut` |

## Development

```
npm install
npm run mock    # fake vMix API on :8088, for working without vMix
npm run dev     # server on :8090 + Vite with hot reload on :5173
npm run build   # typecheck, build client to dist/public, bundle server to dist/server.cjs
```

Stack: React 19, TypeScript, Vite, Tailwind CSS 4, shadcn/ui (Radix) on the client; Hono + zod on the server.
`shared/` holds the action schemas and state types both sides use. State reaches the phones via server-sent events.
