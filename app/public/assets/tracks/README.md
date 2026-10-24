# Bundled tracks

**Planned content, not installed assets yet.** The core release includes at least **three distinct full-length starter songs**, selectable on the first menu without upload, a network music service or live chart generation. Deliver the first validated song or credited prototype excerpt in P1 and the full three-song pack with Easy/Normal/Hard maps in P2 of the [roadmap](../../../../ROADMAP.md). The separate short demo edit is additional content.

One folder per track, named by slug. Each playable folder MUST contain:

| File | Purpose |
| --- | --- |
| `audio.mp3` | The track. Only CC0 or CC-BY licensed music; record attribution below. |
| `easy.json`, `normal.json`, `hard.json` | Validated `BeatmapV1` maps generated from the exact packaged audio; the future generator replaces today's failing placeholder. |
| `cover.webp` | Optional original/separately licensed 512×512 art; omit for the app's typographic fallback. Music rights do not grant cover-art rights. |
| `ATTRIBUTION.txt` | Artist/title, source/license links and actual changes/encoding; retain notices with the distributed assets. |

`manifest.json` at this level uses the [starter library schema](../../../../docs/09-beatmap-format.md#starter-library-manifest): stable slugs, local asset/chart paths, measured duration/preview bounds, analysis warnings, hashes and exact credits. No manifest exists yet. Song cards, mouse/keyboard selection and palm-to-point selection all use that same identity.

## Selected starter pack

These three real tracks are selected for procurement during implementation. Their current official per-track catalog pages list **Creative Commons Attribution 4.0**. The quoted catalog tempos/durations below are publisher metadata, not decoded measurements, detector results or evidence that the maps play well. No audio, maps, hashes or artwork have been downloaded/committed in this documentation change.

- **`pamgaea` — Pamgaea, Kevin MacLeod.** Proposed approachable entry track. Official catalog: 94 BPM, 2:49, ISRC USUAN1300036. [Official track page](https://www.incompetech.com/music/royalty-free/index.html?isrc=USUAN1300036).
- **`electro-cabello` — Electro Cabello, Kevin MacLeod.** Proposed contrasting mid-tempo groove. Official catalog: 117 BPM, 3:11, ISRC USUAN1400048. [Official track page](https://remote.incompetech.com/music/royalty-free/index.html?Search=Search&isrc=USUAN1400048).
- **`cipher` — Cipher, Kevin MacLeod.** Proposed energetic showcase. Official catalog: 150 BPM, 3:51, ISRC USUAN1100844. [Official track page](https://incompetech.com/music/royalty-free/index.html?Search=Search&isrc=USUAN1100844).

These roles describe selection intent. Decode the actual acquired files, enforce the game's admission limits, generate all difficulties and test timing/reach/comfort before advertising them as ready. If a track fails, choose another verified, credited song and update this registry; do not quietly change its title, audio or provenance. All three tracks happen to share an artist; the generator's independent holdout corpus must still cover broader material.

## Attribution and permitted edits

The artist's [licensing page](https://incompetech.com/music/royalty-free/licenses/) provides the free Creative Commons route with credit. The [CC BY 4.0 deed](https://creativecommons.org/licenses/by/4.0/) permits redistribution and adaptation subject to attribution, a license link and indicating changes; retain applicable notices and do not imply artist endorsement. Current per-track pages identify 4.0; older aggregate catalog snapshots may show 3.0, so save the acquired file's exact source/license evidence rather than mixing versions.

Carry these credits in each track's `ATTRIBUTION.txt`, the app's reachable Credits action, and relevant demo/video credits:

```text
"Pamgaea" Kevin MacLeod (incompetech.com)
Licensed under Creative Commons: By Attribution 4.0 License
https://creativecommons.org/licenses/by/4.0/

"Electro Cabello" Kevin MacLeod (incompetech.com)
Licensed under Creative Commons: By Attribution 4.0 License
https://creativecommons.org/licenses/by/4.0/

"Cipher" Kevin MacLeod (incompetech.com)
Licensed under Creative Commons: By Attribution 4.0 License
https://creativecommons.org/licenses/by/4.0/
```

Append the exact track source URL and a truthful changes line when acquiring/processing each file. Record any re-encoding, loudness adjustment, preview extraction or demo-cut boundaries; do not mark files unchanged after editing them. Generated maps have their own provenance/hash. These music files retain their Creative Commons terms rather than becoming MIT under the code license. Separate art/font/sound sources need their own rights records.

## Build and release check

`npm run beatmaps` is currently a deliberate failing placeholder. The files/manifest above are the target content contract, not existing artifacts. During P2 implement the real generator and package local audio, all three chart difficulties, measured metadata, source/PCM/map hashes and notices. During P3 add the separately credited approximately 45-second `demo-cut`; it must not replace a full starter song.

Verify selection and Preview/Start using mouse, keyboard and palm-to-point actions; previews are explicit, never hover autoplay. Test all three with external network disconnected, and show actionable errors for individual missing/corrupt assets without fabricating a successful selection. See [09 — Bundled tracks](../../../../docs/09-beatmap-format.md#bundled-tracks) and [14 — UI input](../../../../docs/14-ui-ux.md#input-handling).
