# 01 — Vision & Pillars

## One-sentence pitch

**Sign Saber turns any webcam into a lightsaber dojo: stand up, pick any song, and fight the music with your bare hands while a neon reflection of your own body fights alongside you.**

## The player fantasy

The player is not holding a controller. They *are* the controller. When they step in front of the laptop, the raw webcam feed never appears; instead a glowing, pulsing silhouette of them materialises inside a dark infinite grid, edges shimmering with the colour of the music. When they raise an open hand, particles gather around their palm. When they swing, the particles snap into a katana-length blade of light and the block in front of them splits clean in two along the exact plane of their swing. When they punch with a fist, an armoured block explodes into a dozen tumbling shards. When they point and hold, a laser charges and pops a distant target with a satisfying *poof*. When a wall rushes in, they lean their whole body out of its way. The camera breathes with the beat, kicking and zooming on every drop.

After the song, they see their accuracy, how many joules of kinetic energy they actually spent, and a frozen 3D highlight of their silhouette at their best moment.

## Why this wins

Judges reward three things: **does it work**, **does it look incredible**, and **is it ambitious but believable**. Sign Saber is designed to score on all three at once:

1. **Instant "wow" in the first five seconds.** The silhouette shader is on screen before any gameplay starts. A person walking past the demo table sees a Tron-style ghost of the player mirroring their every move. That is the hook; everything else is proof.
2. **Physicality the judges can try themselves.** No pairing, no install, no controllers to hand over. A judge steps into the frame, waves, and is playing in ten seconds. Full-body dodging makes it visibly athletic.
3. **Real signal processing, not canned content.** Any song → a playable beatmap in under four seconds, with notes landing on real beats and real drums, not random noise. Judges can throw their own track at it.
4. **Three distinct gestures, three distinct destruction effects.** Slice (clean geometric cut along the swing plane), smash (physics shards), beam (power-down poof). Each is a separate, legible payoff. Variety is what makes it a game, not a tech demo.
5. **Engineering credibility.** Tracking in a Web Worker, 60 FPS target with a 40 FPS floor on an integrated GPU, a deterministic beatmap generator with tests, offline-capable asset bundle. The docs you are reading are part of the pitch.

## Design pillars

Every design decision is checked against these, in priority order. When two pillars conflict, the higher one wins.

| # | Pillar | What it means in practice |
| --- | --- | --- |
| P1 | **Readable at a glance** | A new player must know what to do with each block without being told. Colour, glyph and silhouette feedback carry the message. Never add visual noise that competes with the required gesture. |
| P2 | **Every input has a kinetic payoff** | Any hand movement produces visible light. Any hit produces a destruction animation, a sound, a score pop, and a camera reaction. Nothing the player does is silent. |
| P3 | **Forgiving input, honest scoring** | Webcam tracking is noisy and ~100 ms late. Timing windows and gesture hysteresis are generous; scoring still differentiates Perfect from Good so skill matters. |
| P4 | **The music is the author** | Beats, drops and breakdowns drive spawning, colour, camera and intensity. The generator only places notes on validated onsets. Silence produces nothing. |
| P5 | **60 FPS or it did not happen** | Visual richness is capped by the performance budget. A feature that drops the frame rate below the floor on the demo laptop is cut or tiered down, never shipped. |
| P6 | **Demo-proof** | Works offline, recovers from tracking loss, has bundled tracks with pre-generated beatmaps, degrades gracefully in bad lighting. |

## What "done" looks like (definition of the shipped product)

The following MUST all be true at submission. This list is the acceptance test for the whole project; [19 — Build Plan](19-build-plan.md) schedules it.

**Flow**
- The app boots in the browser, loads models with a progress indicator, and lands on Song Select.
- Song Select offers at least two bundled tracks with pre-generated beatmaps, an audio-file upload (MP3/WAV/OGG/M4A), and a YouTube URL field that works when the companion service is running and clearly says so when it is not.
- Calibration asks the player to step back until their shoulders and both hands are visible, then to wave; it confirms with a countdown and never lets a player start without tracking.
- Playing runs the full song; losing tracking for more than 1.5 s auto-pauses with an on-screen prompt; regaining tracking resumes after a 3-2-1 count.
- Results shows score, rank, accuracy, max combo, per-judgement counts, kinetic energy in kJ and kcal, and a 3D highlight pose of the silhouette captured at the peak-combo moment.

**Gameplay**
- Three block types, each destroyed only by its gesture: Slash (open palm, fast), Smash (fist), Beam (pointing, 500 ms charge).
- Wrong gesture on a block is a Bad Cut: block deflects, combo resets, no score.
- Wall obstacles that require leaning left or right; being inside a wall resets combo and triggers a screen glitch.
- Timing judgements Perfect / Great / Good / Miss with a Beat Saber-style multiplier ladder.

**Visuals**
- Silhouette rendered from the segmentation mask with a glowing edge whose colour follows bass / mid / treble energy; no raw webcam pixels are ever displayed in game.
- Blocks are translucent glass cubes with a glowing core glyph. Slash: real plane-cut into two halves that fall. Smash: pre-fractured shards with ballistic physics. Beam: emissive power-down and particle poof.
- Hands: orbiting particles when idle, katana blade ribbon when moving fast.
- Infinite grid void with fog; camera FOV punch and shake on drops.
- Bloom post-processing.

**Technical**
- ≥ 60 FPS typical and ≥ 40 FPS minimum on the demo laptop at 1080p with the quality tier auto-selected; tracking at ≥ 24 Hz.
- Beatmap generation of a 3-minute track completes in < 4 s and places notes only on validated onsets aligned to the tracked beat grid.
- All models, WASM, fonts and demo tracks load from the local bundle; the app runs with the network disconnected.

## Explicitly out of scope

- Multiplayer, accounts, leaderboards, cloud anything.
- Mobile browsers (tracking + rendering budget does not fit); the target is a laptop running Chrome/Edge.
- Hand-authored beatmaps and a map editor. The generator is the author (P4). The JSON format is editable by hand but no tooling is built for it.
- Directional (arrow) slashes. Blocks accept any slash direction in v1; the format reserves a field for it.

## Target hardware and environment

| Item | Target | Minimum |
| --- | --- | --- |
| Browser | Chrome 130+ / Edge 130+ | Chrome 120 |
| GPU | Apple M-series or discrete laptop GPU | Intel Iris Xe class |
| Webcam | 1080p30 | 720p30 |
| Lighting | Even, front-lit, player 1.5–2.5 m from camera | Indoor room light, no strong backlight |
| Space | Player can extend both arms fully without leaving the frame | Shoulders and hands in frame |
