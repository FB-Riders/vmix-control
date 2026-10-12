# vMix Regie Panel

Mobile control surface for vMix. Runs on the vMix computer; every phone in the same network opens it in the browser.

## Run on the vMix computer

1. In vMix: **Settings → Web Controller → enable**, port `8088`.
2. Install [Node.js](https://nodejs.org) (LTS) once.
3. Double-click `start.bat`. It prints the address for the phones, e.g. `http://192.168.1.20:8090`.
   Allow Node through the Windows firewall (private networks) when asked.

`dist/` is the ready-built app and has no install step. The console lists all vMix inputs at start and flags
names in `config.json` that vMix does not know; the same warnings show at the bottom of the run-down screen.

Under the header every screen has the row **IM BILD**: one entry per vMix overlay channel (match clock, Einblender, sponsor, logos), lit while something is on it and saying what, e.g. the goal graphic's player or the sponsor's name. It is read from vMix, so it is also right when something was switched in vMix itself. A channel the panel took off for a replay, the highlights or the break says that it comes back by itself.

## Views

- **Phone** (narrow screens): LIVE and VOR SPIEL · PAUSE tabs. Alerts from the watchdogs show above the tab bar.
- **Desktop** (window at least 1000 px wide, e.g. on the vMix computer), three screens linked in the footer:
  - **Vor dem Spiel**: countdown to the latest stream start, one button for stream + recording + replay recording,
    the run-down to the bully, the checklist. Shown by default before kickoff; switches to Live once the stream runs
    and everything is ticked. Click "Spielbeginn" to set the kickoff time.
  - **Live**: cameras, replays, audio, run-down, controlling list. Keyboard: `Q W E` live, `A S D` preview; replays under the right hand:
    `U I O` mark replay, `H J K L` replay type; `G` sponsor, `N M` audio game / break (these three also on the Pause screen). Shortcuts only work while the browser
    window has focus, not while you are working in vMix.
  - **Pause**: choose the break length, PAUSE STARTEN, then ZURÜCK ZUM SPIEL when play resumes (the `end` block of
    the break run-down); in between the countdown, audio, highlights and sponsors. The panel switches to this screen
    when the break is started and back to Live when it is ended.
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

## On-screen graphics (Einblender)

The EINBLENDER screen replaces TCunihockey for everything except the match clock, which comes from the scoreboard.
It is grouped by vMix overlay channel: MATCHUHR (with the penalty shoot-out display, which takes its place),
EINBLENDER, SPONSOREN and LIGA-LOGOS. Each group's heading says what is on its channel right now and has the
button to put it on or take it off.

Load the game's `game-config.txt` there (the TCunihockey format written by <https://www.unihockey.live/generator>;
UTF-8, UTF-16 and ANSI files are read). The panel then fills the league's vMix titles and fades them in on one
overlay channel, one at a time:

| Graphic | vMix title (`graphics.titles`) | Filled with |
| --- | --- | --- |
| Opener, result | `board` | team names; date, time and location (`graphics.opener`), or the score read from the scoreboard with the period results the panel has tracked |
| Commentators, referees, free text | `leagueInfo` | label and names from `[Game]` |
| Coach, time-out | `teamInfo` | `Coach` / `Headcoach` of the team |
| Goal, penalty | `playerEvent` | current score or penalty length, number, name |
| Name, best player | `playerName` | number, name |
| Line-up | `lineupHome` / `lineupAway` | `Line1`–`Line4`, `Goal`, coach |
| Match clock by hand | `scoreboard.input` | not from the game config: see below |
| Penalty shoot-out | `graphics.shootout.input` | not from the game config: five circles per team, coloured per attempt (`colors.goal` / `miss` / `open`); goes on the match clock's overlay channel in its place, names and score copied from the clock title |
| Starting six | `startingSix` | the six of `Starting6` in that order (without it: first goalie and first line); fades in with the team logo, then the stepper brings on one player at a time (the title's animation pages `Page1`–`Page6`) |

**Match clock by hand.** Normally the hall's scoreboard fills the clock title. If that link fails, the switch
"Matchuhr von Hand" on the Einblender screen hands the title to the panel: it carries on from the time, period and
score the title shows, and from then on writes game time (counts up, stops at `scoreboard.manual.periodMinutes`),
period, score and two penalties per team (they run with the game time and vanish at 00:00). `+1` leaves the clock running;
set `stopOnGoal` to `true` to have a goal stop it. Switched off, the panel writes nothing into the title any more. Do not run both at once: if the
scoreboard link still writes, the two overwrite each other.

Keyboard on the desktop (listed at the bottom of the screen): `Esc` takes the graphic off, `N` brings on the next
player of the starting six, `M` puts the match clock on or off. With the clock by hand: space starts and stops it,
`←` `→` correct the time by 1 s (10 s with Shift), `H` / `G` count a goal for home / away (Shift takes one off),
and `2` `4` `5` start a 2', 2'+2' or 5' penalty on the clock for the home team (Shift: away team).

Goal, penalty, name and best player graphics go off by themselves after 8 s (`graphics.autoHideSec`, kind → seconds;
add e.g. `"timeout": 8`, or remove an entry to keep that graphic on). All others stay until AUSBLENDEN.

Names are written in capitals; a player whose name is filed under `00` gets the top scorer icon. Team logos are
only set if `graphics.logoPath` names the folder with `<TeamShort>.png` on the vMix computer. Labels
(`graphics.labels`), penalty lengths and shortcut texts are in `config.json`. `dev/examples/` holds the league's
example game config.

## Debug bar

"Debug" at the right end of the desktop footer (or `?debug` in the address, also on a phone) opens a bar at the
bottom. Left: what the panel currently believes about vMix (program, preview, overlays, replay state, period and
tab, running sequences, sound direction). Right: what it did lately, newest first: actions from the screens, every
command sent to vMix with its response time, the sound direction's decisions, sequences starting and ending, and
errors. The log can be filtered, paused and copied. It is served by `GET /api/debug`.

## How replays are filed in vMix

The panel keeps a book of vMix Replay's event tabs (`server/replays.ts`), because vMix does not report which events a
tab holds. Every scene lives in the tab of its period (tabs 11 to 14 by default); every highlight additionally as a
copy in the highlight tab (10). The period comes from the scoreboard or is set by hand on the live screen. vMix can
only act on the last or the selected event of the tab that is showing, so the panel switches to the tab, selects the
last event and steps back to the one that is meant. This only stays correct if events in these tabs are created,
copied and deleted through the panel alone, and if the tabs are empty when a new game starts ("Neues Spiel" clears
the panel's book, not vMix).

## Preview during sequences

While a sequence runs (pre-game steps, break, back to the game, end of game, highlight video) the panel keeps the
next picture in vMix's preview: a clip rewound to its first frame, or the camera that follows. It still takes each
picture to program itself, so nothing depends on what is in preview at that moment, but the operator sees what
comes next, and after a replay reel vMix returns to exactly that input. Outside of sequences the panel leaves
preview to the operator.

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
| `cams[].input` | vMix input name (or number / GUID) of each camera. Anywhere an input is named, `Name*` matches by prefix, which is needed for list inputs whose title includes the current item. `replayCamera` is its camera number 1–8 in vMix Replay. vMix plays the angles of an event in that order, so the camera that should come first needs the lowest number. |
| `scoreboard` | Title input and its field names for score, period, clock and team names. `overlay` is the overlay channel it runs on. Remove the block if there is none. |
| `replay.seconds` | Length of a marked replay (seconds back from live). |
| `replay.fps` | Frame rate of the vMix project. In and out points are moved in frames, so one second is this many. |
| `replay.marks` | The mark buttons and which cameras each one keeps in the event. |
| `replay.periods` | One vMix Replay event tab per period (`label`, `short`, `tab`). New scenes are created in the tab of the current period. |
| `replay.highlightTab` | Event tab that holds copies of all highlights; the highlight video and the end-of-game clip play it. |
| `replay.autoHighlightTypes` | Replay types that always count as highlights (goals). Everything else needs the ★. |
| `replay.highlightMusic` | Audio input started with the highlight reel (`Restart`, `AudioOn`, `Play`) and paused when the scenes are over. |
| `replay.hideScoreboard` | Take the scoreboard overlay off while a replay plays and put it back afterwards. |
| `audio` | `sources` are the inputs the SPIEL / PAUSE buttons switch (`role`: `commentary` / `atmo`). `music` is a background music input with its own play / pause control. `breakVideo` names the break video; the PAUSE screen can swap its sound for the music (applied by the `breakSound` panel step). `loudnessTarget`, `loudnessTolerance`, `loudnessOffset`, `commentaryOverAtmo` drive the loudness watchdog. |
| `sponsor` | The sponsor overlay. `inputs[0]` is the league's sponsor title; `list` holds up to eight sponsors (`label`, `title` above the logo, `picture` = full path of the logo on the vMix computer) that are put into it one at a time, `order` the automatic rotation (positions in `list`, repeats allowed). Automatic: a sponsor every `intervalSec` (fade-in to fade-in) for `durationSec`; swiss unihockey asks for 8 s shown and 170 s pause. It waits while a replay runs and takes a shown sponsor off when one starts. Loading TCunihockey's system config on the Einblender screen (`[Sponsor01]`–`[Sponsor08]`, `[SponsorAuto]`) replaces `list`, `order` and the times. With an empty list the inputs are faded in as they are, in turn. |
| `logos` | League logo inputs and their overlay channels. They stay on for the whole broadcast, also through breaks, highlights and ad clips; all of them must be on for the controlling. |
| `logosOffFor` | The only inputs that run without the logos (the official league trailer): while one is on program the panel takes the logos off and puts them back afterwards. |
| `schedules` | Run-downs. The first one is the pre-game run-down, its anchor is the kickoff. `at` is relative to the anchor (`-08:00` = 8 min before). An `action` is a list of calls (below), with `"auto": true` it runs by itself. A `start` block gives the run-down a one-tap start button (PAUSE STARTEN) that sets the anchor to now + `minutes` and runs its calls; an `end` block gives it a one-tap way out (ZURÜCK ZUM SPIEL). |
| `preGame` | `streamLeadMinutes`, `onStreamStart` (calls STREAM STARTEN runs first, e.g. mute the microphones and start music), `recordGame` (default of the "Spiel lokal aufnehmen" switch), the `reminder` text, the `emergency` card and the `checklist`. Checklist items with `auto` (`cams`, `logos`) are ticked by the panel. |
| `controlling` | The controlling list. `check` is one of `streamLead`, `onAir` (input was on program; optionally in the n-th `round` of a `schedule`), `logos`, `audio`, `stalls`, `noInterruption`, `videoExported`, `ticks`. `post: true` shows the item only after the game. |
| `postGame` | Wrap-up `steps`, the `finish` sequence (ABSCHLUSS), `interviews` and the `highlightVideo` template. |

Calls in `action.calls`, `start.calls`, `end.calls` and `finish.calls` are vMix API calls such as
`{ "Function": "CutDirect", "Input": "Resultat" }`, video clips `{ "clip": "Name.mp4" }` (lined up in vMix's preview,
taken to program from the start; the sequence goes on when the clip has finished, or at once with `"wait": false`
for a looping clip), pauses `{ "wait": 500 }`, or panel steps `{ "panel": "…" }`:
`audioPause`, `audioGame`, `logosOn`, `logosOff`, `overlaysOff` (all overlay channels except the league logos off and kept off) / `overlaysOn` (put the same ones back), `highlightClip` (intro clips, highlight reel, outro clips from `replay.highlightClip`; without highlights only the intro clips run), `playHighlights`, `waitPlayback` (until the replay is over), `startAll`, `stopAll`

A step can also show an on-screen graphic filled from the loaded game config, exactly as the Einblender screen does:
`{ "gfx": { "kind": "lineup", "team": "away" } }`, and `{ "gfx": "hide" }` to take it off again. The pre-game
"Aufstellungen" step uses this for both line-ups. Without a loaded game config the panel warns and the step shows nothing.
(stream, recording and replay recording). If one call fails the rest still runs and the failure shows as an alert.

Restart `start.bat` after changing `config.json`. "Neues Spiel" on the pre-game screen clears checklist, controlling
and the panel's replay list (also needed after a test run on match day).

## What each control sends to vMix

| Control | vMix function |
| --- | --- |
| LIVE row | `CutDirect` |
| PREVIEW row | `PreviewInput` |
| STREAM STARTEN / `stopAll` | `Start/StopStreaming`, `Start/StopRecording`, `ReplayStart/StopRecording` |
| Replay mark | `ReplaySelectEventsN` (tab of the current period), `ReplayMarkInOutLive`, `ReplayLastEventSingleCameraOn`, `ReplayLastEventCameraOn`, `ReplaySetLastEventText` |
| Replay type / camera chips | `ReplaySet…EventText`, `Replay…EventCameraOn/Off`; older events are reached with `ReplaySelectLastEvent` + `ReplaySelectPreviousEvent` |
| Replay PLAY | `ReplayPlayLastEventToOutput`, or select + `ReplayPlaySelectedEventToOutput` for older ones (transition/stinger comes from vMix's replay settings). Events are addressed by how many were marked after them, so create replay events only through the panel. |
| Replay preview (eye button) | `PreviewInput` on the replay input, then `ReplayPlayLastEvent` / `ReplayPlaySelectedEvent`. Refused while the replay is on air. |
| Replay delete | `ReplayDeleteLastEvent` / `ReplayDeleteSelectedEvent`. A copy already in the highlight list stays there. |
| Replay timing | `ReplayMoveSelectedInPoint` / `ReplayMoveSelectedOutPoint`, in frames (`replay.fps`, default 50), on the original and its highlight copy. Locked, both move together and the length stays; unlocked, start and end move on their own. |
| ★ / goals | Copy into the highlight tab at once (`ReplayCopy…Event`, target tab counted from 0); removing the star deletes that copy again. Type and camera changes are applied to the original and the copy. |
| Break clip / end clip | `ReplaySelectEventsN` + `ReplayPlayAllEventsToOutput` on the period's tab resp. the highlight tab, with all overlays off and the highlight music. |
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
