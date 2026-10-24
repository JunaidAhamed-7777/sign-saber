# Bundled tracks

The three documented full-length starter songs are now packaged locally with original MP3 bytes, acquisition records, attribution, measured metadata and Easy/Normal/Hard maps. They can be browsed before camera setup. The app never contacts the publisher to select or play them.

**Evidence status:** all nine packaged charts pass the shared schema, timing, density, beam-isolation, wall-margin and ergonomic checks. This is algorithmic validation. Independent musical annotations, standing comfort, live webcam completion and the offline browser exercise remain pending. Current analysis reports low tempo confidence for all three songs; the menu preserves that warning and does not present catalog tempo as a measured confident beat result.

## Selected starter pack

- **`pamgaea` — Pamgaea**, Kevin MacLeod, ISRC USUAN1300036. [Official track page](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1300036). The acquired official filename is `Pamgaea.mp3`.
- **`electro-cabello` — Electro Cabello**, Kevin MacLeod, ISRC USUAN1400048. [Official track page](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1400048). The acquired official filename is `Electro Cabello.mp3`.
- **`cipher` — Cipher**, Kevin MacLeod, ISRC USUAN1100844. [Official track page](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100844). The acquired official filename is `Cipher2.mp3`, whose catalog title is Cipher.

The current official track template supplies CC BY 4.0 attribution for the selected title. Each acquisition record links the exact track and download URL, records the official catalog entry and page/catalog SHA-256, and identifies the actual received bytes. The artist's [licensing page](https://incompetech.com/music/royalty-free/licenses/) offers the free attribution route. [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) permits redistribution/adaptation with credit, a license link and disclosure of changes.

The MP3s are distributed unchanged from the official downloads. Preview uses bounded playback offsets; it does not create an edited audio file. Canonical analysis is a separate ffmpeg mono float32 decode at 22050 Hz. The build explicitly honors each file's iTunSMPB gapless sample counts when the native decoder has not already done so; it rejects unexpected counts and never trims twice. That canonical PCM is hashed but not retained as an additional large asset. Generated charts are separate artifacts. Music retains Creative Commons terms, independently of the code's MIT license. No artist endorsement is implied. No catalog cover art has been copied.

Generator version 3 keeps v2's analysis (gapless canonical sample zero, band-limited resampling, spectral-novelty/RMS-rise admission, source-sample onset refinement, supported-onset beat refinement) and replaces assignment. Charts now follow the strongest accents under per-difficulty caps on density, notes sharing the screen (3/4/5), same-hand recovery, beam isolation and phrase length with deliberate rests. Each hand plays its own side; strong low-band hits punch, other accents slash, and the most sustained mid/high onsets become occasional far beams. Walls are planned on the tracked-beat cadence and notes move to the open side. See [08 §9](../../../../docs/08-beatmap-generation.md#9-note-assignment-assignts) for the rules and before/after counts. These are disclosed heuristics checked by the validator and the synthetic performer, not independent music-quality or human-comfort measurements.

| Track | Easy notes (slash/smash/beam) | Normal | Hard |
| --- | --- | --- | --- |
| Pamgaea | 89 (45/34/10) | 178 (97/69/12) | 230 (112/100/18) |
| Electro Cabello | 116 (52/54/10) | 183 (110/62/11) | 285 (129/140/16) |
| Cipher | 116 (65/42/9) | 202 (106/83/13) | 267 (120/131/16) |

The synthetic performer reaches every note of all nine charts (`tests/performer.test.mjs`; v2 left 59/149/56 Hard notes unreachable). `node scripts/chart-report.mjs` prints the gesture mix, density, peak on-screen count and performer reachability of the installed charts.

## Files and provenance

Each track directory contains:

- `audio.mp3`: the full acquired song.
- `easy.json`, `normal.json`, `hard.json`: validated `BeatmapV1` charts generated from that exact audio.
- `ATTRIBUTION.txt`: readable credits, source, license, actual changes and acquisition hash.
- `acquisition.json`: source/license verification and acquisition metadata.
- `generation.json`: canonical decode identity, measured duration/sample count, detector result/confidence, chart counts and actual validation scope.

[manifest.json](manifest.json) is the single runtime catalog. It records measured duration/preview bounds, local paths, original-audio/canonical-PCM/map SHA-256, credits and warnings. Local asset paths are confined to each track's directory. Playback loads one selected audio buffer on demand. Audio/chart bytes are hash-checked, and the chart is validated before play. Browser decode duration is compared with the canonical measure using the documented tolerance; different native decode engines are not promised identical PCM.

## Reproduce content

Existing verified assets play without running these tools. Explicit re-acquisition requires network:

```powershell
node scripts/acquire-starter-music.mjs
```

From the repository root, with dependencies installed in `app/` and ffmpeg on PATH:

```powershell
node scripts/generate-beatmaps.mjs
```

The command decodes the installed audio into temporary canonical PCM, runs the same TypeScript analysis/assignment/validator used by the browser worker, writes the nine maps and rebuilds the manifest. It uses the locked TypeScript package as a build-time loader; no independent chart algorithm is hidden in the script. Temporary PCM is removed on completion/failure. Reproduction across ffmpeg versions must compare the recorded canonical PCM hash before claiming identical input. Browser-native decoding is measured separately.

The optional development command `node scripts/check-audio-resampling.mjs` runs the actual analysis resampler in an isolated headless Chrome against synthetic 16/32/44.1/48 kHz PCM, then checks native decoding duration and source-zero correlation for the three licensed songs. It uses a temporary local test server/profile and requests no camera or audio-output permission. [The recorded browser result](../../../../app/tests/fixtures/audio/resample-browser-result.json) and [the earlier native-resampling failure summary](../../../../app/tests/fixtures/audio/resample-browser-native-failure.json) are numeric correctness evidence, separate from live playing, musical quality, audible sync and performance gates. An explicit sinc resampler replaced the native rate conversion after that failure; cancellation checkpoints yield during mono mixing/resampling.

From `app/`, the asset integrity and chart assertions are part of `npm run test`. The tests hash all three audio files/all nine maps and exercise malformed manifests/maps, density, walls, beam sustain and deterministic synthetic signals. Tests do not listen to music or establish human playability.

## Dynamic arrangements

[The arrangement module](../../../../app/src/audio/arrange.ts) can render a new continuous 80-second derivative: a 10-second fade in, 60-second central highlight and 10-second fade out. The selection scores measured energy and distinct onset evidence; confident beat analysis can constrain highlight starts to tracked beats. Uncertain tempo stays labelled, and this heuristic is not a verified chorus detector. Shorter inputs retain their actual duration with proportional fades rather than looping or inventing missing music.

The output is an actual float32 WAV file and audio buffer. Its receipt records the original file identity, selected source sample bounds, fade/highlight bounds, changes, derivative WAV hash and canonical analysis PCM hash. Generate a fresh chart from those derivative file bytes; the original full-song chart must never be shifted under edited audio. The local in-memory derivative follows the local-file generator path while retaining the original track/artist and edit provenance.

`node scripts/check-audio-resampling.mjs --arrangement` runs the actual native browser path for all three starter tracks, decodes each rendered WAV and regenerates a Normal map from its edited PCM. [The recorded result](../../../../app/tests/fixtures/audio/arrangement-browser-result.json) verifies numeric audio/map identity and fades. It does not establish audible quality, human preference for the chosen highlight or live playability. The three original full songs and original acquisition bytes remain packaged separately.

## Credits

"Pamgaea", "Electro Cabello" and "Cipher" Kevin MacLeod (incompetech.com).
Licensed under Creative Commons: By Attribution 4.0 License.
https://creativecommons.org/licenses/by/4.0/

The app's reachable Credits action must retain these credits and the per-track source/change notices. A future separate demo excerpt must record its own edit boundaries/audio hash and never replace a full starter song. See [09 — Beatmap Format](../../../../docs/09-beatmap-format.md) and [24 — Benchmark & Evidence](../../../../docs/24-benchmark-and-evidence.md) for the remaining quality/release gates.
