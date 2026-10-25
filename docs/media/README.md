# README media

Real browser captures made on **2026-10-25 (+05:30)** from application source
`30572bb9cdbe345b79e8e48279019bd7d8b59877`. The documentation and capture harness were
being edited; application source was unchanged. [capture.json](capture.json) records
the UTC timestamps, browser/environment, actual UI actions/results, selected frame
times, file sizes and SHA-256 hashes.

The recording follows **Pamgaea → Enable sound → Watch auto-play**, at Normal
difficulty, in the production preview. The game builds its real 80-second
arrangement. A planned synthetic performer supplies landmarks through the normal
input pipeline and judge. **This is auto-play footage, not a webcam recording,
recognition benchmark or human performance.** No hit events, game clocks, scores or
renderer effects were injected. There are no mock-ups, AI-generated images or
composited UI elements.

The complete browser run reached **84 Perfect, 0 Great, 0 Good, 0 Miss and 0 Bad
cut**, with **100.0% accuracy, 54,700 score, 84 best combo and SS rank**. These are
the 84 notes in this generated arrangement, separate from the nine full bundled
charts exercised by the logic tests. The original UI labels, including the generic
“Playing” status on the results screen, are preserved.

## Files

- [hero.gif](hero.gif): wall dodge, beam release, slices and smashes; recorded
  seconds 50.6–54.6. Encoded as 32 frames at 720×450, 4.01 seconds.
- [slash.gif](slash.gif): open-palm cut followed by a fist smash; recorded seconds
  7.5–10.5. Encoded as 24 frames at 560×350, 3.01 seconds.
- [beam.gif](beam.gif): point-and-hold charge, gold target collapse and the next
  smash; recorded seconds 23.3–26.3. Encoded as 24 frames at 560×350, 3.01 seconds.
- [menu.png](menu.png): native 1440×900 PNG screenshot after selecting music and
  enabling sound.
- [slice.png](slice.png): actual open-palm contact and two capped target halves,
  selected at recorded second 7.910.
- [smash.png](smash.png): actual fist contact and magenta fragments, selected at
  recorded second 1.627.
- [beam.png](beam.png): actual gold target collapse, particles, Perfect judgement
  and Point HUD, selected at recorded second 6.576. This still shows the collapse;
  the GIF includes the preceding charge.
- [results.png](results.png): native 1440×900 PNG screenshot after the complete
  run.

All three GIFs are silent, full-viewport excerpts at their original clock speed.
Encoding resizes to the sizes above and uses 8 fps, a generated 64-color palette
and Bayer dithering. CDP frames are ordered by their compositor timestamps; frame
arrival order can differ. Gameplay stills are captured JPEG frames encoded as PNG
without retouching. Menu and results are native PNG captures. The eight media
files total **10,151,539 bytes**; the three GIFs account for **5,686,832 bytes**.
These encoded frame rates describe the files, not measured game FPS.

## Reproduce

Use Node 22+, Chrome (or `BROWSER_BINARY`) and ffmpeg on `PATH`. From `app/`, run
the existing production commands:

```powershell
npm run build
npm run preview -- --port 4186
```

In another terminal, from the repository root:

```powershell
node scripts/capture-readme.mjs --url http://127.0.0.1:4186 --song pamgaea
```

The [capture script](../../scripts/capture-readme.mjs) uses trusted CDP mouse
clicks on actual controls, records the complete run, saves menu/results PNGs and
prints a temporary directory holding raw frames and their timeline. To extract
the checked-in selections from that directory:

```powershell
node scripts/capture-readme.mjs --render "<temporary directory printed by capture>"
```

The exact extraction windows, palette/filter arguments and screenshot selections
are in the script; encoding details and output hashes are in the receipt. A new
capture can differ because audio arrangement generation and runtime scheduling
are exercised afresh. Inspect new screenshots, GIF frames and results before
replacing this evidence. Raw frames and browser profiles stay outside the
repository.

## Verification and limits

All five PNGs and contact sheets spanning all three GIFs were visually inspected.
ffprobe verified GIF dimensions, durations and frame counts. Capture script syntax
and Prettier checks passed. Chrome recorded one existing warning:
`THREE.BufferGeometry.toNonIndexed(): BufferGeometry is already non-indexed.`
No runtime console error or exception was recorded by the capture harness. The
warning is retained in the receipt.

The headless browser and screencast exercise visuals, scoring and the complete
auto-play-to-results flow. They do not establish live calibration, webcam gesture
accuracy, human comfort, audible synchronization, GPU performance or physical
motion-to-photon latency. The footage contains the project's authored scene and
local fonts, with no camera photo pixels or private recordings. See the main
[credits and licenses](../../README.md#credits-and-licenses) for asset attribution.
