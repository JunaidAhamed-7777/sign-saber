# 07 — Hit Detection & Scoring

**Implementation checkpoint:** the pure game/audio spine and synthetic assertions are implemented. Live camera/audio integration and phase acceptance remain unverified.

Scope: `game/` — the spawner, the live-object simulation, contact tests between `HandCursor`s and notes, judgement, bad cuts, beams, obstacles vs `BodyState`, scoring, kinetic energy and `SessionStats`. Inputs are the contracts in [02](02-architecture.md#contracts); outputs are the events in [02 §Game → Renderer / UI](02-architecture.md#game--renderer--ui-events). `game/` never imports `three`; all geometry here is small hand-written vector math in `utils/math.ts`.

Design basis: [ADR-006](03-decisions.md#adr-006--contact-based-hits-with-timing-judgement-derived-from-note-depth) — a hit is a geometric contact on the play plane while the note is inside a *timing* window; the judgement comes from how early or late the contact is.

**Current contact behavior — 2026-10-25:** slash/smash contact is shape-independent at `CONTACT_MIN_SPEED = 0.3` play-plane m/s. The contact footprint and palm radius both use `HIT_ZONE_SCALE = 2.5`; the visible block size and timing windows do not grow. Wrong-shape Bad Cuts are no longer produced by these contacts. Classification remains relevant to feedback, blade extension, menu actions and Point beam charge. These implemented rules supersede the earlier strict Open/Fist gating; synthetic assertions are separate from human/hardware acceptance in [the roadmap](../ROADMAP.md).

## 1. Spawner (`game/spawner.ts`)

The beatmap arrays are sorted by `t`; the spawner keeps a cursor index into each.

Per frame with `songTime`:

1. **Notes.** While `notes[i].t − spawnLead(notes[i]) ≤ songTime`: create a `LiveNote`, emit `note:spawn`, `i++`. `spawnLead = note.type === 'beam' ? BEAM_LEAD_MS : beatmap.approachMs`.
2. **Obstacles.** While `obstacles[j].t − approachMs ≤ songTime`: create `LiveObstacle`, emit `obstacle:spawn`, `j++`.
3. **Music events.** While `events[k].t ≤ songTime`: emit `music:event`, `k++`.
4. After a pause/resume no catch-up logic is needed: `songTime` is frozen while paused ([15](15-audio-playback-sync.md)), so nothing was skipped.
5. On `results:retry` the cursors reset to 0 and all live objects are released to their pools.

Pool sizes: `MAX_LIVE_NOTES`; the validator checks simultaneous unresolved objects, including late-input grace, before play. If a runtime invariant still exhausts the pool, pause with a useful map-capacity error and diagnostics. Do not turn an implementation resource failure into a player's miss or silently skip content.

The runtime supplies a session map with `approachMs` multiplied by `APPROACH_SLOWDOWN` (currently 2.17). This slows approach without changing note timestamps; the spawner and live positions use that same session value.

```ts
interface LiveNote {
  note: Note; state: 'live' | 'hit' | 'missed' | 'badcut' | 'escaped';
  pos: Vec3;                         // recomputed every frame
  target: Vec3;                      // (LANE_X[col], LANE_Y[row], 0) or the beam hover point
  halfExtents: Vec3;                 // BLOCK_SIZE/2 each; beams use BLOCK_SIZE/2 too
  rotation: number;                  // idle spin, cosmetic
}
interface LiveObstacle {
  obstacle: Obstacle; state: 'live' | 'hit' | 'dodged';
  zFront: number; zBack: number;     // leading/trailing face depth this frame
  colsCovered: [number, number];
  entered: boolean;
}
```

## 2. Live object positions (`game/liveObjects.ts`)

Positions are pure functions of `songTime` — no integration, so pause/resume and frame hitches are exact.

### 2.1 Travelling notes and obstacles

From [02 §Lane geometry](02-architecture.md#lane-geometry), with `d = normalize(0, −sin(LANE_PITCH_DEG), cos(LANE_PITCH_DEG))`:

```
progress = (songTime − (t − approachMs)) / approachMs
pos      = target − d · SPAWN_DISTANCE · (1 − progress)
speed    = SPAWN_DISTANCE / approachMs · 1000                    // m/s along d
```

Since `|d.z| = cos 6° ≈ 0.9945`, `pos.z ≈ −SPAWN_DISTANCE · (1 − progress) · 0.9945`; `pos.z = 0` exactly when `songTime = t`.

Obstacles: `target.x` is the wall centre (`wallLeft`: `(LANE_X[0] + LANE_X[1]) / 2`; `wallRight`: `(LANE_X[2] + LANE_X[3]) / 2`), `target.y = PLAY_CENTER_Y`. The wall's depth extent is `durationMs · speed / 1000`; its leading face is at the position computed for `t`, the trailing face at the position for `t + durationMs`. Per frame compute `zFront` (leading face z) and `zBack = zFront − depth · d.z`.

### 2.2 Beam targets

```
appearAt = t − BEAM_LEAD_MS; escapeAt = t + BEAM_ESCAPE_MS
pos      = (LANE_X[col], LANE_Y[row] + BEAM_HOVER_Y_OFFSET + bob, BEAM_HOVER_Z)
bob      = 0.08 · sin(2π · songTime / 1400)
```

Fade-in alpha over the first 300 ms is the renderer's concern. If `songTime > escapeAt` and still `live` → `state = 'escaped'`, counted as a miss (`note:miss`), and the renderer flies it upward.

### 2.3 Lifecycle thresholds

| Condition | Result |
| --- | --- |
| unresolved travelling note whose capture-time window and bounded delivery grace have closed | `note:miss`; `state = 'missed'`; combo breaks |
| `pos.z > DESPAWN_Z` | renderer may cull the mesh; retain unresolved gameplay state until judgement is terminal |
| beam `live` and its latest valid hit window plus grace has closed | `note:miss`; visual escape begins no later than `escapeAt` |
| obstacle trailing capture-time evaluation closes without contact | terminal `obstacle:dodged`; valid safe body observations earn dodge points, while an unobserved wall emits zero points and adds no dodge count |

The miss is declared by **capture time plus bounded delivery grace**, never by `MISS_Z`. Travel speed changes with the session approach time; visual clearance and the default late Good window of 200 ms are separate deadlines. A visual despawn at `DESPAWN_Z` likewise cannot release an unresolved judgement record.

## 3. Hit zone and timing error

A slash/smash note is temporally eligible when `|timingErrorMs| ≤ WINDOW_GOOD_MS · WINDOW_SCALE`. Contact outside that interval is ignored entirely. `HIT_ZONE_SCALE` changes spatial tolerance, not these timing windows. `WINDOW_SCALE` is frozen in the session configuration and included in results/replay metadata; changing difficulty/assistance cannot silently alter a ranked run halfway through. Current auto-targeted beams have the separate fire/scoring rule in §8.

```
songTimeAtCapture = songClock.fromPerformanceTime(cursor.tCapture)     // [15 §SongClock]
timingErrorMs     = songTimeAtCapture − note.t + inputOffsetMs          // negative = early
```

Use the cursor's measured `tCapture`, not inference arrival or render-predicted position. When sensor metadata is unavailable, `tCapture` is callback receipt and residual camera delay must be measured rather than claimed to be removed ([05](05-tracking-pipeline.md)).

For a travelling note, `songTime − t = pos.z / (speed · cos(LANE_PITCH_DEG)) · 1000`: positive depth beyond the plane means late, not early. The timestamp form remains authoritative and works for beams.

### Late-result policy

Tracking inference is asynchronous, so a sample captured inside a window can arrive after the render clock passes its end. Process pending samples and swept contacts before expiring notes. Let `lastEligibleCapture = note.t + WINDOW_GOOD_MS · WINDOW_SCALE − inputOffsetMs`. A miss becomes final when either the processed capture watermark has passed that time (after testing the interval that crosses it), or current song time passes `lastEligibleCapture + INPUT_MAX_AGE_MS`. Reject input whose actual arrival age exceeds `INPUT_MAX_AGE_MS`; later packets cannot reopen a terminal note. Pause/reset clears watermarks and old-session packets. Record rejected late samples in diagnostics so a struggling pipeline is visible rather than hidden by wider windows.

## 4. Contact tests (`game/hit.ts`)

All contact tests are performed in the play plane's x–y coordinates. The depth is handled by the timing window (§3); geometrically the note is treated as its x–y footprint at `target`, not at its current `pos`. This is intentional: the player aims at *where the block is going*, which is where their cursor lives.

Block contact footprint: axis-aligned square `[target.x ± h, target.y ± h]` with `h = BLOCK_SIZE · HIT_ZONE_SCALE / 2`. With `BLOCK_SIZE = 0.6` and `HIT_ZONE_SCALE = 2.5`, the contact square is 1.5 m wide; the visible block remains 0.6 m wide. Palm tolerance is also scaled: `r = HAND_HIT_RADIUS · HIT_ZONE_SCALE = 0.55` m. This is a 2.5× linear spatial scale, not a timing multiplier. Cosmetic idle rotation is ignored by the hit test. The low-level geometry helpers default to scale 1; `GameSession` explicitly passes the runtime scale for both palm and blade contacts.

### 4.1 Palm sphere vs block

```
closest = (clamp(pos.x, bx − h, bx + h), clamp(pos.y, by − h, by + h))
contact = dist(pos.xy, closest) ≤ r
```

### 4.2 Swept palm (continuous collision)

At 10 m/s the palm moves 0.33 m per 33 ms tracking frame — more than half a block — so a point test alone tunnels. Use the capsule swept by the palm sphere from `prevPos` to `pos`:

```
contact = segmentToAABBDistance2D(prevPos.xy, pos.xy, box) ≤ r
```

`segmentToAABBDistance2D` = 0 if the segment intersects the box (Liang–Barsky clip), else the minimum of point-to-box distance at the endpoints and segment-to-edge distances (4 edges). `prevPos` is the cursor position from the previous valid `TrackingFrame` of the same hand identity, never the previous render frame or a prediction. Return the earliest contact fraction `α` along the sweep into reusable scratch output. Judge at `contactPerf = prevCapture + α · (capture − prevCapture)`; clip the sweep to the eligible time interval before testing. Do not connect samples across loss, pause, identity reassignment or an over-age gap.

### 4.3 Blade swept segment

When `bladeActive`, the blade is the segment from `pos` to `pos + normalize(vel).xy · bladeLength`: it extends in the direction of motion, like a saber being swung, so the tip leads. The swept area between the previous blade segment and the current one is a quad; test:

```
contact = segIntersectsAABB(bladePrev) || segIntersectsAABB(bladeNow)
       || segIntersectsAABB(bladePrev.tip → bladeNow.tip)
       || segIntersectsAABB(bladePrev.base → bladeNow.base)         // = the palm sweep
```

The four edge tests alone miss the case where the entire block footprint lies inside the swept quad. The implementation solves the earliest linearly interpolated blade endpoint/box and segment/corner contact, including footprint containment. The blade tests the same scaled square and has no additional thickness; the scaled palm sphere supplies tolerance. Blade activation still depends on Open/speed feedback, but a blade is optional for either block type: moving palm contact remains valid with `open`, `fist`, `point` or `none`.

### 4.4 Which notes are tested

Per newly accepted sample with a present cursor, test unresolved notes whose eligible interval overlaps the measured sweep. Usually only a few qualify; measure before adding a spatial index. A cached hand sample is never re-evaluated on every render frame.

## 5. Moving-hand requirement and retained Bad Cut contract

| Note type | Valid destruction | Bad Cut | Ignored |
| --- | --- | --- | --- |
| `slash` | Present hand at `speed ≥ CONTACT_MIN_SPEED`, with eligible measured palm/blade contact; any classified shape | None from current contact rules | Below the motion floor, absent/invalid/stale input, no spatial contact or outside the timing interval |
| `smash` | Same moving-hand rule as slash; any classified shape | None from current contact rules | Same exclusions as slash |
| `beam` | Confident Point charge and automatic target resolution (§8) | Palm contact never produces a Bad Cut | Palm/blade contact does not fire a beam |

Rules:

1. A hand below `CONTACT_MIN_SPEED` does nothing. At or above the floor, even a low-confidence or `none` classification may score if the present cursor passes finite-data, capture-age, geometry and timing guards. This threshold is a current initial setting, not proof of a safe resting-hand false-hit rate.
2. `ContactOutcome` retains `badcut` and the event/scoring contract for compatibility, but current `contactOutcome` returns only `hit` or `ignore`. If another supported producer supplies a Bad Cut, `note:badcut { note, hand, gesture }` remains terminal, resets combo, awards 0 and increments `counts.badcut`; it cannot later become a miss. Do not describe wrong Open/Fist shape as a current player penalty.
3. A valid hit emits `note:hit` and sets `state = 'hit'` in the same frame; a note can be hit exactly once.
4. Collect both hands' candidates for the same sample before resolving the note. Resolve earliest contact time, then left/right for an exact tie. Apply notes in `(capture time, note.t, note.id)` order. The retained generic resolver also prefers `hit` over `badcut`, though the current shape-independent contact producer cannot create that conflict.
5. Hand lost mid-swing: no contact is evaluated for an absent cursor; the note is judged normally when its zone closes.

## 6. Judgement

```
|e| ≤ WINDOW_PERFECT_MS · WINDOW_SCALE → 'perfect' (SCORE_PERFECT)
|e| ≤ WINDOW_GREAT_MS   · WINDOW_SCALE → 'great'   (SCORE_GREAT)
|e| ≤ WINDOW_GOOD_MS    · WINDOW_SCALE → 'good'    (SCORE_GOOD)
```

`note:hit` payload fields:

- `impactPos`: for palm/sweep contacts the closest point on the box to the palm path; for blade contacts the midpoint of the clipped blade segment inside the box; z = `note.pos.z` at this frame (so the renderer's slice/shatter starts where the block visually is).
- `impactVel`: the cursor's `vel` (3D with z = 0).
- `cutPlane` (slash only): see §7.
- `scoreDelta`, `combo`, `multiplier`: after applying §8.

For current auto-targeted beam fire, the same timing buckets apply when available; fire outside them scores Good while the target is spawned and unresolved (§8). This exception does not permit out-of-window slash/smash hits.

## 7. Cut plane construction (for the slicer)

The slice must follow the swing ([ADR-008](03-decisions.md#adr-008--real-plane-cut-slicing-for-a-convex-cube-pre-fractured-glb-for-smashing-no-physics-engine)).

```
swingDir = normalize(impactVel)                      // in the play plane, z = 0
laneDir  = d                                          // approach direction
normal   = normalize(cross(swingDir, laneDir))        // perpendicular to both: the plane contains the swing and the depth axis
if |normal| < 1e-3 (degenerate, e.g. zero velocity) normal = (0, 1, 0)
cutPlane = { normal, point: impactPos }
```

The plane contains the swing direction and the lane direction, so a horizontal swipe produces a horizontal cut (normal ≈ ±y), a vertical chop a vertical one, and a diagonal swing a diagonal cut. The sign of `normal` is irrelevant for geometry; the renderer separates halves along `±normal`. The plane is expressed in world space; the renderer transforms it into the block's local space using the block's current transform.

## 8. Beam resolution

Runs on a newly accepted sample after note contacts, per hand with `present`, confident stable pointing, `charge ≥ 1` and the session's lock/recharge deadlines satisfied. This describes the existing automatic-target behavior; the shape-independent slash/smash change does not remove Point/hold from beams.

1. **Candidates.** Consider spawned unresolved beam notes. Current gameplay does not gate this set by `BEAM_AIM_RADIUS`, fingertip position or `pointDir`; projection/aim helpers remain available to presentation and geometry tests.
2. **Priority.** Choose the earliest note `t`, then smallest `id`. Process logical hands in stable left/right order; once one destroys the target, a second hand cannot destroy it again.
3. **Fire.** Emit `beam:fire { hand, from: tip, to: note.pos, note }`, then exactly one `note:hit`. Use normal Perfect/Great/Good timing when inside a bucket, otherwise Good while the target is still spawned and unresolved. `beam:fire` starts the line/flash; `note:hit` starts destruction.
4. **Wait.** With no spawned unresolved beam candidate, do not fire, reset charge or start lockout. Full charge waits until a target exists. An early visible candidate can fire immediately; the old aimed-window wait rule is superseded by this behavior.
5. **Recharge.** A committed shot resets the cursor charge through its owning input state. The session sets its song-time refire deadline by `BEAM_REFIRE_LOCK_MS` and its capture-time recharge deadline by `BEAM_CHARGE_MS`. These guards prevent a retained full-charge sample from firing a succession of targets immediately. The nullable `beam:fire.note` event shape remains supported for defensive consumers; the normal resolver emits a real unresolved target.

`BEAM_LEAD_MS` determines target appearance. Point and hold remains the deliberate action; no click, release or precision aim is required. Synthetic tests establish this code path, not recognition reliability or live human timing.

## 9. Obstacles vs body (`game/hit.ts`, obstacle section)

An obstacle **spans the hit plane** while `zFront > 0 ≥ zBack`: the hit plane `z = 0` lies between the leading and trailing faces. The player's body is considered at `z = 0`.

| Obstacle | Covers | Player is safe when | Player is hit when |
| --- | --- | --- | --- |
| `wallLeft` | columns 0–1 (x < 0) | `BodyState.lean === 'right'` | spans hit plane and `lean !== 'right'` |
| `wallRight` | columns 2–3 (x > 0) | `lean === 'left'` | spans hit plane and `lean !== 'left'` |
| `bar` [STRETCH] | rows 1–2 | `duck === true` | spans hit plane and `!duck` |

Rules:

1. Evaluate new body samples at capture-song time during the obstacle span, after grace. The first observed unsafe state produces `obstacle:hit`, `state = 'hit'`, `counts.obstaclesHit++` and a `SCORE_WALL_PENALTY` point deduction, capped by the current score. Combo and play continue. Exactly once per obstacle. Render fps does not create additional body observations.
2. If `BodyState.present === false`, do not fabricate a collision or award a free dodge. Current wall judgement does not request a tracking pause; an unobserved wall passes with no penalty or reward. This supersedes the earlier wall-triggered pause rule. Other lifecycle pause guards remain separate.
3. `lean` already carries hysteresis (`LEAN_ON` / `LEAN_OFF`, [05 §5](05-tracking-pipeline.md#5-body-metrics-trackingbodyts--bodystate)); no extra debounce here.
4. Grace: the first `OBSTACLE_GRACE_MS` after `zFront` crosses 0 are not evaluated, so a player who is *in the act* of leaning when the wall arrives is not punished for tracking latency. Default 120 ms.
5. After the obstacle's trailing capture interval and bounded delivery grace close, if all evaluated body samples were safe and valid evidence exists, emit `obstacle:dodged { scoreDelta: SCORE_DODGE · multiplier }` and increment `counts.obstaclesDodged`. With no body samples, emit the terminal event with `scoreDelta: 0` without incrementing the dodge count. Dodging does not increase combo but is multiplied. `MISS_Z` may delay visual clearance; it does not decide whether a body sample was safe.

## 10. Scoring (`game/score.ts`)

### 10.1 Combo and multiplier

```
on valid note hit:      combo++;  multiplier = ladder(combo)
on miss / retained badcut: combo = 0; multiplier = 1; emit combo:change { broke: true }
on obstacle hit:        score -= min(score, SCORE_WALL_PENALTY); combo/multiplier unchanged
ladder(c) = largest m such that c ≥ threshold, from MULTIPLIER_LADDER   // 0→1, 5→2, 15→4, 30→8
```

Beat Saber awards the multiplier from the hit *after* the threshold; we award it from the hit that reaches the threshold (simpler, slightly more generous). `scoreDelta = baseScore · multiplier` where `baseScore` is from §6. `maxCombo = max(maxCombo, combo)`.

### 10.2 Score and maxScore

```
score    += scoreDelta
maxScore  = Σ over all notes of SCORE_PERFECT · ladder(index + 1) + Σ over obstacles of SCORE_DODGE · 8
```

`maxScore` is computed once when the beatmap loads: note scores use the perfect-combo ramp (first 4 notes ×1, next 10 ×2, next 15 ×4, rest ×8), plus each obstacle at the maximum ladder multiplier. It is a **score upper bound**, not an accuracy denominator; an early wall may occur before ×8 is reachable.

Accuracy instead measures unmultiplied base points:

```
possibleBase = notes.length · SCORE_PERFECT + obstacles.length · SCORE_DODGE
earnedBase   = perfectCount · SCORE_PERFECT + greatCount · SCORE_GREAT
             + goodCount · SCORE_GOOD + obstaclesDodged · SCORE_DODGE
accuracy     = possibleBase > 0 ? earnedBase / possibleBase : 0
```

A flawless all-Perfect run reaches 100% even on a short map with an early wall. A missed note contributes zero; combo affects score, not the same hit's timing quality. Live HUD accuracy uses resolved objects as its denominator (judged notes plus completed obstacles); final accuracy uses the whole map. Before any judgement show an em dash rather than a misleading 0%. The validator rejects a map with no playable objects. Rank is computed from final accuracy. Record `WINDOW_SCALE`, difficulty, generator version and assistance settings with results so unlike configurations are not compared as equivalent.

### 10.3 Rank

From `RANK_THRESHOLDS` on final accuracy: SS ≥ 0.95, S ≥ 0.90, A ≥ 0.80, B ≥ 0.65, C ≥ 0.50, else D.

## 11. Kinetic energy (`game/kinetic.ts`)

A playful motion proxy. A monocular camera and an assumed shoulder span do not measure body mass, true 3D velocity or metabolic expenditure; no fitness/health accuracy is claimed. Keep its label visible wherever the number is shown.

Per hand, detect **swings** as speed peaks:

1. Convert play-plane speed to physical speed. `speed` is in play-plane m/s, where the whole frame width is `PLAY_W` metres; the physical frame width is `physicalScale · 1.0` metres (`physicalScale` is metres per normalized image unit, from `BodyCalibration`). Therefore `vPhys = speed · physicalScale / PLAY_W`.
2. Track `vPhys` per frame; a swing is a local maximum `vPeak` with `vPeak ≥ SWING_MIN_SPEED` separated from the previous accepted peak by `SWING_REFRACTORY_MS` and a trough below `SWING_TROUGH_RATIO · vPeak`.
3. `KE_swing = 0.5 · HAND_MASS_KG · vPeak²`; `kineticJoules += KE_swing`.
4. Torso: same peak detection on `BodyState.torsoSpeed` (already physical m/s) with `TORSO_MASS_KG` and a `TORSO_SWING_MIN_SPEED` floor.
5. `kcal = kineticJoules / 4184 / METABOLIC_EFFICIENCY`.

Arithmetic example under the assumed masses and efficiency: a 4 m/s proxy peak yields 20 J; 300 such peaks yield 6 kJ and an illustrative 5.7 kcal conversion. This validates the formula only, not a real player's calorie burn. Do not translate it into food/fitness claims in the pitch.

## 12. SessionStats and highlight capture (`game/session.ts`)

`SessionStats` ([02](02-architecture.md#game--renderer--ui-events)) is accumulated live and finalised on `song:ended`. `peakComboSongTimeMs` is updated whenever `combo` exceeds the previous `maxCombo` **and** `combo ≥ HIGHLIGHT_MIN_COMBO`; at that moment emit `highlight:capture { songTimeMs }` — debounced so at most one capture per `HIGHLIGHT_DEBOUNCE_MS` (the renderer snapshots the silhouette and skeleton, [13](13-rendering-environment-camera-postfx.md)). The last capture before the song ends is the one shown on RESULTS; if no combo ever reached `HIGHLIGHT_MIN_COMBO`, the renderer captures at the final `note:hit` as a fallback, or at song end if there were none.

`session:end` fires after `SONG_TAIL_MS` once no note is `live` ([04](04-state-machine.md#transitions)). Notes still `live` at `durationMs` (map ends on a note) are judged normally; the tail covers their window.

## 13. Edge cases

| Case | Behaviour |
| --- | --- |
| Two hands contact one block in one sample | Valid-hit priority, then earliest contact and deterministic hand tie-break; exactly one terminal event |
| Hand present with `gesture === 'none'` moving through a block | Hits at `speed ≥ CONTACT_MIN_SPEED` when scaled geometry and timing pass; never a wrong-shape Bad Cut |
| Hand lost mid-swing, reappears after the zone | Note missed normally |
| Chord (two notes with `|Δt| < 20 ms`) | Both testable; one blade sweep can hit both in one frame (both score) |
| Note and obstacle at the same time in different columns | Allowed by the validator; evaluated independently |
| `inputOffsetMs` moves a contact outside the zone | Ignored contact; no bad cut |
| Pause during a live note | `songTime` frozen; nothing is judged; resume continues exactly |
| Beam charged with no target for a long time | Held at 1; the HUD pulses; no timeout |
| Beam already charged when an early target appears | Confident Point auto-targets the earliest spawned unresolved beam; outside timing buckets the hit is Good |
| Note pool exhausted | Pause with map-capacity fault; no fabricated player miss |

## 14. Unit tests (`tests/unit/judge.test.ts`, `hit.test.ts`, `score.test.ts`)

Current synthetic assertions are in [judge.test.ts](../app/tests/unit/judge.test.ts), [hit.test.ts](../app/tests/unit/hit.test.ts), [score.test.ts](../app/tests/unit/score.test.ts) and [gameSession.test.ts](../app/tests/gameSession.test.ts). The table defines required coverage; it is not evidence that every listed boundary or human interaction has been exercised. In particular, the low-level geometry tests' default scale 1 is distinct from runtime scale 2.5.

| Test | Expectation |
| --- | --- |
| Lane equation | `pos.z = 0` at `songTime = t` (±1e-6); `pos` at `progress = 0` is `SPAWN_DISTANCE` from target |
| Timing buckets | `e = ±59 → perfect`, `±61 → great`, `±121 → good`, `±201 → outside zone` |
| Palm sphere test | Unscaled helper and runtime-scaled square/radius boundaries flip correctly at ± ε, including rounded corners |
| Swept palm | Crossings test the square plus circular palm tolerance; scaled gameplay uses `HIT_ZONE_SCALE` for both, without a false expanded-square corner hit |
| Blade sweep | A blade of 1.2 m rotating 40° between frames across a block registers |
| Moving-hand eligibility | Each of `open`, `fist`, `point`, `none` hits slash/smash at `CONTACT_MIN_SPEED`; below the floor is ignored; no wrong-shape Bad Cut |
| Beam | Full-charge confident Point fires at the next spawned unresolved target without fingertip aim; outside timing buckets is Good; locks/recharge follow a committed shot |
| Precharged beam | First spawned candidate fires once; two charged hands cannot destroy the same target twice; no candidate means charge waits |
| Obstacles | `wallLeft` with `lean='right'` → dodged; unsafe body after grace → one capped point penalty with combo preserved; absent body → no hit, no wall pause, no reward |
| Combo ladder | combos 4,5,14,15,29,30 → multipliers 1,2,2,4,4,8 |
| maxScore | hand-computed for a 40-note, 2-obstacle map |
| Accuracy | All-Perfect short map with an early wall reaches 1; combo resets do not change base points already earned; empty map rejected |
| Late sample | In-window capture delivered after visual window still hits within age cap; over-age/out-of-order sample rejected; terminal note never reopens |
| Render independence | Same fixture at 30/60/120 Hz and with a render hitch yields identical ordered judgement events and final stats |
| Sweep time | Contact fraction determines timing bucket; clip a crossing sweep to the eligibility interval; no sweep across reacquisition |
| Kinetic | synthetic 4 m/s peak → 20 J; two peaks 100 ms apart count once |
| Cut plane | horizontal swing → normal ≈ (0, ±1, 0) within 6°; vertical swing → normal ≈ (±1, 0, 0); in all cases assert `|normal · swingDir| < 1e-6` and `|normal · laneDir| < 1e-6` |

## 15. Acceptance criteria

- [ ] P4 playtests record first-time and practiced players' accuracy separately, with sample size and configuration. Initial usability goals are ≥ 60% and ≥ 85% respectively; a miss can indicate chart reachability, unclear feedback, tracking or sync, so investigate those causes before widening timing windows.
- [ ] Judgement distribution on a deliberately on-beat test (metronome track, hits synced to a click) is centred on Perfect with `inputOffsetMs = 0` ± 30; otherwise record the bias and set `INPUT_OFFSET_DEFAULT_MS`.
- [ ] No slash/smash hit is registered outside `WINDOW_GOOD_MS · WINDOW_SCALE`; no block is destroyed twice; no current slash/smash contact produces a wrong-shape Bad Cut. Beam timing follows its explicit auto-target exception.
- [ ] Fast slashes (> 8 m/s play-plane) never tunnel through blocks (verified with the debug overlay drawing swept segments).
- [ ] Walls are dodgeable by leaning with hysteresis: no flicker between hit/dodged; grace period hides tracking latency.
- [ ] Point/hold reliably charges and fires at the next spawned unresolved beam target; no precision aim is required. Input replay proves one terminal hit per target, normal in-window timing and the out-of-window Good fallback, with refire/recharge guards.
- [ ] `maxScore` ceiling, unmultiplied accuracy and rank agree with hand calculations on short/long maps, early walls, ties, misses and bad cuts.
- [ ] All unit tests in §14 pass; `game/` has no DOM or `three` imports.

## Constants required

All constants used here are in the [02 constants table](02-architecture.md#constants), including `HIT_ZONE_SCALE`, `CONTACT_MIN_SPEED`, `APPROACH_SLOWDOWN`, `OBSTACLE_GRACE_MS` (§9 rule 4), `SCORE_WALL_PENALTY` (§9 rule 1), `BEAM_REFIRE_LOCK_MS` (§8 step 5), `SWING_MIN_SPEED` / `TORSO_SWING_MIN_SPEED` (§11), `HIGHLIGHT_DEBOUNCE_MS` and `HIGHLIGHT_MIN_COMBO` (§12), and `WINDOW_SCALE` (a multiplier applied to all `WINDOW_*_MS`, default 1.0; see [21 R09](21-risks-and-fallbacks.md)).
