# 06 — Gesture Recognition

Scope: turning a filtered `HandRaw` into a `HandCursor` ([02 §Contracts](02-architecture.md#input-pipeline--game-handcursor-bodystate)): the Open / Fist / Point classifier, its hysteresis, play-plane position and velocity, the blade state, the beam charge and `pointDir`. Hit testing that consumes the cursor is in [07](07-hit-detection-and-scoring.md). This is a rule-based classifier by decision ([ADR-005](03-decisions.md#adr-005--geometric-gesture-classifier-on-landmarks-with-hysteresis)): deterministic, testable from fixtures, tunable live.

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

Every 2D distance below is divided by `palmSize` so the rules are independent of how far the player stands. If `palmSize < 0.015` (hand tiny / far away) the classifier returns `'none'` with confidence 0.

### 2.2 Finger extension angle (3D, world space)

For finger `f` with joints `(mcp, pip, tip)` in `worldLandmarks` (metres, hand-centred, scale-consistent):

```
a = P(mcp) − P(pip);  b = P(tip) − P(pip)
pipAngle_f = degrees(acos(clamp(dot(a, b) / (|a|·|b|), −1, 1)))     // 180° = straight finger
```

Using the 3D world landmarks here is deliberate: when the hand points at the camera, the 2D projection of a straight finger collapses to a short segment, but its 3D angle stays near 180°.

### 2.3 Tip reach (2D, image space)

```
reach_f = dist2D(TIP_f, WRIST) / palmSize            // ≈ 1.6–2.1 extended, ≈ 0.7–1.1 curled
pipReach_f = dist2D(PIP_f, WRIST) / palmSize
tipBeyondPip_f = reach_f > pipReach_f + 0.15
```

### 2.4 Per-finger state

```
extended_f = pipAngle_f ≥ FINGER_EXT_ANGLE_DEG  &&  tipBeyondPip_f
curled_f   = pipAngle_f ≤ FINGER_CURL_ANGLE_DEG  ||  reach_f < 1.15
// otherwise the finger is 'ambiguous'
```

### 2.5 Thumb

The thumb is deliberately weak evidence (it is the least reliably tracked and people hold it inconsistently):

```
thumbOut = dist2D(THUMB_TIP, PINKY_MCP) / palmSize > 1.3     // thumb away from the palm
thumbIn  = dist2D(THUMB_TIP, INDEX_MCP) / palmSize < 0.6 || dist2D(THUMB_TIP, MIDDLE_PIP) / palmSize < 0.5
```

### 2.6 Edge-on detection

When the palm faces sideways, PIP angles and reaches are unreliable. Define the apparent palm width:

```
palmWidth = dist2D(INDEX_MCP, PINKY_MCP) / palmSize          // ≈ 0.8–1.1 facing camera, < 0.35 edge-on
edgeOn = palmWidth < 0.35
```

When `edgeOn`, the classifier returns the **previous stable gesture** with `confidence = 0.3` (so hysteresis holds it, see §4) rather than guessing.

## 3. Rules

Let `E = count(extended_f)`, `C = count(curled_f)` over the four fingers.

| Gesture | Rule | Confidence |
| --- | --- | --- |
| `open` | `E === 4`, or (`E === 3` and the fourth is ambiguous and `thumbOut`) | `min over f of (pipAngle_f − FINGER_CURL_ANGLE_DEG) / (FINGER_EXT_ANGLE_DEG − FINGER_CURL_ANGLE_DEG)` clamped 0..1 (how far the *least* extended finger is from curl) |
| `fist` | `C === 4`, or (`C === 3` and the fourth is ambiguous and `thumbIn`) | `1 − max over f of (reach_f − 0.7) / 0.6` clamped 0..1 (how tucked the *most* open finger is) |
| `point` | `extended_INDEX` and `curled_MIDDLE && curled_RING && curled_PINKY` (thumb ignored); also accepted: index extended, middle *ambiguous*, ring and pinky curled, if `pipAngle_INDEX − pipAngle_MIDDLE ≥ 35°` | `min(ext margin of index, min curl margin of the three others)` |
| `none` | none of the above | `0` |

Rule precedence when more than one matches (possible only through the "3 + ambiguous" relaxations): `point` > `fist` > `open`. Pointing is rarest and most deliberate; false positives on `point` are costly (a 500 ms charge) so its rule has no relaxation on the index finger itself.

### 3.1 `classify` pseudocode

```ts
export function classify(hand: HandRaw, prev: Gesture): { gesture: Gesture; confidence: number } {
  const palmSize = dist2D(hand, LM.MIDDLE_MCP, LM.WRIST);
  if (palmSize < 0.015) return { gesture: 'none', confidence: 0 };
  if (dist2D(hand, LM.INDEX_MCP, LM.PINKY_MCP) / palmSize < 0.35) return { gesture: prev, confidence: 0.3 }; // edge-on

  const f = FINGERS.map(([mcp, pip, , tip]) => {
    const angle = pipAngleDeg(hand.worldLandmarks, mcp, pip, tip);
    const reach = dist2D(hand, tip, LM.WRIST) / palmSize;
    const pipReach = dist2D(hand, pip, LM.WRIST) / palmSize;
    return {
      angle, reach,
      extended: angle >= FINGER_EXT_ANGLE_DEG && reach > pipReach + 0.15,
      curled: angle <= FINGER_CURL_ANGLE_DEG || reach < 1.15,
    };
  });
  const [idx, mid, ring, pinky] = f;
  const E = f.filter(x => x.extended).length, C = f.filter(x => x.curled).length;
  const thumbOut = dist2D(hand, LM.THUMB_TIP, LM.PINKY_MCP) / palmSize > 1.3;
  const thumbIn  = dist2D(hand, LM.THUMB_TIP, LM.INDEX_MCP) / palmSize < 0.6
                || dist2D(hand, LM.THUMB_TIP, LM.MIDDLE_PIP) / palmSize < 0.5;
  const extMargin  = (x) => clamp01((x.angle - FINGER_CURL_ANGLE_DEG) / (FINGER_EXT_ANGLE_DEG - FINGER_CURL_ANGLE_DEG));
  const curlMargin = (x) => clamp01(1 - (x.reach - 0.7) / 0.6);

  const pointOK = idx.extended && ring.curled && pinky.curled
               && (mid.curled || (!mid.extended && idx.angle - mid.angle >= 35));
  if (pointOK) return { gesture: 'point', confidence: Math.min(extMargin(idx), curlMargin(mid), curlMargin(ring), curlMargin(pinky)) };

  const fistOK = C === 4 || (C === 3 && f.every(x => x.curled || !x.extended) && thumbIn);
  if (fistOK) return { gesture: 'fist', confidence: Math.min(...f.map(curlMargin)) };

  const openOK = E === 4 || (E === 3 && f.every(x => x.extended || !x.curled) && thumbOut);
  if (openOK) return { gesture: 'open', confidence: Math.min(...f.map(extMargin)) };

  return { gesture: 'none', confidence: 0 };
}
```

## 4. Hysteresis (`gestures/cursor.ts`)

Per hand: `stable: Gesture`, `candidate: Gesture`, `candidateFrames: number`, `ambiguousFrames: number`, `stableSince: number`.

1. `r = classify(hand, stable)`.
2. If `r.gesture === stable`: `candidateFrames = 0; ambiguousFrames = 0`.
3. Else if `r.gesture === 'none'` or `r.confidence < 0.25`: `ambiguousFrames++`. If `ambiguousFrames ≥ GESTURE_DROP_FRAMES` → `stable = 'none'`, `stableSince = tCapture`.
4. Else (a different confident gesture): if `r.gesture === candidate` then `candidateFrames++` else `candidate = r.gesture; candidateFrames = 1`. If `candidateFrames ≥ GESTURE_CONFIRM_FRAMES` → `stable = candidate`, `stableSince = tCapture`, reset counters.
5. On hand loss (`present` false ≥ 2 frames): `stable = 'none'`, counters reset.

Output: `HandCursor.gesture = stable`, `gestureConfidence = r.confidence` (of the current frame, informational), `gestureHeldMs = tCapture − stableSince`.

Fast-path exception: switching **into** `'open'` from `'none'` is allowed after 1 frame when `confidence ≥ 0.7`. Players open their hand mid-swing and a 3-frame (≈ 100 ms) delay would turn fast slashes into non-hits. Leaving `'open'` still requires the full confirm count so a blurred fast hand does not drop the blade.

## 5. Position, velocity, `pointDir`

### 5.1 Play-plane position

`pos` = palm centre, defined as the mean of `WRIST, INDEX_MCP, MIDDLE_MCP, RING_MCP, PINKY_MCP` (filtered image space) mapped with `mapToPlayPlane(u′, v)` from [02 §Image → play plane](02-architecture.md#image--play-plane). `tip` = `INDEX_TIP` mapped the same way.

### 5.2 Velocity

Keep a ring of the last `VEL_WINDOW_FRAMES + 1` `(pos, tCapture)` samples. Velocity is a central difference across the window:

```
vel = (pos[n] − pos[n − VEL_WINDOW_FRAMES]) / (t[n] − t[n − VEL_WINDOW_FRAMES])     // m/s on the play plane
speed = |vel|
```

With fewer samples (hand just appeared) use whatever span exists; with one sample `vel = 0`. Because positions were One Euro-filtered, no additional smoothing is applied to `vel`; the window averages the remaining jitter. Velocity is in play-plane metres per second — the unit all `*_SPEED` constants use.

### 5.3 Extrapolation

If the loop runs a frame with no new `TrackingFrame` ([02 §Frame loop](02-architecture.md#frame-loop) step 2) the cursor advances `pos += vel · dt` and `tip` likewise, up to `EXTRAPOLATE_MAX_MS` since `tCapture`, then holds. `tCapture` is not advanced by extrapolation (judgements use the real capture time).

### 5.4 `pointDir`

```
pointDir = normalize(mapToPlayPlane(INDEX_TIP) − mapToPlayPlane(INDEX_MCP)).xy
```

Used by the HUD charge indicator and [07 §Beam resolution](07-hit-detection-and-scoring.md#beam-resolution). When the finger points at the camera the 2D vector is short and noisy; if its pre-normalised length < 0.05 m, keep the previous `pointDir`.

### 5.5 History

`history` is the last `TRAIL_HISTORY` values of `pos` (newest last). When the hand is absent the history is cleared so the trail does not stretch across the screen on reacquisition.

## 6. Blade state (`gestures/blade.ts`)

```
if (!bladeActive && gesture === 'open' && speed ≥ BLADE_ON_SPEED)  bladeActive = true
if ( bladeActive && (gesture !== 'open' || speed ≤ BLADE_OFF_SPEED)) bladeActive = false
bladeLength = bladeActive
  ? lerp(BLADE_LEN_MIN, BLADE_LEN_MAX, clamp01((speed − BLADE_ON_SPEED) / (BLADE_FULL_SPEED − BLADE_ON_SPEED)))
  : 0
```

The renderer smooths `bladeLength` visually ([12](12-rendering-hands-trails.md)); the game uses the raw value for the swept segment. A gesture change to `'fist'` or `'point'` retracts the blade immediately (the player has closed their hand).

## 7. Beam charge

```
if (gesture === 'point') charge = min(1, charge + dt / BEAM_CHARGE_MS)
else                     charge = max(0, charge − 3 · dt / BEAM_CHARGE_MS)
```

- `charge` reaching 1 is the fire condition ([07 §Beam resolution](07-hit-detection-and-scoring.md#beam-resolution)). After a fire, `charge = 0` and charging is locked out for 150 ms (`chargeLockUntil`) so one held point does not re-fire every frame.
- The 3× decay means a 100 ms blink of `'none'` (e.g. motion blur) costs ~0.6 of charge rather than resetting — forgiving, but a clearly dropped point empties in ~170 ms.
- The HUD shows `charge` as a ring around the hand indicator; the renderer draws the charging beam from `tip` ([12](12-rendering-hands-trails.md)).

## 8. Debug and tuning workflow

- The debug overlay (dev only) prints per hand: `E/C`, each `pipAngle` and `reach`, `palmWidth`, raw and stable gesture, confidence, `speed`, `bladeLength`, `charge`.
- `FINGER_EXT_ANGLE_DEG`, `FINGER_CURL_ANGLE_DEG`, `BLADE_ON_SPEED`, `BLADE_OFF_SPEED` are exposed on a dev-only `window.__tune` object (hot-editable in the console) with a "copy as constants" button so the agreed values go back into `core/constants.ts` in one paste. No tuning value lives anywhere else.
- Tuning session protocol (H7 in [19](19-build-plan.md)): three people × three gestures × near/mid/far distance × palm-facing/45°. Record fixtures for any case that fails and add them to the unit tests before changing thresholds.

## 9. Unit tests (`tests/unit/classifier.test.ts`)

Fixtures are recorded `HandRaw` sequences in `tests/fixtures/hands/*.json` (`{ label, frames: HandRaw[] }`).

| Test | Expectation |
| --- | --- |
| `open_static_*.json` | ≥ 95 % of frames classify `open` with confidence ≥ 0.5 |
| `fist_static_*.json` | ≥ 95 % `fist` |
| `point_up / point_camera / point_side.json` | ≥ 90 % `point` (camera-facing relies on 3D angles) |
| `slash_sequence.json` | hysteresis: stable gesture becomes `open` within 2 frames of the hand opening and never flickers to `none` during the 12 fast frames |
| `edge_on_flip.json` | no gesture change during the edge-on segment |
| `charge_hold.json` (0.6 s point) | `charge` reaches 1 at the frame nearest 500 ms ± 1 frame; releasing drops to 0 in ≤ 6 frames |
| synthetic velocity (positions on a straight line at 6 m/s) | `speed` within 5 % of 6; blade turns on; length matches the formula |
| far hand (`palmSize` 0.01) | `none`, confidence 0, no throw |

## 10. Acceptance criteria

- [ ] All three gestures are recognised within 100 ms of being formed, at 1.5–2.5 m from a 720p webcam, in room light, for three different people.
- [ ] A full-speed open-hand slash does not lose the `open` gesture mid-swing (verified on the debug overlay: no `none` frames during a swing).
- [ ] Pointing straight at the camera charges the beam as reliably as pointing up.
- [ ] Relaxed hand (half-open) classifies `none`, not `open` or `fist`; the player must deliberately open or close.
- [ ] Crossing hands in front of the body does not swap gesture state between hands (identity tracking from [05 §3.2](05-tracking-pipeline.md#32-hand-identity)).
- [ ] All unit tests in §9 pass; the classifier is a pure function with no `three` or DOM imports.

## Constants required

All referenced constants exist in [02](02-architecture.md#constants). Local thresholds (palm-size floor 0.015, edge-on 0.35, tipBeyondPip 0.15, thumb 1.3 / 0.6 / 0.5, confidence floor 0.25, fast-path 0.7, point relaxation 35°, charge lockout 150 ms) are module-level constants in `gestures/`. If tuning shows they must be shared with the renderer or tests, promote them to `core/constants.ts` as `GESTURE_*`.
