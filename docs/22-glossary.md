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
| **Kinetic energy** | Playful physical estimate of mechanical work done by the player's arms and torso, from tracked speeds and assumed effective masses. |
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
| **Quality tier** | `high` / `medium` / `low` rendering preset chosen at boot from a frame-time probe. |
| **Session stats** | The accumulated results of one play-through (`SessionStats`). |
| **Shatter** | The smash destruction effect: pre-fractured shards with ballistic motion. |
| **Silhouette** | The Tron-style rendering of the player: dark translucent fill with a glowing edge whose colour follows the music, drawn from the mask on the silhouette plane. |
| **Skeleton** | 2.5D glowing joints and bones from pose landmarks, drawn behind the silhouette to add depth. |
| **Slice** | The slash destruction effect: real plane-cut of the cube along the swing plane, two halves fall apart. |
| **Song time** | Milliseconds since the first audio sample, from the audio clock. All gameplay timing is in song time. |
| **Spawn** | The moment a note becomes live (`t − approachMs`). |
| **Tracking frame** | One worker result: hands, pose, mask, timestamps. |
| **Wave detector** | Calibration check: a hand's x reverses direction ≥ `WAVE_REVERSALS` times within `WAVE_WINDOW_MS`. |
