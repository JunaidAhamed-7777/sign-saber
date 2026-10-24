# 01 — Vision & Pillars

## One-sentence pitch

**Sign Saber turns a webcam into a rhythm arena: fight the music with your bare hands while a neon reflection of your body moves with you.**

This is the product specification, not an implemented-feature list. Build status lives in the [README](../README.md); implementation order and evidence gates live in [ROADMAP.md](../ROADMAP.md).

## The player fantasy

A glowing outline follows the player inside a dark, receding grid. An open-hand swing draws a blade of light and splits a block along the swing plane. A fist releases a burst of armoured shards. A held point builds charge, then fires a beam. A wall invites a clear lean to safety. The next drop changes the arena's intensity while the notes remain easy to read.

The music should explain the level: a quiet intro leaves breathing room, strong transients produce deliberate actions, and a drop earns its visual release. Results celebrate actual accuracy and a saved **2.5D** silhouette/skeleton moment. No reconstructed volumetric body or measured calorie expenditure is promised.

## Why a judge should remember it

1. **A visible human connection.** The first reveal is the presenter's movement mirrored in light. A spectator understands the input without a diagram.
2. **One unmistakable interaction.** A real swing produces a matching geometric cut. Establish this before adding more mechanics or effects.
3. **Three distinct payoffs.** Slice, smash and beam have different anticipation, gesture and destruction. Leaning adds whole-body involvement without a headset.
4. **A song that was not in the library.** Analyze a supported local file live, show the measured analysis time, then play the generated section. Unsupported or low-confidence material gets an honest explanation.
5. **Proof behind the spectacle.** Reproducible input replays, frame-time percentiles, live-camera checks and offline rehearsal make the engineering story inspectable. Never substitute targets for measurements.

The actual event rubric is unknown. These are product priorities, not invented judge weights or a promise of winning.

## Design pillars

In a conflict, the earlier pillar wins.

1. **Readable before spectacular.** Shape, glyph and motion explain each action; colour reinforces them. Notes, timing and safe lanes stay readable through the heaviest drop and in low quality.
2. **Forgiving input, honest scoring.** Calibration fits the player; hysteresis handles uncertain gestures; capture-time inputs determine judgement. Predicted visual cursors never create hits.
3. **Every valid action earns a clear response.** Anticipation, contact, sound, destruction and score agree about what happened. Wrong actions and lost tracking are explained rather than hidden.
4. **The music authors the rhythm.** Keep evidence-backed onsets, meaningful quiet passages and reachable transitions. Fixed seeds make assignment reproducible; playable maps matter more than a superficially correct BPM.
5. **Performance is experienced and measured.** Averages cannot excuse stutters, stale tracking or thermal collapse. Use [24](24-benchmark-and-evidence.md) for the controlled targets and [16](16-performance-budget.md) for resource budgets.
6. **A recoverable, comfortable session.** Permission failures, camera loss, unsupported files and absent network have useful paths. Reduced motion affects the scene as well as the DOM. Never ask for a bigger swing or deeper lean merely to satisfy a score.

## What done looks like (definition of the shipped product)

These are `[CORE]` release requirements. P1 proves a smaller vertical slice; P2 completes the mechanics; P3 realizes the signature presentation; P4/P5 supply performance and release evidence. See the [roadmap](../ROADMAP.md) for the exact gates.

### Flow

- BOOT detects shell/rendering capabilities and loads the local catalog with real progress. SELECT opens without camera setup; tracking assets initialize in the explicit setup flow. Raw webcam pixels are not displayed in the shipped scene.
- SELECT ships with at least three distinct full-length attributed starter songs and pre-generated Easy/Normal/Hard maps, plus optional local upload. A new player needs no upload/network to choose music. MP3/WAV/OGG/M4A are candidate upload extensions; actual decoding and limits determine support.
- The menu reserves its centre for the human figure, with library/actions in side rails. Mouse, keyboard and open-palm movement → point-click operate the same app-owned controls. Hand navigation is CORE; hovering alone never clicks. [25](25-menu-and-hand-navigation.md) defines the interaction and exceptions for native browser actions.
- Before current camera setup/calibration succeeds, the central figure is a clearly illustrative placeholder with **Set up camera**. Browsing remains usable by mouse/keyboard. Setup works without a selected song, shows a labelled live positioning preview and replaces the browse placeholder only after valid calibration; it never invents tracking evidence.
- CALIBRATION confirms visible shoulders and hands, comfortable reach, mirror identity and wave or accessible button/key confirmation before the countdown. It coaches the player without claiming to diagnose low light from landmark confidence alone.
- PLAYING reaches the real end of the selected track. Losing usable tracking for `TRACKING_LOST_PAUSE_MS` auto-pauses; stable reacquisition may start the tracking-loss resume countdown. Manual/hidden-tab pauses require an explicit resume, and no scoring occurs during any countdown.
- PAUSED supports resume and quit with complete cleanup; RESULTS supports retry. Returning to SELECT never leaves old workers, sound sources, notes or score events alive.
- RESULTS uses the completed session: score, unmultiplied accuracy, rank, max combo and judgement counts. A motion-energy estimate is labelled approximate; a saved 2.5D highlight uses owned snapshot data.

### Gameplay

- Slash requires an open hand with the defined motion; Smash requires a fist; Beam requires a stable point and `BEAM_CHARGE_MS` charge. Targets have redundant glyphs and silhouettes.
- A wrong-gesture contact yields a Bad Cut with no score and combo reset. Every note has exactly one terminal judgement, including late-arriving valid samples and misses.
- Left/right walls use calibrated torso lean. Each wall has one dodge/hit outcome; maps never require a simultaneous note in an unreachable safe area.
- Timing windows, multiplier ladder and accuracy follow [07](07-hit-detection-and-scoring.md). A flawless Perfect run reaches 100% accuracy regardless of wall position or multiplier ramp.
- The same input fixture, map, seed and version produce identical ordered score events under different render cadences. Actual camera usability is checked separately.

### Signature presentation

- A neon silhouette follows the pose segmentation mask with music-reactive edge colour. A labelled skeleton fallback is available if segmentation is unsupported; do not claim the fallback is the mask.
- Slash uses real convex plane clipping; Smash uses bounded ballistic shards; Beam uses charge, impact and power-down poof. Procedural geometry keeps gameplay available before optional Blender assets exist.
- Idle hand particles become a readable blade trail at speed. Effects never hide the target glyph or the safe side of a wall.
- The reactive grid, fog, restrained bloom and drop response form one coherent arena. Quality tiers and reduced motion preserve gameplay information.
- Results preserve a genuinely captured silhouette/skeleton moment. A flat mask is not a 3D scan; camera motion stays within the documented 2.5D presentation limits.

### Technical and evidence

- The controlled 60 Hz reference scenario targets smooth 60 FPS presentation with a sustained 40 FPS degradation floor, fresh ≥24 Hz tracking and bounded capture-to-consumption age. Exact percentile gates, runs and hardware metadata are defined once in [24](24-benchmark-and-evidence.md). None is measured yet.
- Three-minute supported-track analysis targets less than four seconds on the reference laptop. Report decode, hash, DSP, assignment and total readiness separately; a warm cache hit cannot stand in for cold generation.
- The map passes schema, silence, reachability, gesture-switch and timing checks. Beat quality is evaluated on disclosed holdout clips, including difficult material and silence.
- A locally served production build boots, calibrates, plays bundled tracks and reaches results with external network disabled after asset preparation. Static hosting still requires HTTPS for camera access; no service-worker installability claim is implied.
- The release has actual assertions, clean-clone instructions, a consented live-camera QA record, benchmark artifacts and a recorded demo. Passing the current stubs meets none of these requirements.

## Scope boundaries

`[POLISH]`, after P2: optional YouTube companion, richer skeleton treatment, combo celebrations, results turntable and restrained chromatic accents. These may ship only if they preserve the core evidence gates.

`[STRETCH]`, after P4: directional slashes, duck obstacles, alternate capture APIs and a richer shareable replay. Adopt a third-party DSP fallback only after evaluating its package/model licenses, worker compatibility and the same holdout corpus.

Outside this release: multiplayer, accounts, leaderboards, cloud inference, mobile support, a beatmap editor, true body reconstruction and fitness/medical claims. There is no promise that every arbitrary song produces a good map; low-confidence input may use a disclosed onset-only mode or be rejected.

## Target environment and human check

Target a desktop laptop with WebGL2, a current supported Chrome/Edge build and a 30 Hz webcam. The reference integrated-GPU machine, OS, browser version, capture resolution, effective render resolution, DPR and quality tier are selected and recorded during P0, then held fixed for comparisons. A named GPU class alone is not a benchmark configuration.

Use even front lighting and enough uncluttered space for comfortable arm movement. The suggested 1.5–2.5 m camera distance is setup guidance, not a universal body/reach assumption. Calibration adjusts for the player; if the full-body path cannot be used comfortably, explain the limit rather than presenting an untested accessibility mode as implemented.

At least three consenting first-time players should complete calibration and an Easy excerpt without a developer explaining every target. Record time to first successful hit, confusion, false Bad Cuts, tracking loss and comfort. This small usability check is evidence about the tested people and room, not a population-wide accuracy claim.
