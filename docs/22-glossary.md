# 22 — Glossary

| Term | Meaning |
| --- | --- |
| **Approach time** (`approachMs`) | Time a note takes to travel from spawn to the hit plane. Per difficulty. |
| **Attract scene** | The idle 3D scene (grid, fog, live silhouette, no blocks) shown behind Song Select. |
| **Bad Cut** | Contact with a block using the wrong gesture (e.g. open palm on an Armored block). Resets combo, no score, block deflects. |
| **Band energies** | Smoothed 0..1 energy of the low / mid / high frequency bands of the currently playing audio, read every frame for reactive visuals. |
| **Beam** | The pointing-finger laser. Hold a point gesture for `BEAM_CHARGE_MS` to charge; fires at the hovering Beam target under the fingertip ray. |
| **Beam target** | A distant block type (gold) that hovers at `BEAM_HOVER_Z` and can only be popped by the beam. |
| **Beat grid** | `beatOffsetMs + k · 60000 / bpm`. Used for snapping and pulses; gameplay uses explicit note times. |
| **Beatmap** | The `BeatmapV1` JSON describing notes, obstacles and music events for one song and one difficulty. |
| **Blade** | The katana-like glowing ribbon that replaces the orbiting hand particles when an open hand moves faster than `BLADE_ON_SPEED`. |
| **Body state** | Per-frame derived body information: lean, tilt, torso speed, presence. |
| **Calibration** | The pre-play state that confirms tracking and captures `BodyCalibration` (rest centre, shoulder width, head height). |
| **Cell** | A `(col, row)` position in the 4 × 3 lane grid on the play plane. |
| **Cursor** (`HandCursor`) | The game-side representation of one hand: position/velocity on the play plane, gesture, blade and charge state. |
| **Drop** | A music event where section energy jumps sharply after a build; triggers the heaviest camera/colour reaction. |
| **Hit plane** | The plane `z = 0` where notes are meant to be hit and where hand cursors live. |
| **Hit zone** | The range of note positions (expressed as a ±`WINDOW_GOOD_MS` timing window) in which contact counts. |
| **Image space / mirrored image space** | Normalised 0..1 camera coordinates, before / after the horizontal flip that makes the display a mirror. |
| **Judgement** | Perfect / Great / Good / Miss / Bad Cut. |
| **Kinetic energy** | Approximate game motion metric from tracked speeds and assumed masses; not measured mechanical work, metabolic energy or calories burned. |
| **Lane** | The inclined path (`LANE_PITCH_DEG`) along which notes approach, from `SPAWN_DISTANCE` away to the hit plane. |
| **Lean** | Horizontal displacement of the shoulder midpoint from its calibrated rest position, in shoulder-width units. The dodge input. |
| **Mask** (`MaskFrame`) | The per-pixel person-confidence image from the pose model's segmentation output, used by the silhouette shader. |
| **Music event** | Time-stamped `kick` / `drop` / `build` / `calm` marker produced by the generator and consumed by camera, environment and post FX. |
| **Note** | A hittable object in the beatmap: `slash`, `smash` or `beam` type. Rendered as a block. |
| **Obstacle** | A non-hittable object the body must avoid: `wallLeft`, `wallRight`, `bar` [STRETCH]. |
| **One Euro filter** | Adaptive low-pass filter for noisy tracked positions: smooth when slow, responsive when fast. |
| **Onset** | A detected sudden increase in spectral energy in one band; the raw material for notes. |
| **Play plane** | The world-space rectangle (`PLAY_W × PLAY_H` at `z = 0`) that the mirrored camera frame maps onto. |
| **Poof** | The beam destruction effect: emissive power-down, shrink, spark puff. |
| **Quality tier** | `high` / `medium` / `low` rendering preset chosen from a representative capability/workload probe; fixed for comparative benchmarks and logged when changed. |
| **Session stats** | The accumulated results of one play-through (`SessionStats`). |
| **Shatter** | The smash destruction effect: pre-fractured shards with ballistic motion. |
| **Silhouette** | The Tron-style rendering of the player: dark translucent fill with a glowing edge whose colour follows the music, drawn from the mask on the silhouette plane. |
| **Skeleton** | 2.5D glowing joints and bones from pose landmarks, drawn behind the silhouette to add depth. |
| **Slice** | The slash destruction effect: real plane-cut of the cube along the swing plane, two halves fall apart. |
| **Song time** | Milliseconds since the first audio sample, from the audio clock. All gameplay timing is in song time. |
| **Spawn** | The moment a note becomes live (`t − approachMs`). |
| **Tracking frame** | One worker result: hands, pose, mask, timestamps. |
| **Wave detector** | Calibration check: a hand's x reverses direction ≥ `WAVE_REVERSALS` times within `WAVE_WINDOW_MS`. |

## Build and measurement terms

- **Accuracy:** unmultiplied earned base points divided by possible base points, as defined in [07](07-hit-detection-and-scoring.md). It measures judgement quality independently of multiplier recovery.
- **Capture time:** the main-performance-domain timestamp associated with a camera/input sample; distinct from inference completion and consumption time. It is a browser pipeline timestamp, not direct measurement of physical motion onset.
- **Tracking age:** consumption time minus normalized capture time. A fast inference result can still be stale if it waited in a queue.
- **Capture watermark:** latest processed capture time used to finalize past judgements, bounded by the input-age deadline; detailed in [07](07-hit-detection-and-scoring.md).
- **Deterministic replay:** the same map, version, configuration and captured input sequence produce the same ordered game events despite a different render cadence. It does not test the live camera/model path.
- **2.5D highlight:** a saved flat mask plus pose/skeleton depth cues. It is not a reconstructed volumetric person.
- **Frame interval:** spacing between consecutive rAF callbacks; a pacing proxy distinct from CPU work, GPU execution and physical presentation time.
- **p95:** the nearest-rank 95th percentile under [24](24-benchmark-and-evidence.md). Include sample count, scope and repetitions; an isolated percentile without its configuration is not a supported claim.
- **Ablation:** a labelled diagnostic comparison with one mechanism disabled/changed to understand its cost or effect. It is not automatically the release configuration.
- **Evidence gate:** a roadmap phase completes only when its behavior and required checks are recorded, committed and reproducible. None of P0–P5 is complete in the current scaffold.
