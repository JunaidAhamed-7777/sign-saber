# Gameplay media

Every active README photo and GIF was replaced with a fresh cloud capture on **2026-10-26**, after the avatar refinement was merged. The application source is **`16d97d2cafa1455ea1c00930f61e2597e67360fe`**. No application code changed for capture.

[cloud-capture.json](cloud-capture.json) records the source/asset hashes, file dimensions, exact clip boundaries, encoding, native UI actions and actual results. [Verification results](../evidence/2026-10-26-showcase-checks.json) record the fresh application gate, full-chart replays and SFX integrity check.

## What the footage shows

This is the actual production build running in native **Firefox ESR 153.5.0** on the cloud Linux desktop, using its default graphics/security settings. Native mouse/keyboard actions selected **Pamgaea → Normal → Enable sound → Watch auto-play**. The synthetic performer's landmarks passed through the real input pipeline and judge; no hits, scores, clocks or game state were injected.

The browser used a private, temporary PulseAudio null output so Web Audio's normal playback clock could run. No microphone was enabled and no audible-output/listening claim is made. This is camera-free auto-play, not a live-webcam demonstration.

The run reached genuine results: **25,060 score · 84 hits · 0 misses · 0 bad cuts · 84 best combo · 45.8% accuracy · D rank** (5 Perfect, 0 Great, 79 Good). The recorded result was not upgraded or retouched.

## Current files

| File | Actual content | Source and dimensions |
| --- | --- | --- |
| [hero.gif](hero.gif) | Slice, wall dodge and smash sequence | Recorded seconds **82–86**, **768 × 577**, 4 seconds |
| [slash.gif](slash.gif) | Smash, open-palm cut and the next impact | Recorded seconds **64.5–67.5**, **560 × 420**, 3 seconds |
| [beam.gif](beam.gif) | Point-and-hold charge, gold release and return to slicing | Recorded seconds **119–122.5**, **560 × 420**, 3.5 seconds |
| [gameplay.png](gameplay.png) | Wall dodge with an open-palm cut | Recorded second **83.700**, frame **2511**, **1364 × 1024** |
| [menu.png](menu.png) | Pamgaea selected, Normal difficulty, sound enabled | Recorded second **35**, frame **1050**, **1364 × 1024**, after the browser notice was dismissed |
| [results.png](results.png) | Completed 80-second arrangement and actual judgement counts | Native screenshot after completion, **1364 × 1024** |

The raw screen recording is **150 seconds / 4,500 frames / 30 fps**, H.264 CRF 16, with no audio. The three GIFs are silent **10 fps** excerpts at the original clock speed, resized with Lanczos and quantized to **128 colors** without dithering. Their combined size is **11,553,178 bytes**. These frame rates describe the recording/files, not measured game performance.

No frame is cropped, retouched or composited, and no score is changed. The original pointer may remain visible. Initial browser/loading/notice footage is not part of the selected gameplay. `results.png` was decoded from the native screenshot API's JPEG output into PNG; it is not claimed to originate as a lossless PNG screenshot. The other PNGs are decoded recording frames.

## Reproduction

Build and serve the unmodified app:

```sh
cd app
npm ci
npm run build
npm run preview -- --port 4186
```

Open the local address in a WebGL2-capable desktop browser, choose the track, enable sound and start **Watch auto-play**. Keep the game foregrounded through results. On the X11 capture desktop, the recording command was:

```sh
ffmpeg -f x11grab -draw_mouse 0 -framerate 30 -video_size 1364x1024 \
  -i "$DISPLAY" -t 150 -an -c:v libx264 -preset ultrafast -crf 16 \
  -threads 2 -pix_fmt yuv420p gameplay.mkv
```

The clip boundaries are recording timestamps, not song timestamps: startup/menu time is included before the round. Select timestamps from a newly inspected run rather than assuming they will repeat. For this exact recording, the hero encoder was:

```sh
ffmpeg -ss 82 -t 4 -i gameplay.mkv \
  -filter_complex "fps=10,scale=768:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" \
  -loop 0 hero.gif
```

The same filter uses width 560 for the shorter clips. Exact intervals, hashes and frame counts are retained in [cloud-capture.json](cloud-capture.json). The existing [Chrome capture harness](../../scripts/capture-readme.mjs) remains an alternative on a compatible Chrome environment; it was not the capture route used for these files.

## Historical evidence

[capture.json](capture.json), [interface-capture.json](interface-capture.json) and [menu-refined.png](menu-refined.png) retain earlier source-specific evidence. They do **not** describe the replacement files' current hashes. Their original media remains available in Git history; none of those older gameplay GIFs is reused in the active README.
