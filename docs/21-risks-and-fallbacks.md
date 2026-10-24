# 21 — Risks & Fallbacks

Every risk below has a fallback decided **now**, an early signal that triggers it, and a deadline by which the decision is made. At the deadline the owner track either declares the risk closed or triggers the fallback and records it in `CHANGELOG.md` using the template at the end. No new fallback designs after kick-off; pick from the ladder.

Likelihood / impact: **H** high, **M** medium, **L** low. Deadlines are hackathon hours (H0 = kick-off 18:30 IST, [19](19-build-plan.md)).

## Risk register

| ID | Risk | L | I | Early signal | Pre-decided fallback | Track | Deadline |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R01 | Venue Wi-Fi slow or absent | H | H | `npm install` or model download crawls at kick-off | Everything bundled ([ADR-013](03-decisions.md#adr-013--everything-the-demo-needs-is-bundled-and-works-offline)): models, WASM, fonts, GLB, tracks in `app/public/`. Pre-download `node_modules` and models on every laptop **before** arriving. Network-off BOOT test is in the demo checklist. | G | H0 |
| R02 | Bad lighting / backlight at the demo table | H | H | Mask edge noisy; calibration tick 1 regresses; gesture confidence < 0.6 in debug overlay | Bring a lamp/ring light. `calib.coach.lowLight` warning (mask mean confidence in body box < 0.55 for 1 s). **High-contrast mode** flag (`?contrast=1`, key `H` in dev): mask threshold 0.5 → 0.65, edge gain ×1.5, silhouette fill brighter. Position the table away from windows. | T / R | H10 (flag built), demo day (lamp) |
| R03 | Demo laptop GPU too weak for 60 FPS | M | H | BOOT probe median frame time > 16.6 ms; p95 > 25 ms in play | Quality tiers ([ADR-014](03-decisions.md#adr-014--quality-tiers-chosen-at-boot-not-a-settings-menu), [16](16-performance-budget.md#quality-tiers)): `medium` halves particles and bloom resolution, `low` disables bloom and the skeleton. Key `T` cycles. Decide the demo laptop at H1 and profile only on it. | R | H10 |
| R04 | MediaPipe GPU delegate fails inside the worker | M | H | Worker throws on `createFromOptions` with `delegate: 'GPU'`, or inference > 60 ms | Ladder: (1) retry with `delegate: 'CPU'` at `INFER_W/H` 480×270 and `TRACK_TARGET_HZ` 20; (2) run inference on the main thread at 15 Hz with the render loop skipping the frame after each inference. Both paths behind `tracking/workerClient.ts` so the game sees the same `TrackingFrame`. | T | H2 |
| R05 | Segmentation mask quality poor (holes, flicker, blobby edges) | M | M | Silhouette looks like a blob on the demo laptop at H3 integration | Enable `ImageSegmenter` (selfie landscape model) behind `?seg=selfie` ([ADR-003](03-decisions.md#adr-003--mediapipe-tasks-vision-handlandmarker--poselandmarker-with-segmentation-masks)); accept +5–8 ms inference. Shader-side: temporal blend of two masks (0.7/0.3) and a 3×3 blur before threshold ([10](10-rendering-silhouette.md)). | T / R | H5 |
| R06 | Handedness labels flip (left/right swap) | H | M | Gesture indicators react to the wrong hand; blade colour swaps | Treat `handedness` as a hint: assign hands by **x-position continuity** (nearest to the previous frame's cursor), fall back to the label only when a hand is new. Both block types accept either hand, so a flip costs nothing in scoring. | T | H4 |
| R07 | Hand occlusion / edge-on hand / hand leaves frame mid-swing | H | M | Gesture drops to `none` during slashes; blade flickers | Hold the last confident gesture for `GESTURE_DROP_FRAMES`; extrapolate `pos` for `EXTRAPOLATE_MAX_MS`; blade uses hysteresis (`BLADE_ON_SPEED`/`BLADE_OFF_SPEED`). Calibration target frame keeps hands inside the sweet spot. | T | H5 |
| R08 | Two people in frame (judges leaning in, passers-by) | H | M | Pose jumps between bodies; silhouette doubles | `numPoses: 1` (most prominent); hands assigned to cursors by proximity to the pose wrists, others discarded. Coaching copy in `CALIBRATION` when the mask has two disjoint blobs > 15 % area each: "One player at a time." Stage rule: nobody behind the tape line. | T / G | H6 |
| R09 | Tracking latency too high (> 150 ms motion-to-photon) | M | H | Debug overlay latency estimate > 150 ms; players consistently judged Good/late | Cursor extrapolation (`EXTRAPOLATE_MAX_MS`); user `inputOffsetMs` (settings range ±150) set negative for the demo laptop; if still bad, widen `WINDOW_*_MS` by 25 % via a single multiplier constant. Request 30 fps camera, not 60; lower `INFER_W/H`. | T / G | H8 |
| R10 | Tempo estimation unreliable on test tracks | M | H | ≥ 2 of 5 test clips off by more than 3 BPM (or octave errors) at the H5 checkpoint | **Onset-only mode**: notes placed on strong onsets without grid snapping, density-capped; badge `select.tempoFallback` shown ([ADR-007](03-decisions.md#adr-007--own-dsp-beatmap-generator-spectral-flux--dp-beat-tracking-in-a-worker)). `[STRETCH]` Essentia.js `RhythmExtractor2013` behind a flag. Bundled demo maps are hand-verified regardless. | A | H5 |
| R11 | Generator too slow (> 4 s for 3 min) | M | M | Worker timing on the demo laptop > 4 s | Downsample to 11025 Hz for the flux stage; `HOP` 512 → 1024; skip `analysis.onsets` serialisation; cache hit path covers repeat demos. Progress bar hides anything ≤ 8 s. | A | H8 |
| R12 | Audio autoplay blocked / `AudioContext` suspended | H | L | Song progress advances with no sound | Resume the context on the first user gesture (Start click counts); `player.ts` checks `state === 'suspended'` before scheduling and shows a "click to enable sound" pill. Drill in [20](20-demo-and-judging.md#failure-drills). | A | H3 |
| R13 | `decodeAudioData` fails on an uploaded file (odd codec, DRM'd M4A, huge FLAC) | M | L | Promise rejects | Accepted list shown in the UI: MP3, WAV, OGG, M4A (AAC). Error copy `select.decodeError`. Pre-stage `demo-judge.mp3`. Reject files > 60 MB before decoding. | A | H6 |
| R14 | YouTube companion / `yt-dlp` broken (rate-limit, signature change, no network) | H | L | `/health` fails or resolve > 30 s | Optional path ([ADR-012](03-decisions.md#adr-012--youtube-via-a-local-companion-service-mp3-upload-is-the-primary-path)); UI disables the field with the offline copy. Never demo it unless tested in the last 30 min. `yt-dlp` auto-update at build time only. | A | H12 |
| R15 | Plane-cut slicer not working by H6 | M | M | Degenerate caps, missing triangles, NaNs in fixtures tests | **Pre-cut halves**: 4 pre-made half-pairs (horizontal, vertical, two diagonals) in `block_halves.glb`; choose the pair whose cut normal is nearest the swing direction, orient to the swing. Visibly still "sliced by my swing". | R | H6 |
| R16 | Blender MCP unavailable / Blender not installed on the asset machine | M | L | MCP connection fails at H1 | Procedural fallbacks in [18](18-blender-mcp-asset-pipeline.md): shards from a Voronoi-ish split of the cube in code (8 corner cells + 6 face cells), glyphs from `THREE.ShapeGeometry` of SVG paths, armour plates from bevelled boxes. | R | H4 |
| R17 | Bloom too expensive on the demo GPU | M | M | Post FX pass > 4 ms in the GPU timer | `BLOOM_RESOLUTION_SCALE` 0.5 → 0.35; drop mipmap levels 5 → 3; `low` tier disables bloom and uses additive sprites for glow. | R | H10 |
| R18 | Team member blocked, asleep or absent | H | M | A track has no commit for 60 min | Handoff rule: each track's owner posts a `wip:` commit and a 3-line status in the team chat before sleeping; any teammate may take over by reading the track's doc and the last `CHANGELOG.md` entry. Sleep in shifts of 90 min, never both T and G owners at once. | all | ongoing |
| R19 | Scope creep ("what if the blocks also…") | H | H | A feature not in [01 §What done looks like](01-vision.md#what-done-looks-like-definition-of-the-shipped-product) appears in a branch | Change control: a new idea needs one line added to the relevant doc under a `[POLISH]`/`[STRETCH]` tag **and** the lead's yes; nothing new after the **feature freeze at H12**. Kill list below. | lead | H12 |
| R20 | Demo-day failure (camera, audio, crash) | M | H | — | Drills and fallback video in [20](20-demo-and-judging.md#failure-drills); checklist 15 min before the slot. | G | demo day |
| R21 | Git conflicts between tracks | M | M | Merge conflicts in `constants.ts`, `store.ts`, `App.tsx` | Folder ownership per track ([19 §Tracks](19-build-plan.md#tracks-parallel-owners)); shared files (`constants.ts`, `events.ts`, `store.ts`) are edited only by appending and committed immediately; small commits, pull before each commit, rebase not merge for local work, never force-push. | all | ongoing |
| R22 | Browser update, permission reset or OS popup on the demo machine | M | M | Chrome relaunches; camera prompt returns | Disable auto-update for the event (`chrome://settings/help` → do not relaunch); grant camera permission for the origin and verify in site settings; Focus assist on; Windows Update paused for 7 days. Use the same origin (`localhost:4173`) in every rehearsal so the permission sticks. | G | H12 |
| R23 | Battery / power | L | H | Laptop unplugged, battery saver throttles the GPU | Mains at the table; "Best performance" power mode; a second charger in the bag. | G | demo day |
| R24 | Commit timestamps / time zone wrong on a laptop | L | L | `git log` shows UTC or a wrong clock | Set the system clock to IST with automatic sync at H0; `CHANGELOG.md` entries carry explicit `+05:30`. Never backdate. | all | H0 |
| R25 | Worker/`ImageBitmap` memory growth (leaked bitmaps) | M | M | Memory climbs in Task Manager; GC pauses | `bitmap.close()` after `detectForVideo`; two-slot buffer ring; keep-latest frame dropping. Check memory over a 3-minute run at H8. | T | H8 |
| R26 | Hit detection feels unfair (swings pass through blocks) | M | H | Testers report "I hit it" with no judgement | Blade segment sweep uses the full `history` segment between frames, not just the current point; `HAND_HIT_RADIUS` tested at 0.22 and 0.28; debug overlay draws hit volumes. Tune with three different people at H7. | G / T | H7 |

## Fallback ladders

Best → acceptable → minimum. The minimum is still demoable; below the minimum, cut the feature (kill list).

| Subsystem | Best | Acceptable | Minimum |
| --- | --- | --- | --- |
| Tracking runtime | Worker, GPU delegate, hands 640×360 + pose 320×180 at 30 Hz | Worker, CPU delegate, 480×270 at 20 Hz | Main thread at 15 Hz, render skips post-inference frame |
| Silhouette | Pose mask + temporal blend + edge glow driven by band energies + 2.5D skeleton | Pose mask + static edge glow, no skeleton | Pose landmarks only: glowing skeleton with soft capsule body, no mask |
| Gestures | Open / Fist / Point with hysteresis, all three block types | Open / Fist only; beam blocks replaced by slash blocks in the generator | Any hand contact counts; one block type |
| Beatmap generation | Onsets + tempo + DP beats + snapping + sections, < 4 s | Onset-only mode, density-capped, no sections | Bundled pre-generated maps only; upload disabled |
| Slash destruction | Real plane-cut along the swing plane | Pre-cut half pairs oriented to the swing | Cube scales down and fades with a flash |
| Smash destruction | Blender fractured GLB, 14 shards, ballistic | Procedural 14-cell split | Same as slash minimum with a magenta flash |
| Beam | Charge arc, laser line, poof with sparks | Charge arc, instant poof | Removed (see Gestures acceptable) |
| Obstacles | Walls with lean hysteresis + glitch on hit | Walls, lean without hysteresis, combo reset only | Removed |
| Post FX | Bloom + chromatic aberration + vignette, drop-driven | Bloom only at 0.35 scale | None; additive sprite glow |
| Camera kinetics | FOV punch + Perlin shake on kick/drop | Shake only | Static camera |
| Audio reactive | Band energies drive edge colour, grid, fog | Edge colour only | Static palette |
| Results | Stats + kinetic energy + 3D highlight turntable | Stats + kinetic energy + static highlight image | Stats only |
| Song input | Bundled + upload + YouTube | Bundled + upload | Bundled only |

## Kill list

Cut in this order. Each cut is a one-line `CHANGELOG.md` decision entry.

**If behind at H7 (core not feature-complete):**

1. YouTube companion (R14) — never on the critical path.
2. 2.5D skeleton.
3. Chromatic aberration + vignette.
4. Results highlight turntable (keep a static capture).
5. Beam blocks (generator emits slash instead) — keep fist/smash because shatter is the best visual.
6. Obstacles — only if lean detection is unstable; otherwise keep, they are the "full-body" proof.
7. Real plane-cut → pre-cut halves (R15).

**If behind at H10 (wow pass incomplete):**

1. Any remaining `[STRETCH]` item (duck, directional notes, mines, Essentia.js).
2. Combo milestone effects and HUD animations beyond the score tween.
3. Section events (`build` / `calm`); keep `kick` and `drop`.
4. Quality tier auto-probe → hard-code the tier for the demo laptop.
5. Difficulty Hard (ship Easy + Normal).

Never cut: silhouette, slash with blade, bundled track playback, scoring HUD, calibration, results stats, offline boot. These are the demo.

## Decision log template

Append to `CHANGELOG.md` the moment a fallback is triggered (same commit as the change):

```text
## 2026-10-11T02:40:00+05:30 — Fallback triggered: R15 pre-cut halves

- Risk: R15 — plane-cut slicer not stable by H6 (caps missing on near-axis cuts).
- Signal: 3 of 12 slicer unit fixtures produce degenerate caps; visible gaps in play.
- Decision: switch to pre-cut half pairs oriented to the swing (ladder: Acceptable).
- Changed: render/slicer.ts (disabled behind flag), render/blocks.ts, assets block_halves.glb.
- Validation: 40 slashes live, all show two halves falling; unit tests for orientation pass.
- Revisit: only if slicer fixtures all pass before H12 freeze; otherwise ship as is.
```

Fields are mandatory: Risk, Signal, Decision (with ladder rung), Changed, Validation, Revisit.

## Constants required

All constants referenced in this document are defined in the [02 constants table](02-architecture.md#constants).
