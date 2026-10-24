# 20 — Demo & Judging

**Lead with the person, prove the interaction, then earn the numbers.** The demo is a rehearsed product experience, not a tour of the code. This plan is for the future P5 release; there is no playable demo or recording yet. Follow the [roadmap](../ROADMAP.md) before claiming any step works.

The actual event's slot length and rubric have not been supplied. The three-minute version below is a rehearsal target. Adapt it to confirmed rules rather than inventing category weights or submission requirements.

## The promise

**One sentence:** “Sign Saber turns a webcam into a rhythm arena. Your hands are the weapons, and your music builds the level.”

Three points, each backed by something the audience sees:

1. **Your body is the controller.** A figure-centred menu → open-palm pointer/point-click selection → live silhouette → slice/smash/beam/lean.
2. **The music creates the challenge.** Analyze a supported local file outside the bundled library, display actual readiness time, then play its generated section.
3. **The engineering is inspectable.** Show two measured results from the tested build with hardware/configuration and an evidence link. If those measurements do not exist, describe the design and say they are unmeasured.

Never promise “any song,” universal tracking, exact calories, true 3D reconstruction or a measured latency that has only been estimated in software.

## Prepare one coherent showcase

Package all three full [starter songs](../app/public/assets/tracks/README.md) by P2, then create a separately credited **45-second demo excerpt** during P3, before the P4 benchmark matrix; none is installed yet. Generate/validate from that exact edited audio. Choose an excerpt/seed that exposes Slash, Smash, Beam, a readable wall and a drop; adapt the script to the valid map. Retain audio/map hashes and seed. Rehearse/record the actual candidate during P5.

The first run must finish to real RESULTS. Do not switch an unfinished session to an unrelated screenshot or imply a prerecorded result came from the live play. If a hand-edited map is ever used, label it as such and demonstrate unedited generation separately.

Also prepare a different supported upload file with redistribution permission, an uncached analysis path, an evidence report from the actual release candidate and a clearly labelled fallback recording. Track titles, artists, durations and measured times come from these real artifacts; none is invented here.

## Three-minute script

One presenter can drive and speak; a second person can narrate while the first plays. Practise both roles. Keep silence around the best visual moments.

- **0:00–0:12 — The reveal.** For the short slot, complete real setup before the timed run, then use an open palm and point to select a starter song beside the live central figure. Say: “My hand chooses the music. My body plays it.” Demonstrate the unconfigured placeholder/**Set up camera** path separately or in a longer slot; never imply a prerecorded setup or calibrated figure is the first permission grant.
- **0:12–0:22 — The premise.** Deliver the one-sentence promise. Keep the screen visible; do not open architecture slides over the player.
- **0:22–0:35 — Calibration.** Start the demo excerpt, confirm comfortable tracking/reach, wave and count in. Describe only what the audience can see. The rehearsal must establish whether this timing is feasible.
- **0:35–1:20 — A complete 45-second run.** Say “Open hand slices,” then let the real cut be visible. Explain fist, charged point and lean when those objects appear. Stop talking for the drop. Keep the demo map easy enough to complete reliably. Demonstrate a deliberate Bad Cut only if rehearsed and it does not obscure the hero moment.
- **1:20–1:35 — A genuine ending.** Show this run's accuracy, combo and captured 2.5D highlight. Call motion energy an approximate game metric if mentioned at all. Do not call it measured exertion.
- **1:35–1:55 — A new song.** Return to SELECT and upload the prepared non-library file. Show real stage progress and the actual file-to-ready time. Say “This file was analyzed here”; distinguish a fresh analysis from a cache hit. If still busy at the segment boundary, use the recovery rule below.
- **1:55–2:15 — Play the generated map.** Start the new file and let an audible section demonstrate alignment. Explain that quiet passages do not become arbitrary targets. Do not claim a genre-wide quality result from one clip.
- **2:15–2:25 — Exit cleanly.** Pause and quit through the real controls. An incomplete second run remains incomplete; the earlier results were from the completed demo excerpt.
- **2:25–2:45 — Evidence, briefly.** Show the release evidence card: device, effective resolution/tier, frame-interval p95, tracking-age p95, generation time and held-out beat F1 where actually measured. Speak only the two strongest relevant values and link the raw report for questions.
- **2:45–3:00 — Invite play.** “Your body is the controller. Want to try?” Offer an Easy excerpt if the slot and judge allow it.

**Rehearsal gate:** three timed end-to-end runs; the final run fits the actual slot. If calibration or analysis does not fit, shorten narration or the second play segment. Do not speed up footage, hide waiting or replace the current session with a different result.

For a longer slot, extend judge play and questions. For a shorter slot, preserve silhouette → live cut → actual result, then give the upload/evidence proof concisely.

## Judge-plays protocol

1. Invite participation rather than assuming it. Ask the person to stand where they are comfortable and can see the screen; a floor mark is guidance, not a required body position.
2. Confirm clear space, front lighting and arms/hands in frame. Offer lower intensity/reduced motion before the demonstration, and avoid full-force punches or large leans.
3. Use Easy: “Swipe open-handed for this glyph; fist for this one; hold a point for the beam; lean away from the wall.” Demonstrate with the actual on-screen shapes, not colour alone.
4. Run calibration for that person. Do not reuse the presenter's shoulder/reach values or promise they can play in ten seconds before testing it.
5. Let the person play a short excerpt. Stop if tracking or comfort is poor; do not ask them to swing harder to overcome bad calibration.
6. Record usability observations only with consent. No raw camera recording is needed to let someone try the game.

## Stage and pre-demo setup

Choose a screen height and camera angle that frame comfortable movement. Use a plain static background and even front light; leave adequate uncluttered space. Test text/glyph readability from the actual playing and judging positions. Use mains power and the measured power mode; choose speakers or a tested low-latency output rather than assuming Bluetooth timing matches wired audio.

Before the slot:

- [ ] Serve the tested production build: from `app/`, run `npm run build` then `npm run preview`; open [localhost:4173](http://localhost:4173). The current scaffold is not demo-ready.
- [ ] Confirm the actual candidate SHA, asset hashes, camera and audio output match the rehearsal record.
- [ ] Disable external network, reload and complete the offline path. A local server and prepared model/music assets remain available.
- [ ] Confirm hardware acceleration, viewport/DPR, browser zoom, display refresh and chosen tier; no experimental browser flags.
- [ ] Close unrelated workloads, mute notifications and prevent sleep. Recheck thermal state; do not quote a cold benchmark during a throttled live session.
- [ ] Unlock Web Audio through an explicit click; check volume from the audience position. Countdowns and real playback must both be audible.
- [ ] Calibrate the presenter, test every showcased gesture and check fresh tracking in the overlay, then hide the diagnostics.
- [ ] Exercise the camera-free placeholder/**Set up camera** path before the slot, then prepare actual valid setup for the short live reveal. Confirm all three full songs are present; reset to SELECT with the demo excerpt available and verify open-palm/point selection without covering the figure. Declare cache state for the separate upload proof.
- [ ] Verify fallback video playback and the evidence report with network disabled; keep an accessible local copy on a second device if available.
- [ ] Confirm stage/recording permission and the actual slot length.

## Failure drills

Practise each relevant drill before P5. Use one short explanation and one recovery attempt; do not consume the slot debugging.

- **Camera denied/busy:** say “The camera needs permission.” Use the browser permission/device setting and Retry. If another app owns it, close that app. If it still fails, use the labelled recording.
- **Poor tracking:** say “Let's adjust the framing.” Improve front lighting and distance, remove other people from view, then recalibrate. High-contrast rendering can make the outline easier to see; it does not repair inference or prove the room is too dark.
- **Wrong hand identity/gesture:** show both palms and run the calibration identity check. Do not claim the model automatically fixes labels within a second. If the gesture remains unreliable, disclose the failure and switch to the verified demonstration.
- **Tracking loss:** show the real auto-pause, reacquire, explicitly resume and count in. The game must not consume notes during this recovery.
- **No sound:** click the explicit audio control and check output/volume; inspect whether the context is suspended. A moving progress bar does not prove sound is reaching the speakers.
- **Slow/failed upload:** after the rehearsed time budget, cancel and return to a bundled track. Say the new file did not become ready in time; retain the failure in the evidence record. Do not quote the target time as the result.
- **Stutter:** use the implemented quality control or diagnostic key to lower the tier, then disclose that change. Do not describe the new run as high quality or cite a previous fixed-tier result as current telemetry.
- **Companion unavailable:** skip it. The local upload and bundled tracks are the core path. Never install/start an untested optional service during judging.
- **Crash/context loss:** retry/reload once through the documented recovery. Do not promise a four-second restart before measuring it. If recovery fails, show the recording.
- **The single recovery attempt fails:** stop troubleshooting and say “This is a recording of the tested build.” Play the fallback and narrate what it demonstrates and what failed live.

## Fallback recording and evidence card

Record the actual release candidate after P3/P4, at the disclosed capture settings: a few seconds of silhouette, readable gesture payoffs, a drop and genuine results. Keep a short playable version locally and a backup on another device. Obtain consent for identifiable people; keep raw footage private unless distribution is authorized.

Overlay or announce **RECORDED**, **REPLAY** or **LIVE** accurately. A render-stress capture can illustrate effects, but cannot prove live tracking. Video capture changes workload: performance numbers come from separate protocol runs with capture overhead disclosed.

The evidence card links `docs/evidence/<run-id>/report.md` once it exists, as described in [24](24-benchmark-and-evidence.md). Include candidate SHA, date, hardware, effective framebuffer dimensions, tier, sample counts, measured results and failures. Until collected, values read **unmeasured**; no mock benchmark output belongs in the submission.

## Answers worth preparing

- **Latency?** Separate tracking age, clock mapping and externally measured motion-to-photon. Quote the actual tested distribution or say external latency has not been measured.
- **Why a worker?** MediaPipe's inference call is synchronous; isolating it keeps rendering schedulable. The bounded pipeline drops capture opportunities instead of accumulating stale hands. See [Google's guide](https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js).
- **Why geometric gestures?** Three classes are directly inspectable and testable from landmarks. Pointing toward the camera can be ambiguous; report the measured class errors rather than claiming universal recognition.
- **Why your own DSP?** It gives explicit onset, beat, silence and playability rules. Point to the holdout evaluation and known failures; algorithm complexity is not evidence of musical quality.
- **Is it fully offline?** A prepared locally served build and bundled tracks are the required offline path. Initial dependency/model downloads need network; the optional YouTube service needs network; first-visit offline installation is not implemented.
- **Is that a 3D scan or a fitness reading?** No: a 2.5D mask/pose composition and an approximate game motion metric. These boundaries are deliberate.
- **What did AI contribute?** Describe the actual contributions in [AI_USAGE.md](../AI_USAGE.md). Do not use a canned claim that only boilerplate was assisted or that every design decision was human-authored.
- **What fails?** Name the observed lighting/occlusion cases, low-confidence music, unsupported devices and unmeasured areas from this build. Do not blame clothing or a player's movement without evidence.

## What to submit when the actual rules are known

Use the organizers' required channel and assets. The useful evidence set is a real demo link/recording, tested release SHA, reproducible run steps, credits, actual QA/benchmark report and known limitations. No imaginary rubric scores or missing results are filled in for appearance.

## Acceptance

- [ ] The live script fits the actual slot in three consecutive rehearsals.
- [ ] The first run finishes to its own genuine results; upload generation is distinct from a cache hit.
- [ ] Every spoken number is supported by the cited candidate's evidence or explicitly described as a target.
- [ ] Every relevant failure drill has been exercised and the fallback recording plays offline.
- [ ] A new person can understand the gestures, calibrate comfortably and try the game with clear consent.
