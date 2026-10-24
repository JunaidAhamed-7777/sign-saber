# 17 — Testing & QA

A webcam game cannot be fully tested without a human in front of a camera, so the strategy has three layers: **unit tests** for every pure function (fast, run in CI), **fixture replay** for deterministic end-to-end debugging of the input pipeline without a camera, and a **manual QA checklist** run against the acceptance list in [01 §What done looks like](01-vision.md#what-done-looks-like-definition-of-the-shipped-product) with real people and real lighting.

Commands (from `app/`): `npm run test` (vitest, unit), `npm run test:watch`, `npm run typecheck`, `npm run lint`. CI runs all three plus `npm run build` on every push.

## 1. Unit tests (vitest)

Pure modules only; no DOM, no WebGL, no workers. Test files live in `app/tests/unit/` and mirror source names.

| Suite | Module | What is asserted |
| --- | --- | --- |
| `classifier.test.ts` | `gestures/classifier.ts` | On every recorded fixture frame labelled `open` / `fist` / `point` (§2), the classifier returns that label with `gestureConfidence ≥ 0.6` for ≥ 95 % of frames per label; `none` is returned for the `edgeOn` fixture ≥ 80 % of frames; hysteresis: a label flip for a single frame inside a stable run does not change the output (`GESTURE_CONFIRM_FRAMES`). |
| `cursor.test.ts` | `gestures/cursor.ts` | `mapToPlayPlane` corners: `(0,0) → (−PLAY_W/2, PLAY_CENTER_Y + PLAY_H/2)`, `(1,1) → (+PLAY_W/2, PLAY_CENTER_Y − PLAY_H/2)`; velocity from a synthetic linear motion equals the slope within 5 %; `bladeActive` turns on above `BLADE_ON_SPEED` and off below `BLADE_OFF_SPEED` only; `charge` reaches 1 exactly `BEAM_CHARGE_MS` after a stable `point`. |
| `oneEuro.test.ts` | `utils/oneEuro.ts` | A step input settles within 10 % in < 150 ms at `ONE_EURO_MIN_CUTOFF`/`ONE_EURO_BETA`; white-noise input of σ = 0.01 is attenuated to σ ≤ 0.004 when stationary; a constant-velocity ramp has lag ≤ 1 frame at 5 m/s. |
| `judge.test.ts` | `game/judge.ts` | Timing errors −60/0/+60 → Perfect; ±61..120 → Great; ±121..200 → Good; ±201 → no contact possible; `inputOffsetMs` shifts the boundaries exactly; wrong gesture → `badcut` regardless of timing; `SLASH_MIN_SPEED`/`SMASH_MIN_SPEED` enforced. |
| `hit.test.ts` | `game/hit.ts` | Sphere–OBB: palm at block centre → contact; palm at `BLOCK_SIZE/2 + HAND_HIT_RADIUS + 0.01` → none; blade segment crossing a block corner → contact; swept segment (previous→current pos) catches a block passed between frames at 12 m/s. Cut plane normal equals `normalize(cross(vel, lane direction))` within 1°. |
| `score.test.ts` | `game/score.ts` | Multiplier ladder from `MULTIPLIER_LADDER` (combos 0, 4, 5, 14, 15, 29, 30); combo reset on miss/badcut/obstacle hit; `maxScore` = notes × `SCORE_PERFECT` × 8 + dodges × `SCORE_DODGE` × 8 (every obstacle assumed dodged at 8×)… verify the chosen formula matches `SessionStats.accuracy` so SS is reachable; rank thresholds from `RANK_THRESHOLDS`. |
| `kinetic.test.ts` | `game/kinetic.ts` | A synthetic swing with peak 8 m/s physical speed adds `0.5 · HAND_MASS_KG · 8²` J once (not per frame); stationary hand adds 0; kcal = J / 4184 / `METABOLIC_EFFICIENCY`. |
| `dsp.test.ts` | `beatmap/dsp/*` | The 10 tests in [08 §16](08-beatmap-generation.md#16-unit-tests-apptestsunitdsptestts-assigntestts). |
| `assign.test.ts` | `beatmap/assign.ts` | Density caps, gap rules, chord rule, hand alternation (no more than 3 consecutive notes on one side when gaps < 1200 ms), obstacle safety. |
| `validate.test.ts` | `beatmap/validate.ts` | One failing case per rule 1–10 in [09 §Validation](09-beatmap-format.md#validation-rules-validatebeatmap); the example map passes. |
| `slicer.test.ts` | `render/slicer.ts` (pure geometry part) | For 200 random planes through a unit cube: both halves are closed (each edge shared by exactly 2 triangles), `vol(A) + vol(B) = 1 ± 1 %`, all vertices of A satisfy `n·p − d ≤ 1e-6` and of B `≥ −1e-6`, cap polygon is planar; a plane missing the cube returns `null`. Volume via signed tetrahedra. |
| `stateMachine.test.ts` | `core/stateMachine.ts` | Every transition in [04](04-state-machine.md) is legal; every other `(state, event)` pair throws `assertTransition`; `onEnter`/`onExit` hooks fire in order. |
| `spawner.test.ts` | `game/spawner.ts` | Notes become live at `t − approachMs` (beams at `t − BEAM_LEAD_MS`); position at `songTime = t` is exactly the target cell; `music:event`s fire once each. |
| `cache.test.ts` | `beatmap/cache.ts` | With `fake-indexeddb`: key format, eviction to 30, difficulty switch hits the analysis cache. |

Coverage target: ≥ 80 % lines in `game/`, `gestures/`, `beatmap/`, `core/`. `render/` and `ui/` are not unit-tested except `slicer`.

## 2. Tracking fixtures

### Format

`app/tests/fixtures/tracking/<name>.fixture.json`:

```ts
interface TrackingFixture {
  version: 1;
  name: string;                // 'slash-right-fast', 'fist-punches', 'point-hold', 'edge-on', 'lean-left-right', 'wave'
  recordedAt: string;          // ISO date
  camera: { width: number; height: number; fps: number };
  calibration?: BodyCalibration;
  labels?: { from: number; to: number; gesture: Gesture; hand: 'left' | 'right' }[];   // ground truth ranges by seq
  frames: {
    seq: number;
    tCapture: number;          // ms, relative to first frame
    hands: { handedness: 'left' | 'right'; score: number; landmarks: number[] /* 63 */; worldLandmarks: number[] /* 63 */ }[];
    pose: { landmarks: number[] /* 132 */; worldLandmarks: number[] /* 99 */ } | null;
  }[];                         // no mask: fixtures stay < 2 MB for 20 s
}
```

Landmarks are stored in **mirrored image space** exactly as the worker posts them, so a fixture frame converts to a `TrackingFrame` with `mask: null` by wrapping arrays in `Float32Array`.

### Dev-only recorder

In development builds the debug overlay (`D`) has a **Record 20 s** button: it buffers the next 20 s of `TrackingFrame`s (minus masks), then downloads `<timestamp>.fixture.json`. Labels are added by hand afterwards (the overlay shows `seq` so ranges can be read off while reviewing). Required fixtures to record at H0.5 ([19](19-build-plan.md)): `slash-right-fast`, `slash-left-slow`, `fist-punches`, `point-hold`, `edge-on`, `lean-left-right`, `wave`, `two-people`, `hands-leave-frame`.

### Replay mode

`?replay=<name>` (dev builds only): `tracking/replaySource.ts` replaces the camera + worker with a timer that emits fixture frames at their recorded `tCapture` cadence, looping. Everything downstream (filters, classifier, cursors, game, renderer) runs unmodified. Combined with `?seed`-free determinism of the game, a replayed fixture + a bundled beatmap reproduces the same hits every time, which is how hit-detection and scoring bugs are debugged without standing up. `?replay=…&speed=0.25` slows playback for frame-by-frame inspection; the overlay shows the current `seq`.

## 3. Integration smoke test [STRETCH]

Playwright with `--use-fake-device-for-media-stream --use-file-for-fake-video-capture=tests/fixtures/video/attract.y4m`: boot → `SELECT` visible within 10 s; pick bundled track → `CALIBRATION`; with `?replay=wave` → reaches `PLAYING`; after 15 s score > 0 with `?replay=slash-right-fast`; `?autoend=1` → `RESULTS` renders. Only attempted if everything `[CORE]` is green by H10.

## 4. Manual QA checklist

Run twice before submission by two different players (one tall, one short if possible). Record results in `CHANGELOG.md` ("QA pass 1/2: X/Y passed, failures: …"). Every row is a MUST unless tagged.

### BOOT

| # | Step | Pass criteria |
| --- | --- | --- |
| B1 | Open `http://localhost:5173` in Chrome | Logo + progress bar within 1 s; progress reaches 100 % in < 8 s with cached models |
| B2 | Deny the camera prompt | Error card "Allow camera access…" with Retry; Retry re-prompts and succeeds |
| B3 | Disable network (airplane mode), hard reload | Boots fully (ADR-013) |
| B4 | Delete `public/models/*.task`, reload | Error card names `npm run models` |
| B5 | Open in a browser without WebGL2 (or `--disable-webgl`) | "Open in Chrome or Edge…" card, no exception in console |
| B6 | Check overlay (`D` or `?stats=1`) | Tier shown; probe median logged |

### SELECT

| # | Step | Pass criteria |
| --- | --- | --- |
| S1 | Land on Song Select | Attract scene shows the live silhouette moving with the player; ≥ 2 bundled tracks listed with BPM/duration |
| S2 | Drop an MP3 | Progress "Listening… N %" then BPM + note count; Start enabled; total < 4 s for a 3-minute track |
| S3 | Drop the same MP3 again | Instant (cache hit) |
| S4 | Drop a 3-second clip / a silent WAV / a `.txt` renamed `.mp3` | "Track too short" / "No audio detected" / "Unsupported or corrupt audio file"; Start disabled; no console exception |
| S5 | Switch difficulty on an uploaded track | Note count changes in < 200 ms |
| S6 | Companion service not running | URL field disabled with offline copy within 1 s |
| S7 | Companion running [POLISH] | Paste URL → title shown → fetch → map generated; disconnect network mid-fetch → error copy, UI usable |
| S8 | Press Start without a map | Not possible (button disabled) |

### CALIBRATION

| # | Step | Pass criteria |
| --- | --- | --- |
| C1 | Stand 2 m away, arms down | Line 1 ticks after `CALIB_PRESENCE_MS` once both hands have been seen |
| C2 | Step within 0.7 m | "Too close — step back" |
| C3 | Step 4 m away | "Too far — step closer" |
| C4 | Wave one hand (3 reversals in 1.5 s) | Line 2 ticks; waving slowly (1 reversal/s) does not |
| C5 | Countdown | 3 digits land on beats of the song (audible metronome tick); transitions to `PLAYING` and the first note arrives on time |
| C6 | Press Back | Returns to `SELECT`, no audio playing |
| C7 | Walk out of frame during countdown | Countdown aborts, line 1 un-ticks, no transition |
| C8 | Two people in frame | The closer/larger person is tracked; the other's hands do not create cursors (`numHands = 2` picks the two most confident; verify both cursors belong to one player — if not, log as known limitation) |
| C9 | Retry from Results | Shortened calibration (presence + countdown only) |

### PLAYING

| # | Step | Pass criteria |
| --- | --- | --- |
| P1 | Slash a cyan block with an open hand, fast | Block splits along the swing plane, halves fall, judgement pop, SFX, score increments, combo +1 |
| P2 | Slash slowly (< `SLASH_MIN_SPEED`) | No hit; block passes → Miss, combo resets |
| P3 | Punch a magenta (Armored) block with a fist | Shatters into shards; score |
| P4 | Open-palm a magenta block | Bad Cut: deflect flash, combo reset, no score, block continues and despawns without a second judgement |
| P5 | Fist a cyan block | Bad Cut (same) |
| P6 | Point at a gold target and hold 0.5 s | Charge ring fills in 500 ms; beam fires; target powers down + poof; score |
| P7 | Point at nothing | Ring fills but nothing fires; no score change |
| P8 | Stop pointing at 0.3 s | Charge resets to 0 within 2 frames |
| P9 | Wall from the left | Lean right → "Dodged" +`SCORE_DODGE`; stay centred → glitch effect, combo reset, no points |
| P10 | Lean slightly (< `LEAN_ON`) | Not counted as a dodge; HUD lean indicator stays centred |
| P11 | Timing: hit a block as early as visible vs exactly at the plane vs late | Early → Good/Great, on plane → Perfect, late → Great/Good; nothing judged after `MISS_Z` |
| P12 | Idle hands | Particles orbit palms; no blade |
| P13 | Fast open-hand swipe through empty space | Blade ribbon appears, length grows with speed, fades after `BLADE_OFF_SPEED` |
| P14 | Drop section of `edm-128` | FOV punch + shake + colour shift; grid pulses; no frame drop below `FLOOR_FPS` |
| P15 | Silhouette | Edge colour visibly shifts with bass (magenta) vs treble (white/gold); no raw camera pixels anywhere |
| P16 | Backlit (stand in front of a bright window) | Silhouette may degrade but hands still track; game remains playable (document as known limitation if not) |
| P17 | Dim room (lights off, screen glow only) | Tracking ≥ 15 Hz; auto-pause does not trigger while the player is present |
| P18 | Hand leaves frame mid-swing | No exception; cursor `present = false`; blade disappears; re-entry resumes within 2 frames |
| P19 | Step fully out of frame for 2 s | Auto-pause ("step back into frame") after `TRACKING_LOST_PAUSE_MS`; audio stops |
| P20 | Hide the tab (Ctrl+Tab) 5 s, return | Paused; resume count 3-2-1; notes and audio still aligned (no drift) |
| P21 | Unplug the webcam mid-song | Paused with a camera error line; plugging back in (or Retry) resumes; no crash |
| P22 | Song end | `RESULTS` within `SONG_TAIL_MS` after the last audio; no note left on screen |
| P23 | HUD | Score/combo/multiplier/accuracy/progress update; gesture indicators reflect each hand's gesture within 100 ms |
| P24 | `Esc` | Pauses; Resume button works by mouse |

### PAUSED

| # | Step | Pass criteria |
| --- | --- | --- |
| Z1 | Auto-pause then step back in | Resume countdown starts only after 500 ms of stable presence; song resumes exactly where it stopped |
| Z2 | Quit to Songs | `SELECT` with attract scene; no audio; starting a new song works |
| Z3 | Pause during a destruction animation | Fragments freeze; on resume they continue (closed-form motion) |

### RESULTS

| # | Step | Pass criteria |
| --- | --- | --- |
| R1 | Finish a song | Rank, score, accuracy %, max combo, judgement bars, kJ + kcal all shown; numbers equal the HUD's final values |
| R2 | Highlight | 3D silhouette/skeleton pose from the peak-combo moment turntables; a song with zero hits shows a neutral pose, not a blank |
| R3 | Full-combo all-Perfect on `easy` with a short test map | Accuracy 100 %, rank SS (sanity of `maxScore`) |
| R4 | Retry | Back to shortened calibration; stats reset to 0 |
| R5 | Songs | `SELECT` |

## 5. Performance QA

Follow [16 §Acceptance criteria](16-performance-budget.md#acceptance-criteria-measured-on-the-demo-laptop-1080p-quality-tier-as-auto-selected) on the demo laptop: run each bundled track once with the overlay visible, note avg FPS, 1 % low, `ss:frame` p95, max draw calls, tracking Hz, and the tier in `CHANGELOG.md`. Then force `?tier=high` and confirm the runtime downgrade behaves as specified if the machine cannot hold it. Run the Chrome tracing checklist once.

## 6. Bug triage rule for the final 3 hours (after H12 feature freeze)

Fix **only**:

1. Crashes and unhandled exceptions on the demo path (bundled track → calibration → play → results).
2. Softlocks (any state the player cannot leave without reloading).
3. Wrong-score bugs (double judgement, score not matching judgements, combo not resetting).
4. Visual bugs visible during the demo script ([20](20-demo-and-judging.md)): missing destruction effect, silhouette not rendering, HUD text wrong.

Everything else goes into `README.md` → Known limitations and `SUBMISSION.md`. No tuning of thresholds after H13 unless a triage-1–4 bug requires it.

## 7. Pre-submission checklist

- [ ] `npm run typecheck && npm run lint && npm run test && npm run build` pass on a clean clone (`git clone` to a temp folder, `npm ci`, `npm run models`).
- [ ] Manual QA passes 1 and 2 recorded in `CHANGELOG.md` with failures listed as known limitations.
- [ ] Performance QA numbers recorded.
- [ ] Demo laptop: Chrome updated, hardware acceleration on, notifications off, display sleep off, power plugged in, camera permission already granted for `localhost:5173`, `?tier` not forced.
- [ ] Offline boot verified on the demo laptop (B3).
- [ ] README run instructions executed verbatim by someone who did not write them.
- [ ] `SUBMISSION.md` complete with final commit SHA; `AI_USAGE.md` and `CHANGELOG.md` current.
- [ ] Fallback gameplay video (recorded at H10) copied to the laptop desktop.

## Acceptance criteria for this document

- [ ] Every unit suite in §1 exists and passes in CI.
- [ ] All nine fixtures in §2 are recorded and committed; `?replay=slash-right-fast` reproduces the same score on the same bundled map across three runs.
- [ ] Manual QA tables have a recorded result for every row before submission.
