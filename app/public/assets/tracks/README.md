# Bundled tracks

The three documented full-length starter songs are now packaged locally with original MP3 bytes, acquisition records, attribution, measured metadata and Easy/Normal/Hard maps. They can be browsed before camera setup. The app never contacts the publisher to select or play them.

**Evidence status:** all nine packaged charts pass the shared schema, timing, density, beam-isolation, wall-margin and ergonomic checks. This is algorithmic validation. Independent musical annotations, standing comfort, live webcam completion and the offline browser exercise remain pending. Current analysis reports low tempo confidence for all three songs; the menu preserves that warning and does not present catalog tempo as a measured confident beat result.

## Selected starter pack

- **`pamgaea` — Pamgaea**, Kevin MacLeod, ISRC USUAN1300036. [Official track page](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1300036). The acquired official filename is `Pamgaea.mp3`.
- **`electro-cabello` — Electro Cabello**, Kevin MacLeod, ISRC USUAN1400048. [Official track page](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1400048). The acquired official filename is `Electro Cabello.mp3`.
- **`cipher` — Cipher**, Kevin MacLeod, ISRC USUAN1100844. [Official track page](https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100844). The acquired official filename is `Cipher2.mp3`, whose catalog title is Cipher.

The current official track template supplies CC BY 4.0 attribution for the selected title. Each acquisition record links the exact track and download URL, records the official catalog entry and page/catalog SHA-256, and identifies the actual received bytes. The artist's [licensing page](https://incompetech.com/music/royalty-free/licenses/) offers the free attribution route. [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) permits redistribution/adaptation with credit, a license link and disclosure of changes.

The MP3s are distributed unchanged from the official downloads. Preview uses bounded playback offsets; it does not create an edited audio file. Canonical analysis is a separate ffmpeg mono float32 decode at 22050 Hz. The build explicitly honors each file's iTunSMPB gapless sample counts when the native decoder has not already done so; it rejects unexpected counts and never trims twice. That canonical PCM is hashed but not retained as an additional large asset. Generated charts are separate artifacts. Music retains Creative Commons terms, independently of the code's MIT license. No artist endorsement is implied. No catalog cover art has been copied.

Generator version 2 includes gapless canonical sample-zero handling, explicit band-limited analysis resampling, raw spectral-novelty/RMS-rise admission, local source-sample onset refinement and supported-onset beat refinement, rather than a global playback offset. Tempo refinement keeps the registered prior during octave comparison. A measured sustained mid-band onset may reserve a beam by removing conflicting playable candidates; other raw onset evidence remains in diagnostics. Pamgaea and Cipher contain such beam reservations. Electro Cabello has no admitted sustained beam candidate under the registered defaults; its maps retain the actual slash/smash evidence. These are disclosed assignment heuristics, not independent music-quality measurements.

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

## Credits

"Pamgaea", "Electro Cabello" and "Cipher" Kevin MacLeod (incompetech.com).
Licensed under Creative Commons: By Attribution 4.0 License.
https://creativecommons.org/licenses/by/4.0/

The app's reachable Credits action must retain these credits and the per-track source/change notices. A future separate demo excerpt must record its own edit boundaries/audio hash and never replace a full starter song. See [09 — Beatmap Format](../../../../docs/09-beatmap-format.md) and [24 — Benchmark & Evidence](../../../../docs/24-benchmark-and-evidence.md) for the remaining quality/release gates.
