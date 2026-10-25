# 06 — Gesture Recognition

Scope: turning a filtered `HandRaw` into a `HandCursor` ([02 §Contracts](02-architecture.md#input-pipeline--game-handcursor-bodystate)): the Open / Fist / Point classifier, its hysteresis, play-plane position and velocity, the blade state, the beam charge and `pointDir`. Hit testing that consumes the cursor is in [07](07-hit-detection-and-scoring.md). This is a rule-based classifier by decision ([ADR-005](03-decisions.md#adr-005--geometric-gesture-classifier-on-landmarks-with-hysteresis)): deterministic, testable from fixtures, tunable live.

**Current contact behavior — 2026-10-25:** slash and smash blocks accept any present moving hand at `speed ≥ CONTACT_MIN_SPEED` (0.3 play-plane m/s), including classified `none`. They no longer require Open/Fist or produce a wrong-shape Bad Cut. Their square contact footprint and palm radius both use `HIT_ZONE_SCALE = 2.5`; timing windows and capture-time guards remain separate. The classifier still supplies gesture feedback, the open-hand blade extension, deliberate Open → Point menu actions and confident Point beam charging. These are implemented rules with synthetic assertions; they do not establish live recognition accuracy or comfortable human reach.

## 1. Landmark indices

MediaPipe 21-point hand model (same order in `landmarks` and `worldLandmarks`, stride 3):

| Index | Name | Index | Name | Index | Name |
| --- | --- | --- | --- | --- | --- |
| 0 | WRIST | 7 | INDEX_DIP | 14 | RING_PIP |
| 1 | THUMB_CMC | 8 | INDEX_TIP | 15 | RING_DIP |
| 2 | THUMB_MCP | 9 | MIDDLE_MCP | 16 | RING_TIP |
| 3 | THUMB_IP | 10 | MIDDLE_PIP | 17 | PINKY_MCP |
| 4 | THUMB_TIP | 11 | MIDDLE_DIP | 18 | PINKY_PIP |
| 5 | INDEX_MCP | 12 | MIDDLE_TIP | 19 | PINKY_DIP |
| 6 | INDEX_PIP | 13 | RING_MCP | 20 | PINKY_TIP |

The four fingers used for classification are `[INDEX, MIDDLE, RING, PINKY]` with `(MCP, PIP, DIP, TIP)` = `(5,6,7,8)`, `(9,10,11,12)`, `(13,14,15,16)`, `(17,18,19,20)`.

`gestures/classifier.ts` MUST export these as a `const enum LM` so the rest of the code never uses bare numbers.

## 2. Features

All features are computed from one `HandRaw` (already mirrored and One Euro-filtered for `landmarks`; `worldLandmarks` raw).

### 2.1 Palm size (2D, image space)

```
palmSize = hypot(u′₉ − u′₀, (v₉ − v₀) · 9/16)      // wrist → middle MCP, isotropic in width units
```

Every 2D distance below is divided by `palmSize` so the rules are independent of how far the player stands. If `palmSize < GESTURE_PALM_SIZE_MIN` (hand tiny / far away) the classifier returns `'none'` with confidence 0.

### 2.2 Finger extension angle (3D, world space)

For finger `f` with joints `(mcp, pip, tip)` in `worldLandmarks` (metres, hand-centred, scale-consistent):

```
a = P(mcp) − P(pip);  b = P(tip) − P(pip)
pipAngle_f = degrees(acos(clamp(dot(a, b) / (|a|·|b|), −1, 1)))     // 180° = straight finger
```

Using the 3D world landmarks supplies evidence when perspective shortens a finger. It does not guarantee camera-facing classification: the reach and visibility checks below can still be ambiguous under foreshortening. Such input must decay to `none` rather than charge an unobserved point indefinitely.

### 2.3 Tip reach (2D, image space)

```
reach_f = dist2D(TIP_f, WRIST) / palmSize            // ≈ 1.6–2.1 extended, ≈ 0.7–1.1 curled
pipReach_f = dist2D(PIP_f, WRIST) / palmSize
tipBeyondPip_f = reach_f > pipReach_f + GESTURE_TIP_REACH_MARGIN
```

### 2.4 Per-finger state

```
extended_f = pipAngle_f ≥ FINGER_EXT_ANGLE_DEG  &&  tipBeyondPip_f
curled_f   = pipAngle_f ≤ FINGER_CURL_ANGLE_DEG  ||  reach_f < GESTURE_CURL_REACH_MAX
// otherwise the finger is 'ambiguous'
```

### 2.5 Thumb

The thumb is deliberately weak evidence (it is the least reliably tracked and people hold it inconsistently):

```
thumbOut = dist2D(THUMB_TIP, PINKY_MCP) / palmSize > GESTURE_THUMB_OUT_MIN     // thumb away from the palm
thumbIn  = dist2D(THUMB_TIP, INDEX_MCP) / palmSize < GESTURE_THUMB_IN_INDEX_MAX || dist2D(THUMB_TIP, MIDDLE_PIP) / palmSize < GESTURE_THUMB_IN_MIDDLE_MAX
```

### 2.6 Edge-on detection

When the palm faces sideways, PIP angles and reaches are unreliable. Define the apparent palm width:

```
palmWidth = dist2D(INDEX_MCP, PINKY_MCP) / palmSize          // ≈ 0.8–1.1 facing camera, < 0.35 edge-on
edgeOn = palmWidth < GESTURE_EDGE_ON_WIDTH
```

When `edgeOn`, the classifier returns the previous stable gesture with low confidence for display continuity. That low-confidence evidence still increments the ambiguity counter in §4; it cannot preserve confident Point/menu evidence forever or advance beam charge. A present measured hand can still contact slash/smash blocks under the shape-independent rule above.

## 3. Rules

Let `E = count(extended_f)`, `C = count(curled_f)` over the four fingers.

| Gesture | Rule | Confidence |
| --- | --- | --- |
| `open` | `E === 4`, or (`E === 3` and the fourth is ambiguous and `thumbOut`) | `min over f of (pipAngle_f − FINGER_CURL_ANGLE_DEG) / (FINGER_EXT_ANGLE_DEG − FINGER_CURL_ANGLE_DEG)` clamped 0..1 (how far the *least* extended finger is from curl) |
| `fist` | `C === 4`, or (`C === 3` and the fourth is ambiguous and `thumbIn`) | `1 − max over f of (reach_f − GESTURE_CURL_MARGIN_ORIGIN) / GESTURE_CURL_MARGIN_SPAN` clamped 0..1 (how tucked the *most* open finger is) |
| `point` | `extended_INDEX` and `curled_MIDDLE && curled_RING && curled_PINKY` (thumb ignored); also accepted: index extended, middle *ambiguous*, ring and pinky curled, if `pipAngle_INDEX − pipAngle_MIDDLE ≥ GESTURE_POINT_RELAX_DEG` | `min(ext margin of index, min curl margin of the three others)` |
| `none` | none of the above | `0` |

Rule precedence when more than one matches (possible only through the "3 + ambiguous" relaxations): `point` > `fist` > `open`. Pointing is rarest and most deliberate; false positives on `point` are costly (a 500 ms charge) so its rule has no relaxation on the index finger itself.

### 3.1 `classify` pseudocode

```ts
// Allocate `out` and the four-finger scratch record once per hand at initialization.
// Feature equations and precedence are defined above; this is the hot-path API.
export function classify(
  hand: HandRaw,
  prev: Gesture,
  out: GestureResult,
  scratch: ClassifierScratch,
): void;
```

`GestureResult` contains `gesture`, `confidence` and `ambiguous`; `ClassifierScratch` owns fixed arrays for the four fingers' angles, reaches and flags. Fill them with indexed loops, accumulate `E/C` and minimum margins in scalar variables, then write the first matching rule to `out`. Validate finite coordinates and nonzero vector lengths before dividing; a degenerate/invalid hand writes `none`, confidence 0. Do not use per-sample `map`, `filter`, spread, temporary vectors or returned object literals in the production classifier. Tests can use a convenience allocating wrapper outside the hot path.

## 4. Hysteresis (`gestures/cursor.ts`)

Per hand: `stable: Gesture`, `candidate: Gesture`, `candidateFrames: number`, `ambiguousFrames: number`, `stableSince: number`.

1. `classify(hand, stable, result, scratch)`; use the reused `result` as `r` below.
2. If `r.gesture === 'none'`, input is edge-on/ambiguous, or confidence is below `GESTURE_CONFIDENCE_MIN`: clear `candidateFrames`, increment `ambiguousFrames`; after `GESTURE_DROP_FRAMES`, set `stable = 'none'` and update `stableSince`. Low-confidence output equal to `stable` still takes this branch.
3. Else if `r.gesture === stable`: clear both counters and the pending candidate.
4. Else (a different confident gesture): clear `ambiguousFrames`; increment `candidateFrames` only for the same consecutive candidate, otherwise replace it and start at 1. At `GESTURE_CONFIRM_FRAMES`, commit `stable`, update `stableSince`, and reset counters. An intervening ambiguous frame breaks the candidate run.
5. On hand loss (`present` false for `HAND_RESET_FRAMES` samples): `stable = 'none'`, counters reset.

Output: `HandCursor.gesture = stable`, `gestureConfidence = r.confidence` (of the current frame, informational), `gestureHeldMs = tCapture − stableSince`.

Fast-path exception: switching **into** `'open'` from `'none'` is allowed after 1 frame when `confidence ≥ GESTURE_FAST_OPEN_CONFIDENCE`. This keeps open-hand feedback and the optional blade extension responsive during a swing. Palm contact does not wait for Open classification. Leaving `'open'` still requires the full confirm count so a blurred fast hand does not drop the blade.

## 5. Position, velocity, `pointDir`

### 5.1 Play-plane position

`pos` = palm centre, defined as the mean of `WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP` (filtered image space) mapped with `mapToPlayPlane(u′, v)` from [02 §Image → play plane](02-architecture.md#image--play-plane). `tip` = `INDEX_TIP` mapped the same way.

### 5.2 Velocity

Keep a ring of the last `VEL_WINDOW_FRAMES + 1` `(pos, tCapture)` samples. Velocity is a central difference across the window:

```
vel = (pos[n] − pos[n − VEL_WINDOW_FRAMES]) / (t[n] − t[n − VEL_WINDOW_FRAMES])     // m/s on the play plane
speed = |vel|
```

With fewer samples (hand just appeared) use whatever span exists; with one sample `vel = 0`. Because positions were One Euro-filtered, no additional smoothing is applied to `vel`; the window averages the remaining jitter. Velocity is in play-plane metres per second. `CONTACT_MIN_SPEED` controls slash/smash eligibility, while `BLADE_*_SPEED` controls the open-hand blade extension. The retained `SLASH_MIN_SPEED` / `SMASH_MIN_SPEED` constants do not gate current block scoring. `SWING_MIN_SPEED` and `TORSO_SWING_MIN_SPEED` are physical-proxy speeds for the separate motion estimate ([07](07-hit-detection-and-scoring.md)). Reject nonpositive sample `dt`; reset the window across loss, pause or an over-age gap rather than calculating an enormous reacquisition velocity.

### 5.3 Extrapolation

Extrapolation is **render-only**. Derive a display position from the immutable latest measured sample: `displayPos = measuredPos + measuredVel · min(now − tCapture, EXTRAPOLATE_MAX_MS) / 1000`. Do the same for the displayed fingertip, then hold at the cap. Never integrate repeatedly into `HandCursor.pos`, append predicted history, advance gesture hold/charge, detect a hit or estimate energy from predicted samples. This makes scoring independent of render cadence and prevents a frozen camera from continuing to hit notes.

### 5.4 `pointDir`

```
pointDir = normalize(mapToPlayPlane(INDEX_TIP) − mapToPlayPlane(INDEX_MCP)).xy
```

Used for the HUD charge indicator and cosmetic beam direction. Current beam resolution auto-targets a spawned unresolved beam note; neither `pointDir` nor fingertip aim gates the shot ([07 §Beam resolution](07-hit-detection-and-scoring.md#8-beam-resolution)). When the finger points at the camera the 2D vector is short and noisy; if its pre-normalised length is below `POINT_DIR_MIN_M`, keep the previous valid `pointDir`. With no previous direction, use a stable display default and treat classification confidence independently.

### 5.5 History

`history` is a preallocated ring containing the last `TRAIL_HISTORY` measured positions (logically newest last). Write into existing entries; do not `shift`, clone vectors or append predicted samples. When the hand is absent, or the session pauses/resets, clear the logical length so the trail does not bridge an unobserved gap.

## 6. Blade state (`gestures/blade.ts`)

```
if (!bladeActive && gesture === 'open' && speed ≥ BLADE_ON_SPEED)  bladeActive = true
if ( bladeActive && (gesture !== 'open' || speed ≤ BLADE_OFF_SPEED)) bladeActive = false
bladeLength = bladeActive
  ? lerp(BLADE_LEN_MIN, BLADE_LEN_MAX, clamp01((speed − BLADE_ON_SPEED) / (BLADE_FULL_SPEED − BLADE_ON_SPEED)))
  : 0
```

The renderer smooths `bladeLength` visually ([12](12-rendering-hands-trails.md)); the game uses the raw value for the optional swept segment. A gesture change to `'fist'` or `'point'` retracts the blade immediately. This does not disable the palm sweep: slash and smash notes still accept a moving hand of any classified shape, subject to the contact/timing rules in [07](07-hit-detection-and-scoring.md#5-moving-hand-requirement-and-retained-bad-cut-contract).

## 7. Beam charge

```
// Update once per NEW accepted tracking sample; dt is capture-time delta in ms.
if (gesture === 'point' && confident) charge = min(1, charge + dt / BEAM_CHARGE_MS)
else                                 charge = max(0, charge − BEAM_CHARGE_DECAY · dt / BEAM_CHARGE_MS)
```

- `charge` reaching 1 means **ready**. With a spawned unresolved beam target, a confident Point fires at the earliest target automatically; it does not require fingertip aim. With no target, full charge waits. After an actual fire, the owning cursor resets charge, while the session enforces `BEAM_REFIRE_LOCK_MS` and a new `BEAM_CHARGE_MS` recharge interval; renderer/UI subscribers never modify charge. See [07 §Beam resolution](07-hit-detection-and-scoring.md#8-beam-resolution).
- The configured decay permits a short ambiguous sample without an instant reset. Hand loss, pause, stale input or identity reassignment resets charge and velocity immediately; missing samples do not accrue charging time.
- The HUD shows `charge` as a ring around the hand indicator; the renderer draws the charging beam from `tip` ([12](12-rendering-hands-trails.md)).

## 8. Debug and tuning workflow

- The debug overlay (dev only) prints per hand: `E/C`, each `pipAngle` and `reach`, `palmWidth`, raw and stable gesture, confidence, `speed`, `bladeLength`, `charge`.
- `FINGER_EXT_ANGLE_DEG`, `FINGER_CURL_ANGLE_DEG`, `BLADE_ON_SPEED`, `BLADE_OFF_SPEED` are exposed on a dev-only `window.__tune` object (hot-editable in the console) with a "copy as constants" button so the agreed values go back into `core/constants.ts` in one paste. No tuning value lives anywhere else.
- Tuning session protocol (P2/P4 in [the roadmap](../ROADMAP.md)): at least three consenting people × three gestures × near/mid/far distance × palm-facing/45°. Separate tuning fixtures from held-out evaluation fixtures, report per-gesture precision/recall and transition latency, and keep failures in the corpus. Record any failing case before changing thresholds; rerun all held-out cases after a change.

## Menu input is a separate consumer [CORE]

The same Open/Point evidence also drives [25 — Menu & Hand Navigation](25-menu-and-hand-navigation.md). A filtered mirrored-image palm centroid moves the menu pointer; an armed transition into pointing activates its target once. This consumer works before body/play-plane calibration and uses its own named confidence/timing guards. It does not reuse `HandCursor.tip`, `pointDir`, blade history or beam charge as UI coordinates/click state.

Route input by state/surface: menu commands are enabled only on the allowed app-owned controls; PLAYING disables the menu driver, accepts moving-hand contact for slash/smash and retains confident Point charging for beams. Reset menu latches and gameplay charge/sweep history across that boundary so pointing at Start cannot become an opening beam shot. A held Point never repeats menu clicks. The short Open → ambiguous → Point shape transition may retain the armed candidate within `MENU_TRANSITION_GRACE_MS`, but never activates until fresh confident Point confirmation passes. Tracking loss or prolonged ambiguity disarms it.

Share classifier output and stable hand identity instead of running a second incompatible classifier in React. Camera setup can provide a labelled live preview and menu input before committing `BodyCalibration`; an illustrative placeholder never supplies hands or gesture evidence. [14](14-ui-ux.md#input-handling) defines equivalent mouse/keyboard controls and native-browser exceptions.

## 9. Classifier verification

Current synthetic assertions live in [gestures.test.ts](../app/tests/gestures.test.ts); shape-independent block eligibility is asserted separately in [judge.test.ts](../app/tests/unit/judge.test.ts). The recorded `HandRaw` fixture matrix below remains a verification target, not a claim that `tests/fixtures/hands/*.json` or a completed human evaluation exists. Its proposed format is `{ label, frames: HandRaw[] }`.

| Test | Expectation |
| --- | --- |
| `open_static_*.json` | ≥ 95 % of frames classify `open` with confidence ≥ 0.5 |
| `fist_static_*.json` | ≥ 95 % `fist` |
| `point_up / point_side.json` | ≥ 90 % `point`; report camera-facing/foreshortened cases separately and coach a clearer pose if they fail |
| `slash_sequence.json` | hysteresis: stable gesture becomes `open` within 2 frames of the hand opening and never flickers to `none` during the 12 fast frames |
| `edge_on_flip.json` | short edge-on interval preserves display continuity; sustained ambiguity reaches `none` after the documented drop count and does not charge |
| `charge_hold.json` (0.6 s point) | `charge` reaches 1 near `BEAM_CHARGE_MS` within one input sample; holds full without a target; releasing follows the sample-time decay formula |
| precharged target | A hand charged before target appearance fires once at the earliest spawned unresolved beam target; aim is not required, and a consumed target cannot fire twice |
| synthetic velocity (positions on a straight line at 6 m/s) | `speed` within 5 % of 6; blade turns on; length matches the formula |
| far hand (`palmSize` 0.01) | `none`, confidence 0, no throw |

## 10. Acceptance criteria

- [ ] All three gestures are recognised within 100 ms of being formed, at 1.5–2.5 m from a 720p webcam, in room light, for three different people.
- [ ] A full-speed open-hand slash does not lose the `open` gesture mid-swing (verified on the debug overlay: no `none` frames during a swing).
- [ ] Pointing with the index clearly visible charges reliably. Camera-aligned, occluded and edge-on poses either pass held-out fixtures or show helpful coaching; the docs/demo do not promise unsupported viewpoints.
- [ ] Relaxed hand (half-open) classifies `none`, not `open` or `fist`; the player must deliberately open or close.
- [ ] Crossing hands in front of the body does not swap gesture state between hands (identity tracking from [05 §3.2](05-tracking-pipeline.md#32-hand-identity)).
- [ ] All unit tests in §9 pass; the classifier is a pure function with no `three` or DOM imports.
- [ ] Shape-independent slash/smash contact remains available when a present hand classifies as `none`; classifier uncertainty still cannot charge a beam or confirm a menu action.

## Constants required

All executable thresholds belong in `core/constants.ts` and the [02 constants registry](02-architecture.md#constants), including classifier-only tuning values. Values shown in the feature equations are initial defaults, not permission to inline magic numbers. P0 exports the registry; subsequent tuning updates the registry, fixtures and implementation together. `BEAM_CHARGE_DECAY`, `GESTURE_*` feature thresholds and the direction floor are listed there.
