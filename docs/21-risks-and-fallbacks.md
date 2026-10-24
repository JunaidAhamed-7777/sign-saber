# 21 — Risks & Fallbacks

Each risk has an observable trigger, a decision gate and a fallback that preserves an honest demo. Gates refer to capabilities in [ROADMAP.md](../ROADMAP.md), not a timetable inherited from another event. Assign a named owner when a task starts; no fixed team size or permanent folder ownership is assumed.

A fallback that changes the promised product updates the relevant spec, README and release evidence in the same commit. It is a scope decision, not a hidden implementation shortcut. Performance and quality failures follow [24](24-benchmark-and-evidence.md).

## Risk register

| ID | Risk and trigger | Decision gate | Response / evidence required |
| --- | --- | --- | --- |
| R01 | Network unavailable; dependencies/assets cannot load | P0 foundation, repeat P5 | Install dependencies and fetch/version local WASM/models/fonts/tracks in advance. Test a production build served locally with networking disabled; cold browser caches must still work. This does not promise direct `file://` launch or offline installation. |
| R02 | Backlight/dim light breaks calibration or hand confidence | P1 first playable | Coach framing/lighting, move the table, add a lamp. Contrast affects appearance, not model confidence. Publish the tested lighting envelope and pause safely when reliability fails. |
| R03 | Render delivery or tracking freshness misses its gate | P1 baseline, P4 proof | Diagnose CPU/GPU/inference contention, then apply cosmetic tiers. Record actual dimensions and downgrades. Never report a lower-tier run as high-tier evidence. |
| R04 | GPU delegate/worker/callback-mask path fails on target browser | P0 runtime spike | Retry a measured worker CPU path; report delegate and cadence. A main-thread inference route is a separately benchmarked fallback, not assumed playable because it initialises. If neither meets a declared minimum, narrow browser/device support before building spectacle. |
| R05 | Segmentation is noisy, unstable or too expensive | P1 visible player | Tune documented mask processing; degrade to a clearly labelled glowing skeleton/body outline if needed. Additional segmentation models are POLISH only after P2 and require a new latency/memory measurement. Never invent an unmeasured +5 ms cost. |
| R06 | Hand identity flips during crossing | P1 gesture drill | Match to pose wrists with temporal continuity, reject ambiguous candidates, and test crossing/occlusion. X position alone cannot establish identity. Either hand may hit a compatible block. |
| R07 | Hands disappear or become edge-on mid-swing | P1/P2 | Use confidence/hysteresis for presentation; stop judgement from stale/ambiguous data. Visual extrapolation must not score predicted contacts. Clear motion history on reacquisition to avoid a phantom swing. |
| R08 | Another person's hands enter the frame | P2 live trial | Reject wrist/body mismatches and coach one player at a time; pause on ambiguity. `numPoses: 1` and `numHands: 2` do not solve identity. Record remaining limitations, do not claim multi-person isolation without a test. |
| R09 | Players report late/unfair judgements; pipeline age grows | P1 latency baseline | Drop stale work, reduce inference/mask cadence where justified, and calibrate the explicit input offset. Keep timing windows unchanged across cosmetic tiers. Wider windows require a named gameplay preset, new fixtures and honest comparison; they are not a latency fix. |
| R10 | Tempo/beat accuracy fails held-out clips or octave tests | P2 generator gate | Use labelled onset-only mode only when actual onset evidence is playable; otherwise report unsuitable audio. Bundled maps can be reviewed by hand with provenance. Do not tune on the held-out set or pretend a warning establishes quality. |
| R11 | Three-minute file-to-ready time exceeds target | P2 baseline, P4 optimisation | Profile read/hash, decode, analysis, assignment, validation and storage independently. Stream/reuse DSP scratch and cache analysis. Lower-resolution analysis changes `GENERATOR_VERSION` and reruns quality evaluation; a progress bar does not make a missed target pass. |
| R12 | Audio is blocked, suspended or interrupted | P1 first sound | Unlock from a user action, check context state, keep visual/song clocks paused until scheduling succeeds, and show an enable-sound/retry control. Test background/foreground and output-device changes. |
| R13 | Corrupt/unsupported/huge audio or decode memory pressure | P2 input gate | Enforce byte, duration and decoded-PCM admission limits from [08](08-beatmap-generation.md). Catch decode/worker failure, release intermediates and retain a usable SELECT screen. Codec support is browser-specific; extensions do not prove decodability. |
| R14 | YouTube companion/tool/network failure | Optional after P2 | Disable that path and offer upload/bundled tracks. The core never depends on it. Use only content with appropriate rights and follow platform terms; see [23](23-youtube-companion-service.md). |
| R15 | Plane cuts have holes, NaNs or degenerate caps | P3 spectacle gate | Use deterministic pre-cut half pairs nearest the swing direction. Describe the result as approximate slicing in README/demo copy; never retain the exact-plane claim. Judgement remains unchanged. |
| R16 | Blender/MCP unavailable or asset export fails | P3 | Use validated procedural primitive geometry and documented fallback glyphs/shards from [18](18-blender-mcp-asset-pipeline.md). Preserve origin/pivot/material contracts and benchmark the actual fallback. The game must not require Blender at runtime. |
| R17 | Bloom/HDR/overdraw is too expensive or unsupported | P1 probe, P4 | Lower resolution/mips through quality presets, or disable bloom and use simple emissive/additive cues. Validate target completeness; preserve readable glyphs and silhouette without HDR. |
| R18 | Contributor becomes unavailable or a task stalls | Every milestone | Commit a coherent change or honest WIP, record current state, commands/results and next action. Reassign by capability; a handoff does not require a rigid four-track schedule. Do not send external messages without the user's authorisation. |
| R19 | New ideas displace the playable/evidence path | After each gate | CORE through P2, POLISH after P2, STRETCH after P4. P5 is scope-locked; only release-blocking fixes reopen work. A new feature needs explicit acceptance criteria and a costed place in the roadmap. |
| R20 | Camera/audio/browser fails during judging | P5 rehearsal | Follow [20 failure drills](20-demo-and-judging.md#failure-drills), keep a local bundled-track path and a labelled recording of the tested build. Say when a recording replaces a live run. |
| R21 | Concurrent edits conflict in contracts/shared files | Every change | Agree file/task ownership for the current change, inspect status and coordinate shared contracts before editing. Small commits, fetch before integration, preserve unrelated edits/history, never force-push. Fixed old track folders do not restrict the new plan. |
| R22 | Browser/OS update, permission reset or notification changes behaviour | P5 rehearsal | Rehearse the exact browser build/origin and record it. Revalidate after updates; avoid late environment changes rather than prescribing unsupported update-disabling tricks. Suppress notifications and verify permissions on the actual demo origin. |
| R23 | Battery saver, unplugging or heat throttles the device | P4 soak / P5 | Test on mains with declared power mode, allow ventilation and retain thermal results. Include battery results separately if claiming battery play. Bring the required charger. |
| R24 | Evidence cannot be matched to source/time | Every evidence run | Record full SHA, dirty flag, input hashes and real timezone-stamped date. UTC is valid; a different display timezone is not a bad clock. Never backdate or invent results. |
| R25 | Bitmaps, masks, buffers, audio nodes or GPU resources leak | P1 lifecycle / P4 soak | Close resources on success/error/cancel, return transfer ownership correctly, stop old audio/media and dispose render targets. Compare retained counts across ten retries and a soak. The telemetry buffer itself must be bounded. |
| R26 | Valid intended swings are missed or double-counted | P1/P2 trials | Inspect capture-time measured segments and swept intersections; test dropped frames, stale arrivals and boundary times. Use labelled fixtures plus at least three players. Tune named thresholds centrally, rerun evidence, and report the weakest player/class. |

## Fallback ladders

Best → acceptable → reduced-scope release. Any reduction below CORE must be explicitly declared in README, demo and acceptance results; an impressive reduced demo is not evidence that the complete specification shipped.

- **Tracking:** worker GPU → measured worker CPU → supported-device-only release. A main-thread path must independently pass before being offered.
- **Player presence:** segmented neon silhouette with skeleton → segmented silhouette only → clearly described skeleton/body outline.
- **Maps:** onset+beat tracking+sections → labelled, validated onset-only maps → bundled reviewed maps with upload disabled and generation claims removed.
- **Slash:** tested exact cut → deterministic approximate halves → simple flash/fade with the claim reduced.
- **Smash:** validated authored shards → procedural shard set → bounded flash/debris pool.
- **Post FX:** tiered bloom/accents → low-cost bloom → emissive geometry and additive sprites. Score and timing never change.
- **Results:** stats plus 2.5D mask/pose highlight → stats plus static pose → accurate stats. Motion-energy estimates remain optional and labelled approximate.
- **Song input:** bundled+upload+optional companion → bundled+upload → bundled only with limitations declared.

## Cut order and stop conditions

If P2 is incomplete, stop work on the companion, extra assets, skeleton overlay, chromatic aberration and highlight turntable. Fix one complete bundled/upload-to-results path before decorating disconnected subsystems. Keep glyph readability, confidence-aware input, feedback, safe pause/retry and accurate score ahead of visual density.

If P3 spectacle misses the performance gate, reduce effect count/resolution and use tested geometry fallbacks. Preserve the one unmistakable beat-synchronised moment: readable intent, immediate hit feedback, physical destruction and a visible player response. Do not silently remove beam/lean or upload from a CORE claim; make a documented scope decision and adjust the demo.

At P5, stop adding features. Fix crashes, softlocks, wrong judgements/scores, privacy/resource faults, accessibility regressions and failed release gates. Re-run affected proof. Optional unmeasured features stay out of the demo.

## Decision log template

Use the real timestamp, not the illustrative value below, and commit the record with the change:

```text
## <actual ISO timestamp with timezone> — Fallback triggered: <risk ID and decision>

- Risk: <ID and failing capability/gate>.
- Signal: <observed failure and linked evidence; no invented count>.
- Decision: <fallback rung and resulting product claim>.
- Changed: <files/features and README/spec updates>.
- Validation: <commands/trials actually run, outcomes and remaining failures>.
- Revisit: <specific passing evidence needed, or deferred beyond this release>.
```

## Acceptance criteria

- [ ] Every triggered risk has a dated decision and evidence; unresolved ones have a named owner and next gate.
- [ ] Fallback gameplay/visual claims agree with the shipped implementation and demo narration.
- [ ] No performance fix secretly changes scoring, and no optional network/tool path blocks bundled play.
- [ ] Actual event rules, deadlines and team constraints are recorded only after confirmation from organisers.
