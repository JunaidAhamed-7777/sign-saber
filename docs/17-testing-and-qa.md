# 17 — Testing & QA

**Implementation checkpoint:** asserted core/game/audio/music/tracking suites now run. Replay/recording schema 1 additionally records `source` (`synthetic` or `consented-recording`), seed and explicit `inferenceMs`; relative capture/infer/arrival timing is retained and rebased. Recorder output excludes masks/device IDs and lower-limb values. Recording is explicit opt-in/consent and ends at the first duration/byte/frame cap, reporting actual duration/reason. No participant recording has been created in this implementation pass. Numeric browser audio and synthetic-image model probes are separate from live webcam/human evidence.


A webcam game needs three complementary layers: asserted unit tests for pure rules, deterministic replay for timing/collision regressions, and live manual trials with real people/cameras/lighting. [24 — Benchmark & Evidence Protocol](24-benchmark-and-evidence.md) owns performance targets, statistical definitions and evidence. **Current state: 250 asserted tests pass in the integrated worktree, with real numeric browser audio and dataset-level trial evidence. No completed human live-game acceptance is recorded.** A scaffold build is not evidence that these planned checks pass.

Commands (from `app/`): `npm run test` (vitest, unit), `npm run test:watch`, `npm run typecheck`, `npm run lint`. CI runs all three plus `npm run build` on every push.

Documentation validation runs from the repository root with `node scripts/check-docs.mjs`. During P0/P1, ensure CI records actual asserted test counts and fails when expected suites contain no tests. Introduce browser smoke coverage with the first playable path rather than waiting until the final presentation.

## 1. Unit tests (vitest)

Pure modules only; no DOM, no WebGL, no workers. Test files live in `app/tests/unit/` and mirror source names.

| Suite | Module | What is asserted |
| --- | --- | --- |
| `classifier.test.ts` | `gestures/classifier.ts` | On every recorded fixture frame labelled `open` / `fist` / `point` (§2), the classifier returns that label with `gestureConfidence ≥ 0.6` for ≥ 95 % of frames per label; `none` is returned for the `edgeOn` fixture ≥ 80 % of frames; hysteresis: a label flip for a single frame inside a stable run does not change the output (`GESTURE_CONFIRM_FRAMES`). |
| `cursor.test.ts` | `gestures/cursor.ts` | `mapToPlayPlane` corners: `(0,0) → (−PLAY_W/2, PLAY_CENTER_Y + PLAY_H/2)`, `(1,1) → (+PLAY_W/2, PLAY_CENTER_Y − PLAY_H/2)`; velocity from a synthetic linear motion equals the slope within 5 %; `bladeActive` turns on above `BLADE_ON_SPEED` and off below `BLADE_OFF_SPEED` only; `charge` reaches 1 exactly `BEAM_CHARGE_MS` after a stable `point`. |
| `oneEuro.test.ts` | `utils/oneEuro.ts` | Known fixed/irregular timestamp cases match the reference filter equations; constant input stays constant, step response converges, seeded stationary noise is attenuated and duplicate/non-finite times are handled explicitly. Measure jitter/lag versus cadence and speed before choosing thresholds; do not assert unverified mutually incompatible lag/smoothing promises. |
| `judge.test.ts` | `game/judge.ts` | Exact `WINDOW_*_MS * WINDOW_SCALE` boundaries and fractional values immediately outside each bucket; `inputOffsetMs` sign; no judgement outside eligibility. Within eligibility, [07](07-hit-detection-and-scoring.md)'s gesture/speed table distinguishes hit, badcut and no action; a resting or absent hand cannot cause an accidental badcut. Late arrivals, duplicate seq and two-hand arbitration each yield one terminal outcome. |
| `hit.test.ts` | `game/hit.ts` | Sphere–OBB: palm at block centre → contact; palm at `BLOCK_SIZE/2 + HAND_HIT_RADIUS + 0.01` → none; blade segment crossing a block corner → contact; swept segment (previous→current pos) catches a block passed between frames at 12 m/s. Cut plane normal equals `normalize(cross(vel, lane direction))` within 1°. |
| `score.test.ts` | `game/score.ts` | Multiplier boundaries from `MULTIPLIER_LADDER`; resets on miss/badcut/wall hit; accuracy is unmultiplied earned base points divided by possible base points, not `score/maxScore`. All-Perfect plus all-dodged is exactly 100%; a zero-opportunity session is handled explicitly; every note/wall has one terminal outcome. Verify [07](07-hit-detection-and-scoring.md)'s exact denominator and rank boundaries. |
| `kinetic.test.ts` | `game/kinetic.ts` | A synthetic swing with peak 8 m/s physical speed adds `0.5 · HAND_MASS_KG · 8²` J once (not per frame); stationary hand adds 0; kcal = J / 4184 / `METABOLIC_EFFICIENCY`. |
| `dsp.test.ts` | `beatmap/dsp/*` | The 10 tests in [08 §16](08-beatmap-generation.md#16-unit-tests-apptestsunitdsptestts-assigntestts). |
| `assign.test.ts` | `beatmap/assign.ts` | Density caps, gap rules, chord rule, hand alternation (no more than 3 consecutive notes on one side when gaps < 1200 ms), obstacle safety. |
| `validate.test.ts` | `beatmap/validate.ts` | At least one failure per [09 validation rule](09-beatmap-format.md#validation-rules-validatebeatmap), including malformed shapes, NaN/Infinity, invalid enums/IDs/hashes, transitive chords, density, wall margins and logical capacity. The synthetic example passes; rejected maps never reach PLAYING. |
| `slicer.test.ts` | `render/slicer.ts` (pure geometry part) | Two hundred seeded planes plus face/edge/vertex/tangent degeneracies: closed halves after tolerance-aware vertex welding, volume conserved within 1%, vertices on expected sides, planar caps and no NaNs. A missed/tangent cut returns the documented fallback. Shared edges use geometric position, not duplicated shading vertex indices. |
| `stateMachine.test.ts` | `core/stateMachine.ts` | Every transition in [04](04-state-machine.md) is legal; every other `(state, event)` pair throws `assertTransition`; `onEnter`/`onExit` hooks fire in order. |
| `spawner.test.ts` | `game/spawner.ts` | Notes become live at `t − approachMs` (beams at `t − BEAM_LEAD_MS`); position at `songTime = t` is exactly the target cell; `music:event`s fire once each. |
| `cache.test.ts` | `beatmap/cache.ts` | Versioned map and analysis keys, grouped eviction to `ANALYSIS_CACHE_MAX`, difficulty reuse, corrupted entries, denied storage and quota failure. Valid generation remains usable when persistence fails. |

Line coverage is a secondary development target (≥80% of implemented `game/`, `gestures/`, `beatmap/`, `core/`), not a substitute for assertions at boundaries. Add worker protocol tests for stale/duplicate results, cancellation task yielding, resource ownership and disposal. Check output at 30/60/120 Hz render scheduling and tracking gaps, with identical ordered judgements and scores. Accessibility and recovery flows require browser/manual coverage even when visual modules have little unit coverage.

## 2. Tracking fixtures

### Format

`app/tests/fixtures/tracking/<name>.fixture.json`:

```ts
interface TrackingFixture {
  version: 1;
  name: string;                // 'slash-right-fast', 'fist-punches', 'point-hold', 'edge-on', 'lean-left-right', 'wave'
  recordedAt: string;          // ISO date
  camera: { width: number; height: number; fps: number };
  timestampSource: 'capture' | 'callback-receipt';
  calibration?: BodyCalibration;
  labels?: { from: number; to: number; gesture: Gesture; hand: 'left' | 'right' }[];   // ground truth ranges by seq
  frames: {
    seq: number;
    tCapture: number;          // ms, relative to first frame
    tInferDone: number;        // same rebased timeline
    tArrival: number;          // same timeline; preserves measured queue/arrival age
    hands: { handedness: 'left' | 'right'; score: number; landmarks: number[] /* 63 */; worldLandmarks: number[] /* 63 */ }[];
    pose: { landmarks: number[] /* 132 */; worldLandmarks: number[] /* 99 */ } | null;
  }[];                         // no mask: fixtures stay < 2 MB for 20 s
}
```

Landmarks retain the exact coordinate conventions in [02](02-architecture.md): mirrored image-space landmarks and separately named model/world landmarks, not an extra blanket mirror applied at replay. Validate lengths, finite values, monotonic relative times and unique ascending `seq` before replay. Fixtures omit masks and cannot test segmentation. Their `tInferDone`, arrival delay and calibration times must be reconstructed from explicitly recorded relative timing data; zeroing those values would hide stale-input bugs. Record consent/licence and hash the fixture; do not commit names or camera footage by default.

### Dev-only recorder

Planned P0/P1 recorder: a **Record 20 s** control buffers bounded `TrackingFrame` data without masks and downloads a fixture. Add labels afterwards with explicit seq ranges and reviewer notes. Required before P2: `slash-right-fast`, `slash-left-slow`, `fist-punches`, `point-hold`, `edge-on`, `lean-left-right`, `wave`, `two-people`, `hands-leave-frame`. Include held-out people/lighting/hand sizes; otherwise a high classifier score may just memorise one recording. These fixtures do not exist yet.

### Replay mode

Planned `?replay=<name>`: a source adapter replaces camera/worker and rebases relative timestamps into a deterministic session timeline. Consume **all due input records in capture order**, not just the latest record at each render tick; score measured samples at their mapped capture times. Simulate arrival ages deliberately for stale-input tests rather than using JSON load time. Logic can be advanced offline independently of rAF; effects have their own fixed seed. Reset session/filter/gesture state before each run and do not loop a fixture into one continuous score session. The same map/fixture produces the same ordered outcomes at different render rates.

Show `REPLAY` visibly. `?speed=0.25` is inspection only and must scale the simulated song and input timelines together; slowing input alone changes timing. Mask/video and live capture/inference have separate evidence lanes in [24](24-benchmark-and-evidence.md#2-keep-three-evidence-lanes-separate).

### Synthetic performer

`performer/choreography.ts` plans a human-plausible upper-body performance for any `BeatmapV1`: one hand per stroke (columns 0–1 prefer the left hand), slash wind-up/strike/follow-through at a constant play-plane speed, fist draw-back/drive for smash, a steady point on the projected beam aim target timed so the charge completes at the note, and a torso lean through walls. Hands travel relaxed (classified `none`) and settle at the stroke start before the judgement window opens, so travel cannot register early contacts. Notes neither hand can reach in time are reported as `unplayable`, never hidden. `performer/synthesize.ts` converts each planned frame into mirrored pose and 21-point hand landmarks (anatomical open/fist/point/relaxed templates that the real classifier must accept).

`tests/performer.test.mjs` feeds these frames at 30 Hz through the real `InputPipeline` (filters, hand identity, classifier, calibration, body lean) and `GameSession` for bundled charts. On 2026-10-25 every planned note was hit, with no bad cuts on planned notes, no wall hits and at least 98% Perfect timing; Pamgaea Normal left 2 of 269 notes unplanned and Cipher Hard 56 of 405. This is **logic replay of synthetic landmarks**: it proves the choreography and the scoring path agree, and it exposed the One Euro lag fixed in [05](05-tracking-pipeline.md#31-one-euro-filter). It does not establish camera recognition, MediaPipe accuracy, latency or human comfort. The same plan drives the rendered performer for dataset-camera trials, which are a separate evidence lane.

## 3. Browser integration smoke test [CORE]

Run `node scripts/release-drill.mjs` from the repository root for the automated camera-free release subset. It clones the current committed SHA (excluding uncommitted work), installs with a task-specific npm cache, runs the application check and production build, then uses the existing loopback server and shared dependency-free [CDP helper](../scripts/cdp-client.mjs). Isolated headless Chrome blocks non-loopback destinations through a dead loopback proxy, a CDP Network origin allowlist on app page/worker targets and Fetch interception on pages. Chrome-internal UI targets are excluded. Native CDP mouse/key events select a local song, unlock audio, run the labelled synthetic performer to actual results with nonzero hits, retry into play, pause and return to Songs. The harness observes DOM results without modifying scoring or clocks.

The script records command timings/exit codes, tested SHA, Node/npm/OS/browser, observed requests, console/runtime errors, CSP violations, results and failures in dated JSON plus Markdown under `docs/evidence/`. `node --test scripts/release-drill.test.mjs` checks request classification, option validation, failure summaries, evidence retention and CDP message handling. `node --test scripts/release-drill.browser.test.mjs` verifies that a real dedicated worker resumes, loads the loopback fixture and has an explicitly labelled external probe blocked by CDP before network access. `node scripts/release-drill.mjs --inject-missing-asset` removes only the temporary build's catalog; it must write failure evidence and exit nonzero. Chrome must be installed (`BROWSER_BINARY` or `--browser <path>`). Installation needs network; the browser stage permits only the prepared loopback origin/local data. Camera paths are excluded because tracking models require separate network preparation with `npm run models`. A pass establishes this synthetic production journey only; it does not pass consented live calibration, recognition, audible synchronization, physical latency, human QA or the complete P5 venue drill.

The 2026-10-25 [passing summary](evidence/2026-10-25-release-drill.md) / [JSON](evidence/2026-10-25-release-drill.json) identifies `10bca5ef1aa1aada09c06b1ead5139f7f4bf11c6`, which normally integrates main `09671b7`. Its clean clone passed all 480 application assertions; the updated chart produced 84 Perfect hits, then retried and returned to Songs with zero console/CSP errors and 17 local requests. The [missing-asset failure summary](evidence/2026-10-25-release-drill-missing-asset.md) / [JSON](evidence/2026-10-25-release-drill-missing-asset.json) identifies the earlier `d14c980` candidate: deliberate catalog 404, failure evidence and exit 1. That candidate's 131-hit [passing summary](evidence/2026-10-25-release-drill-previous-f863b930ec53.md) / [JSON](evidence/2026-10-25-release-drill-previous-f863b930ec53.json) is preserved unchanged. Earlier failed attempts also remain alongside these reports; later source changes are outside the identified snapshots.

Add the smoke harness in P1 and extend it through P2: camera-free BOOT → SELECT placeholder/catalog → explicit setup with no song → confirmed camera calibration → song selection/audio enable → CALIBRATION → PLAYING → pause/resume → RESULTS → retry/quit. Use a labelled deterministic source or explicit harness setup, never two unrelated replay values at once. Assert menu activation requests, expected judgements/score and stopped audio after quit. Denied camera/missing models leave SELECT usable; corrupt-upload failures preserve a usable selection. Headless replay cannot prove real browser activation, GPU delegate, permission or webcam behavior; keep live checks separate. Add a browser-harness dependency only with a real documented command.

**Implemented dataset-camera smoke harness:** `node scripts/dataset-camera-trial.mjs` builds and serves the production app, launches isolated Chrome profiles and drives the real UI through the DevTools protocol (Node's global `WebSocket`; trusted mouse/key input; no new dependency): song → Enable sound → 80-second cut → camera setup → calibration → Start → count-in → play → manual pause/resume → Results → diagnostics export through Settings → Retry → pause → Songs → camera off → setup cancel, plus a setup-preview sweep with a hidden-tab interval. It runs the [dataset camera](05-tracking-pipeline.md#13-dataset-camera-trackingcamerasourcets-datasetcamerats-datasetcamerareelts) and a Chrome fake-webcam Y4M of the same photos. A read-only `__signSaberDiagnostics` snapshot (only with `?stats=1`) is used for waiting and assertions; actions use the visible controls. It cannot prove real webcam permission UX, optics, a person's motion or swings, and still photos produce misses rather than hits.

## 4. Manual QA checklist

Run with at least three first-time players, including different heights/reach where available. Record per-row pass/fail/blocked/not-applicable, actual date, SHA, device, player alias and evidence in the release report; summarise in `CHANGELOG.md`. Not-applicable needs an explicit scope/fallback decision. No unchecked row counts as a pass.

### BOOT

| # | Step | Pass criteria |
| --- | --- | --- |
| B1 | Open the app with camera permission unset | Shell/catalog loads to SELECT with the central illustrative person and **Set up camera**; no permission prompt or tracking-model prerequisite. Record shell-ready time separately from camera-setup time. |
| B2 | Invoke Set up camera, then deny permission | Useful SELECT setup guidance and Retry; placeholder and mouse/keyboard music browsing remain. Persistent denial explains site settings; no fabricated repeated permission prompt. |
| B3 | Disable external network, hard reload a prepared local build | All three song entries, credits, placeholder and menu work; locally prepared models can complete explicit setup. Initial downloads are a separate prerequisite. |
| B4 | Remove a tracking model in the QA copy, reload | SELECT still opens. Only explicit camera setup fails with a named missing-model/recovery message; no fake tracking success. |
| B5 | Open in a browser without WebGL2 (or `--disable-webgl`) | "Open in Chrome or Edge…" card, no exception in console |
| B6 | Check diagnostics | Actual tier/drawing-buffer dimensions, delegate and timestamp source shown; probe result is not confused with a live benchmark. |

### SELECT

| # | Step | Pass criteria |
| --- | --- | --- |
| S1 | Land on Song Select before camera setup | At least three distinct full starter songs and actual metadata/difficulty availability; central placeholder with **Set up camera**. Live figure appears only after matching calibration. Unknown BPM stays unknown. |
| S2 | Drop a supported MP3 | Honest stage progress, validated map and measured file-to-ready time per [24](24-benchmark-and-evidence.md); Start still checks camera/calibration/audio readiness. Upload never silently grants those prerequisites. |
| S3 | Drop the same MP3 again | Validated cache hit preserves identity/warnings; report actual retrieval time rather than calling it instantaneous. |
| S4 | Drop a 3-second clip / a silent WAV / a `.txt` renamed `.mp3` | "Track too short" / "No audio detected" / "Unsupported or corrupt audio file"; Start disabled; no console exception |
| S5 | Switch difficulty on an uploaded track | Note count changes in < 200 ms |
| S6 | Companion service not running | URL field disabled with offline copy within 1 s |
| S7 | Companion running [POLISH] | Paste URL → title shown → fetch → map generated; disconnect network mid-fetch → error copy, UI usable |
| S8 | Attempt Start without map, camera setup, matching calibration or usable audio | Guarded for every modality, with a persistent explanation and available setup/audio action. No gesture bypass. |
| S9 | Set up camera without selecting a song | Labelled live setup preview verifies identity/reach; success returns to live browse figure. Cancel/denial/reconfigure invalidates pending work and preserves music selection; no song audio is scheduled. |
| S10 | Select/preview/stop each starter song, then complete it | Mouse/key/hand use the same slug/actions. Hover/selection do not autoplay. All three full songs and maps work offline; actual credits match. One corrupt asset disables only its entry. |
| S11 | Open-palm movement → Point on controls in SELECT/setup/PAUSED/RESULTS | Pointer remains on last open anchor; one confirmed click per episode. Repeat held Point, hand swapping, stale input, target motion, state/layout changes and native takeover produce no duplicate/unintended action. |
| S12 | Hover without Point; fold fingers briefly between Open and Point | Hover never activates. Fresh ambiguous transition within the named grace may complete; timeout/lost evidence disarms. Browser-owned picker/permission/audio actions ask for real native input. |

### CALIBRATION

| # | Step | Pass criteria |
| --- | --- | --- |
| C1 | Stand 2 m away, arms down | Line 1 ticks after `CALIB_PRESENCE_MS` once both hands have been seen |
| C2 | Move so the torso/hands no longer fit the calibrated framing region | Useful step-back coaching; no claim of exact camera distance from a monocular estimate. |
| C3 | Move until body/hand size is below the valid calibration envelope | Useful step-closer coaching; Start remains blocked until reliable presence. |
| C4 | Wave one hand (3 reversals in 1.5 s) | Line 2 ticks; waving slowly (1 reversal/s) does not |
| C5 | Countdown, including a chart with an early first note | Confident-tempo digits align to the scheduled start; low-confidence audio uses a neutral countdown. Scheduled negative-time pre-roll renders the full note approach without accepting score until song start. Cancel/lost presence stops the scheduled source and invalidates that epoch. |
| C6 | Press Back | Returns to `SELECT`, no audio playing |
| C7 | Walk out of frame during countdown | Countdown aborts, line 1 un-ticks, no transition |
| C8 | A second person crosses the frame | Unmatched hands are rejected; ambiguity causes coaching/pause rather than assigning another person's hand to the player. `numHands: 2` alone cannot guarantee identity. Record any remaining limitation. |
| C9 | Retry from Results | Shortened calibration (presence + countdown only) |

Menu-controller unit/replay tests must cover the exact arm/confirmation/transition/cooldown boundaries in [25](25-menu-and-hand-navigation.md), both controlling hands, zero-area reach bounds, CSS/DPR/zoom conversion, geometry epochs and 30/60/120 Hz render schedules. Verify placeholder/setup-preview/live identities and the persistent Back/Cancel-only allowlist during countdown; the Start/Resume point must not click through.

### PLAYING

| # | Step | Pass criteria |
| --- | --- | --- |
| P1 | Slash a cyan block with an open hand, fast | Block splits along the swing plane, halves fall, judgement pop, SFX, score increments, combo +1 |
| P2 | Slash slowly (< `SLASH_MIN_SPEED`) | No hit; block passes → Miss, combo resets |
| P3 | Punch a magenta (Armored) block with a fist | Shatters into shards; score |
| P4 | Open-palm a magenta block | Bad Cut: deflect flash, combo reset, no score, block continues and despawns without a second judgement |
| P5 | Fist a cyan block | Bad Cut (same) |
| P6 | Point at a visible gold target, including precharging before its timing window | Charge follows `BEAM_CHARGE_MS`; a full charge waits while the target is too early, then fires only at an eligible captured sample. No early automatic whiff/refire cycle. Target powers down/poofs once; score bucket matches actual fire time. |
| P7 | Point at nothing | Ring fills but nothing fires; no score change |
| P8 | Stop pointing before full charge | No beam fires after confirmed release; charge decays to zero according to [06](06-gesture-recognition.md), accounting for input cadence/hysteresis rather than a fixed render-frame count. |
| P9 | Wall from the left | Lean right → "Dodged" +`SCORE_DODGE`; stay centred → glitch effect, combo reset, no points |
| P10 | Lean around on/off thresholds, with/without shoulder tilt | Matches `LEAN_ON`, `LEAN_OFF` and the documented tilt assist/hysteresis; a fresh small translation without sufficient tilt does not activate a dodge. |
| P11 | Controlled contacts at early/on-time/late eligible capture times | Buckets match `WINDOW_*_MS * WINDOW_SCALE`; late delivery gets only bounded input grace. `MISS_Z` is visual cleanup and never replaces the capture-time eligibility/deadline rules in [07](07-hit-detection-and-scoring.md). |
| P12 | Idle hands | Particles orbit palms; no blade |
| P13 | Fast open-hand swipe through empty space | Blade ribbon appears, length grows with speed, fades after `BLADE_OFF_SPEED` |
| P14 | Predeclared busy/drop section | Intentional audio-reactive spectacle, readable targets and delivery meeting [24](24-benchmark-and-evidence.md); `FLOOR_FPS` is sustained, not an individual-frame guarantee. |
| P15 | Silhouette | Edge colour visibly shifts with bass (magenta) vs treble (white/gold); no raw camera pixels anywhere |
| P16 | Backlit (stand in front of a bright window) | Silhouette may degrade but hands still track; game remains playable (document as known limitation if not) |
| P17 | Dim room (screen glow only) | Record actual rate/confidence. If reliability fails, coach or pause safely; do not treat physical presence as proof the model can track it. Publish the lighting limitation. |
| P18 | Hand leaves frame mid-swing | No exception or stale-input judgement; blade fades. Re-entry follows confidence/identity confirmation, resets motion history and cannot sweep across the gap. |
| P19 | Step fully out of frame for 2 s | Auto-pause ("step back into frame") after `TRACKING_LOST_PAUSE_MS`; audio stops |
| P20 | Hide the tab (Ctrl+Tab) 5 s, return | Paused; resume count 3-2-1; notes and audio still aligned (no drift) |
| P21 | Unplug the webcam mid-song | Paused with a camera error line; plugging back in (or Retry) resumes; no crash |
| P22 | Song end | `RESULTS` within `SONG_TAIL_MS` after the last audio; no note left on screen |
| P23 | HUD | Score/combo/multiplier/accuracy/progress update; gesture indicators reflect each hand's gesture within 100 ms |
| P24 | `Esc` | Pauses; Resume button works by mouse |

### PAUSED

| # | Step | Pass criteria |
| --- | --- | --- |
| Z1 | Auto-pause then step back in | Tracking-loss pause may start its guarded countdown after stable presence; manual/hidden/fatal pauses still require their explicit route in [04](04-state-machine.md). No phantom swipe from stale history; failed audio resume stays paused. |
| Z2 | Quit to Songs | `SELECT` with attract scene; no audio; starting a new song works |
| Z3 | Pause during a destruction animation | Fragments freeze; on resume they continue (closed-form motion) |

### RESULTS

| # | Step | Pass criteria |
| --- | --- | --- |
| R1 | Finish a song | Rank/score/accuracy/combo/judgements match terminal outcomes. Any motion-energy estimate is labelled approximate and is not presented as measured calories/health data. |
| R2 | Highlight | 3D silhouette/skeleton pose from the peak-combo moment turntables; a song with zero hits shows a neutral pose, not a blank |
| R3 | All-Perfect plus all-dodged on a valid short easy map | Accuracy exactly 100%, rank SS; verifies the base-points denominator independently of multipliers. |
| R4 | Retry | Back to shortened calibration; stats reset to 0 |
| R5 | Songs | `SELECT` |

### Accessibility, privacy and recovery

- Keyboard-only navigation reaches Start, Pause, Resume, Retry and Songs with visible focus; mouse controls remain available when gesture navigation fails.
- Reduced motion suppresses shake/dolly/aberration/turntable motion; intensity controls preserve note legibility and avoid rapid full-screen flashes. Check colour-independent glyphs and readable small-screen HUD.
- The app explains local camera processing before requesting access, never displays raw pixels by default, uploads no camera/audio content, and stops capture when explicitly disabled or the app is torn down.
- Test cache denial/quota failure, worker termination, WebGL context loss and output-device suspension; each leaves a useful error/retry/quit path. No invented success state is allowed.
- Retry ten times and change tracks/difficulty repeatedly; no previous-session score, source node, media track, bitmap or listener survives incorrectly.

## 5. Performance QA

Execute [24](24-benchmark-and-evidence.md)'s declared cold/warm/full-song/stress/soak/recovery runs and publish per-run raw evidence; [16](16-performance-budget.md) assigns subsystem budgets. Keep live and replay lanes separate. Run release timings without DevTools/video capture, then a separate trace for diagnosis. Verify forced-tier failure and visible adaptive downgrade independently. Until collected, every result remains **unmeasured**.

## 6. Release triage after scope lock

Fix **only**:

1. Crashes and unhandled exceptions on the demo path (bundled track → calibration → play → results).
2. Softlocks (any state the player cannot leave without reloading).
3. Wrong-score bugs (double judgement, score not matching judgements, combo not resetting).
4. Visual/accessibility issues on the [demo path](20-demo-and-judging.md), privacy/resource leaks and failures of the measured acceptance gates.

Put remaining issues in README's known limitations and the release report. P5 in [ROADMAP.md](../ROADMAP.md) is scope-locked: a timing/gesture change requires rerunning affected fixtures, live trials and benchmark gates. Actual event rules/timing are recorded only when organisers supply them.

## 7. Pre-submission checklist

- [ ] `npm run typecheck && npm run lint && npm run test && npm run build` pass on a clean clone (`git clone` to a temp folder, `npm ci`, `npm run models`).
- [ ] Three first-time-player trials and every applicable QA row are recorded with failures/limitations.
- [ ] [24](24-benchmark-and-evidence.md) evidence bundle and exact clean build SHA recorded; no replay figure is labelled live.
- [ ] Demo laptop uses the rehearsed browser build/origin (production preview normally `localhost:4173`), hardware acceleration on, notifications off, display sleep off, power plugged in and camera permission checked. Revalidate after updates; `?tier` is not forced for the adaptive release run.
- [ ] Offline boot verified on the demo laptop (B3).
- [ ] README run instructions executed verbatim by someone who did not write them.
- [ ] README Submission section identifies the tested release SHA; `AI_USAGE.md`/`CHANGELOG.md` current and actual organiser requirements checked.
- [ ] Labelled fallback gameplay recording from the tested build is available locally; its date/SHA/input lane are stated.

## Acceptance criteria for this document

- [ ] Every unit suite in §1 exists and passes in CI.
- [ ] All nine fixtures in §2 are recorded and committed; `?replay=slash-right-fast` reproduces the same score on the same bundled map across three runs.
- [ ] Manual QA tables have a recorded result for every row before submission.
