# 20 — Demo Script & Judging

A hackathon is judged in three minutes by tired people who have seen twenty projects. The demo is a product; it gets designed, rehearsed and QA'd like one. This document is the script, the stage plan, the failure drills and the answers. Rehearse it three times before wrap-up ([19 §H12](19-build-plan.md#h12--0630--qa--demo-3-h--0930)).

## The pitch

**One sentence.** *Sign Saber turns any webcam into a lightsaber dojo: stand up, pick any song, and fight the music with your bare hands while a neon reflection of your own body fights alongside you.*

**Three talking points** (say each once, in this order):

1. **Your body is the controller.** No headset, no pairing, no install. A judge can walk up and play in ten seconds. Open palm slices, fist smashes, pointing fires a laser, and you dodge walls with your whole body.
2. **Any song becomes a level.** Drop an MP3 and our own signal-processing pipeline finds the real beats and drums in under four seconds and builds the map on them. Not random noise, not canned content.
3. **It is engineered, not glued.** Tracking runs in a Web Worker, rendering holds 60 FPS on an integrated GPU, everything is bundled and works offline, and the whole system was specified in writing before we wrote code.

## Three-minute script

Owner A drives the laptop, Owner B talks. If solo, play and talk; the silhouette does the talking during gameplay.

| Time | On screen | Say | Notes |
| --- | --- | --- | --- |
| **0:00** | `SELECT` with the attract scene; A steps into frame; the silhouette appears and mirrors A | *(nothing for 4 seconds)* then: "That's a webcam. That's me." | The hook is visual. Do not speak over it. A waves once so the edge glow ripples. |
| **0:20** | Same | "Sign Saber turns any webcam into a lightsaber dojo. You fight the music with your bare hands." | One sentence. |
| **0:35** | A clicks Start → `CALIBRATION` | "It checks it can see my shoulders and both hands, I wave to confirm, and it counts me in on the beat." | Wave meter fills live. If the first tick is slow, A steps back half a step while B keeps talking. |
| **0:50** | `PLAYING`, bundled track *Neon Drift*, Normal | "Open palm slices." *(A slashes a cyan block; halves fall)* "Fist smashes the armoured ones." *(magenta block shatters)* "Point and hold to charge a laser for the distant ones." *(gold target poofs)* "And walls — you lean." *(A dodges a wall)* | Script the first 20 s of the demo map so these four appear in this order (bundled map is hand-checked for this). |
| **1:20** | The drop at ~0:30 of the track | *(stop talking)* | Camera punch, bloom bump, palette shift. Let it land. Resume: "Everything you see reacts to the audio — the edge colour of my silhouette is the bass, mids and treble." |
| **1:35** | Still playing, HUD visible | "Perfect, Great, Good windows, Beat Saber-style multiplier. Wrong gesture is a bad cut and resets the combo." | A deliberately bad-cuts one block so the glitch pop shows. |
| **1:50** | A presses `Esc`, Quit → `SELECT`; B hands over a USB stick / A opens a judge's MP3 from the Downloads folder | "Any song. Drop a file." *(progress bar)* "…and it's listening: spectral flux onsets, tempo tracking, beat alignment. Three and a half seconds." *(shows `128.0 BPM · 412 notes`)* | Ask the judges before the slot if one of them has an MP3; if not, use the pre-staged third track that is not in the library. |
| **2:05** | A starts the uploaded track, plays 12 seconds | "Notes land on the kicks and snares, not on noise — silence produces nothing." | Pick a track with a clear intro so the first notes visibly align. |
| **2:20** | A presses `Esc`, Quit; B switches to a pre-recorded `RESULTS` screenshot/tab, or A finishes the short bundled *demo-cut* (45 s) track to a real RESULTS | "Accuracy, rank, and how much kinetic energy you actually spent — and a 3D freeze of you at your peak combo." | Prefer the real 45-second demo-cut map for the first run so RESULTS is genuine. |
| **2:40** | Pitch deck slide 5 (tech) | "Two MediaPipe models in a Web Worker, our own DSP in another, Three.js at 60 FPS with a 40 floor on integrated graphics, zero network needed." | 15 seconds, no more. |
| **2:55** | Slide 6 (close) | "Sign Saber. Want to try?" | Hand the floor spot to a judge. |

Total speaking time ≈ 95 s; the rest is play. If the slot is 5 minutes, extend gameplay at 1:35 and the judge-plays protocol at the end; never extend the tech slide.

### While things load

BOOT takes 3–6 s on the demo laptop. Scripted filler, in order of need: "Models are local — the whole thing works with Wi-Fi off." → "Hand model, pose model, the segmentation mask comes free with pose." → "If you see the grid, we're there."

## Judge-plays protocol

1. **Position.** Point at the tape mark 2 m from the camera: "Stand on the tape, face the screen." Check the tracking pill goes `TRACKING OK` before clicking Start.
2. **Difficulty.** Always **Easy** for a judge. Say so: "Easy is the right one for a first go; the map is built from the same track."
3. **Brief, 10 seconds.** "Open hand, swipe through the cyan ones. Fist for the pink ones. Point and hold at the gold ones. Lean away from the red walls." Demonstrate each gesture once with your own hand while saying it.
4. **Calibration.** Coach with the on-screen line; do not touch the laptop.
5. **Cap at 30 seconds of play**, then `Esc` → Quit. Say: "That's the loop — the full track is three minutes." Judges remember the feeling, not the length.
6. If tracking is poor on the judge (dark clothing, backlight), run the lighting drill (§Failure drills) once; if still poor, thank them and play yourself.

## Stage setup

| Item | Setting |
| --- | --- |
| Laptop | On a stand, screen at chest height (~1.2 m), tilted so the camera points level at the player's chest |
| Camera | 1.5 m height if using an external webcam; lens level, not tilted up |
| Player spot | 2.0 m from the camera, marked with a tape cross on the floor; arm span test: both arms out stay in frame |
| Light | A lamp or ring light on the laptop side facing the player; **no window or bright screen behind the player** |
| Background | Plain, static. Ask neighbours not to walk through the frame during the slot |
| Display | External monitor or TV mirrored (not extended) if available, `F11` fullscreen; else the laptop screen with brightness at max |
| Audio | Small speaker via 3.5 mm, volume set so the kick is felt but speech is heard; test from the judge's position |
| Power | Mains connected; battery saver off; lid open |
| Peripherals | Mouse for menus; USB stick with `demo-judge.mp3` and the fallback video |

## Pre-demo checklist

Run 15 minutes before the slot, in this order; every box must be ticked.

- [ ] `npm run build && npm run preview` (or the dev server) is serving; the tab is `http://localhost:4173` (or 5173).
- [ ] **Network-off test**: disable Wi-Fi, reload, BOOT reaches `SELECT`. Re-enable only if the YouTube path will be shown.
- [ ] Correct camera selected in Chrome's camera permission (site settings) if the laptop has several.
- [ ] `chrome://gpu` shows WebGL2 hardware accelerated; `chrome://flags` has no experimental overrides.
- [ ] All other tabs and apps closed; notifications paused (Focus assist / Do Not Disturb); screen sleep disabled.
- [ ] Fullscreen `F11`; browser zoom 100 %.
- [ ] Dev overlay off (`D`), quality tier shows `high` or `medium` in the debug overlay before turning it off.
- [ ] Audio: click once in the page so the `AudioContext` is unlocked; play 2 s of the bundled track.
- [ ] Calibration pass by the presenter from the tape mark; tracking rate ≥ 24 Hz.
- [ ] App reset to `SELECT`, bundled *Neon Drift* selected, Normal.
- [ ] USB stick mounted; `demo-judge.mp3` and `fallback.mp4` open in Explorer/Finder behind the browser.
- [ ] Phone with the pitch deck as backup display.

## Failure drills

Each drill is one sentence to say and one action to take. Practise them.

| Failure | Early signal | Say | Do |
| --- | --- | --- | --- |
| Camera denied / black | BOOT error card `CAMERA ACCESS DENIED` | "Permission prompt — one second." | Click the camera icon in the address bar → Allow → Retry. If still black: Chrome site settings → camera → pick the other device → reload. |
| Tracking flaky (bad light / backlight) | Tracking pill flickers; calibration tick 1 keeps regressing; silhouette edge noisy | "Lighting — let me turn the lamp." | Move the lamp to face the player; close the blind/screen behind. Then toggle **high-contrast mode** (`H` in dev builds, or `?contrast=1` query flag: raises the mask threshold and edge gain, see [10](10-rendering-silhouette.md)). |
| Audio not playing | Song progress moves, no sound | "Browser autoplay policy — a click fixes it." | Click anywhere on the page (the player resumes the suspended `AudioContext` on first gesture). Check speaker volume second. |
| Generator slow or stuck | Progress bar stalls > 8 s | "Big file — I'll use a bundled track and show the upload after." | `Esc` on the upload (cancels the worker); select a library track. Retry the upload with the shorter pre-staged file afterwards. |
| YouTube offline | Field disabled with offline copy | "The YouTube bridge is a local helper and optional — upload is the main path." | Skip; drop the MP3. Never try to start the server live. |
| Frame drops / stutter | HUD stutters; debug overlay p95 > 25 ms | "Switching to a lighter tier." | Press `T` to cycle the quality tier down once. Close anything that opened. |
| Tracking lost mid-play | Auto `PAUSED` with "step back into frame" | "It pauses itself when it can't see you — that's a feature." | Step back onto the tape; the 3-2-1 resume runs itself. |
| Hands swapped / gesture wrong | Left indicator reacts to the right hand | "Mirror check." | Face the camera squarely; show both palms; MediaPipe re-labels within a second. |
| Hard crash / white screen | — | "Reloading — four seconds." | `F5`. BOOT is ≤ 6 s offline. If it repeats, show the fallback video. |
| Everything is on fire | Two drills failed | "Here's thirty seconds we recorded at 4 AM." | Play `fallback.mp4` fullscreen, narrate the three talking points over it. |

## Fallback video

- Recorded at **H10 (≈ 04:30)** per [19](19-build-plan.md#h7--0130--wow-pass-3-h--0430) with Windows Game Bar / QuickTime at 1080p60, 30 seconds: 5 s attract silhouette, 20 s gameplay including a drop, 5 s RESULTS.
- Stored at `assets-src/demo/fallback.mp4` (git-ignored if > 50 MB; also on the USB stick and the phone).
- Used only when two drills have failed or the camera is physically unavailable. Say explicitly that it is a recording.

## Pitch deck outline (6 slides, phone + laptop)

1. **Title** — Sign Saber, one-sentence pitch, team names. Background: a still of the silhouette.
2. **The idea** — "Your body is the controller": three gesture icons + lean icon, one line each.
3. **Any song** — screenshot of the upload progress + BPM result; one line on the pipeline (onsets → tempo → beats → notes).
4. **The feel** — three stills: slice halves, shatter shards, beam poof; caption "every input has a kinetic payoff".
5. **Under the hood** — diagram from [02](02-architecture.md): worker, main thread, audio clock; numbers: 60 FPS target / 40 floor, < 4 s generation, 0 network calls at runtime.
6. **Close** — "Want to try?" + repository URL + QR code.

## What the judges will read

`README.md` top section and `SUBMISSION.md` are read before or after the slot. They MUST contain, verbatim-consistent with the demo:

- Project name, the one-sentence pitch, team and handles.
- Working demo instructions that actually work from a fresh clone: `npm install`, `npm run models`, `npm run dev`, open the URL, allow camera.
- Technology stack with links: Three.js, MediaPipe Tasks Vision, postprocessing, Vite, React, Zustand, yt-dlp (optional), Blender (assets).
- Current status: working features, known limitations (lighting sensitivity, single player, no directional notes, YouTube optional), and the libraries/datasets with attribution (CC0 tracks named).
- The final commit SHA and the link to `AI_USAGE.md` and `CHANGELOG.md`.

## Anticipated questions

| Question | Answer (≤ 20 s) |
| --- | --- |
| How much latency is there? | "Motion-to-photon is 70–130 ms: camera, inference in a worker, render. We judge hits on the frame's capture time, not arrival, and the timing windows are sized for it — Perfect is ±60 ms, Good ±200 ms." |
| How accurate is the tracking? | "MediaPipe hands and pose at 24–30 Hz. We smooth with a One Euro filter and require three consistent frames before a gesture changes, so you get stability without visible lag." |
| Why not MediaPipe's GestureRecognizer? | "It only knows 'pointing up', not pointing at the screen, and it's a black box. Three gestures with big geometric differences are a few angle rules we can test and tune." |
| How is this different from Beat Saber? | "No hardware, your whole body is in it — you dodge by leaning — and three gestures with three different destruction effects instead of one saber. And any song, generated in seconds." |
| How does the beatmap generator avoid noise? | "Band-wise spectral flux with an adaptive threshold finds onsets; we track tempo and beats, then keep only onsets that align to the beat grid and exceed a strength threshold. Silence yields nothing." |
| What did AI do versus you? | "Honestly recorded in AI_USAGE.md. We wrote the spec first; AI helped scaffold, write boilerplate and review. Design decisions, tuning and integration were ours." |
| Does it work in bad light? | "It degrades: the silhouette gets noisier first, gestures later. Calibration warns about low light, and there's a high-contrast mode. Front lighting fixes most of it." |
| Two players? | "Not yet. Pose tracks one person — the most prominent — and we coach others out of frame. Two-player split is the obvious next step." |
| What would you do with another week? | "Directional slashes, a duck obstacle, two-player, a proper mask model, and a shareable replay clip of your silhouette highlight." |
| Does it need the internet? | "No. Models, fonts, tracks are bundled. Only the optional YouTube helper needs it." |

## Scoring rubric self-assessment

Typical open-theme rubric; assess honestly at H12 and fix the weakest row first.

| Criterion | Weight (typ.) | Where we score | Weak spot to watch |
| --- | --- | --- | --- |
| Working demo | 30 % | Live play by a judge; offline boot | Lighting; a judge's dark hoodie |
| Technical difficulty | 25 % | Worker inference, DSP generator, plane-cut slicing, shader silhouette | Must be *shown*, not told: keep the debug overlay for one beat if asked |
| Creativity / originality | 20 % | Body-as-controller, silhouette, three destruction effects | Avoid "Beat Saber clone" framing; lead with the body |
| Visual / UX polish | 15 % | Bloom, drops, HUD, results animation | HUD readable from 2.5 m |
| Presentation | 10 % | Script, rehearsed drills | Overrunning; speaking over the hook |

## Acceptance

- The script has been rehearsed three times end-to-end with a timer; the last run is ≤ 3:10.
- Every failure drill has been triggered deliberately once and recovered.
- The pre-demo checklist is printed or on the phone and was completed before the slot.
- The fallback video exists in the three locations.
