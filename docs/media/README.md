# Demo media

The README combines preserved gameplay GIFs with fresh screenshots of the polished desktop interface. Every image comes from the running application. There are no mock-ups, generated images, injected hits, altered scores or composited controls.

## Current desktop interface

[interface-capture.json](interface-capture.json) records a complete production-browser run on **2026-10-25 (+05:30)** at application source **`8f0e318a9077b1a06f80cf19ab17c83b5c4ca03a`**. Application source was unchanged during capture; documentation edits were in progress.

- [menu.png](menu.png): native **1440 × 900 PNG**, captured after **Pamgaea → Enable sound**. Shows the new geometric sleeves, music rows, difficulty, support actions, primary Play control and central illustrative upper-body avatar.
- [results.png](results.png): native **1440 × 900 PNG** after **Watch auto-play** completed the actual 80-second arrangement. The current forgiving contact mode produced **84 hits, 0 misses, 0 bad cuts, 84 best combo, 25,060 score and 45.8% accuracy** (5 Perfect, 79 Good, D rank). These are the real results, preserved without adjustment.

The receipt includes the source SHA, browser version, actual native UI actions, timestamps, screenshot byte sizes/SHA-256 hashes and console output. The only console warning was Three.js reporting an already non-indexed geometry. This is a synthetic-performer run; it makes no live-camera, human-performance or frame-rate claim.

[menu-refined.png](menu-refined.png) remains the separate source-hashed frontend verification capture referenced by the [frontend browser receipt](../evidence/2026-10-25-frontend-polish.json). The active README and player guide use the newer `menu.png` above. Old interface WebP files and superseded gameplay stills were removed from the active documentation assets.

## Preserved gameplay GIFs

These files remain **byte-for-byte unchanged** from their original browser capture at application source **`30572bb9cdbe345b79e8e48279019bd7d8b59877`**:

- [hero.gif](hero.gif): wall dodge, beam release, slices and smashes; recorded seconds **50.6–54.6**, encoded at **720 × 450**.
- [slash.gif](slash.gif): a cyan slice followed by a magenta smash; recorded seconds **7.5–10.5**, encoded at **560 × 350**.
- [beam.gif](beam.gif): point-and-hold charge, gold target collapse and the next smash; recorded seconds **23.3–26.3**, encoded at **560 × 350**.

All three show synthetic auto-play through the real input pipeline and judge. They are silent excerpts at the original clock speed, encoded at 8 fps with a 64-color palette and Bayer dithering. That cadence describes the files, not game performance. Their combined size is **5,686,832 bytes**. The new interface receipt independently verifies that their SHA-256 hashes are unchanged.

The [original capture receipt](capture.json) preserves the original 84-Perfect Pamgaea run, compositor timestamps and historical file hashes. It also identifies retired still images; its hashes and results belong to that original source, rather than the replacement screenshots. The corresponding Git history preserves those originals.

## Reproduce

Use Node 22+, Chrome (or `BROWSER_BINARY`) and ffmpeg on `PATH`. From `app/`:

```powershell
npm run build
npm run preview -- --port 4186
```

From the repository root:

```powershell
node scripts/capture-readme.mjs --url http://127.0.0.1:4186 --song pamgaea
```

The [capture script](../../scripts/capture-readme.mjs) drives real UI controls, captures the menu and completed results, and records raw compositor frames in a temporary directory. It overwrites `menu.png`, `results.png` and `capture.json`, so retain any historical receipt you need before recapturing. Inspect the screenshots, actual results and source attribution before committing new media.

The optional render pass regenerates GIFs and gameplay stills from those temporary frames:

```powershell
node scripts/capture-readme.mjs --render "<temporary directory printed by capture>"
```

Do not run the render pass when preserving the existing GIFs. The current refresh captured only new menu/results PNGs and wrote `interface-capture.json`; the original GIFs and original `capture.json` were preserved.
