# Lifecycle QA — 2026-10-25

Source commit: `99fe5d4e4c5c2150fc233d1bc8b0356974b3732b`. Dirty working tree: **false**.
Recorded: 2026-10-24T23:54:07.370Z. Browser: Chrome/155.0.8059.86.

Synthetic original WAVs and planned performer motion only; no camera, person, recognition, audible-sync or performance acceptance.
The JSON retains exact checks, errors, resource samples, source hashes and environment. Unrun scenarios are never passes.

## upload: not-run


## cancel: not-run


## invalid: not-run


## cache: not-run


## context: pass

- PASS: menu: rigged avatar ready across two actual animation frames — {"geometries":70,"textures":14,"programs":32,"contextLost":false,"runtimeListeners":13}
- PASS: menu: actual context-loss extension available
- PASS: menu: useful visible graphics failure or successful recovery — {"before":{"state":"SELECT","pauseReason":null,"status":"","error":null,"fatal":"Graphics context was lost. Reload the game to restore the arena.","camera":{"state":"not-set-up","mode":"browse","calibrationValid":false,"error":null},"camera… (full detail in JSON)
- PASS: menu: no zombie scoring/audio run — {"state":"SELECT","songTimeMs":null,"audio":{"contextState":null,"activeSfxVoices":0},"nativeAudio":[]}
- PASS: menu: no zombie render callback loop while context remains lost — {"callbacksAfterLoss":0}
- PASS: menu: native Retry reload restores the usable song menu
- PASS: play: rigged avatar ready across two actual animation frames — {"geometries":90,"textures":14,"programs":39,"contextLost":false,"runtimeListeners":13}
- PASS: play: actual context-loss extension available
- PASS: play: useful visible graphics failure or successful recovery — {"before":{"state":"PAUSED","pauseReason":"fatal","status":"Get ready.","error":null,"fatal":"Graphics context was lost. Reload the game to restore the arena.","camera":{"state":"not-set-up","mode":"browse","calibrationValid":false,"error":… (full detail in JSON)
- PASS: play: no zombie scoring/audio run — {"state":"PAUSED","songTimeMs":null,"audio":{"contextState":"suspended","activeSfxVoices":0},"nativeAudio":[{"id":"4b6e1fea-066b-4238-8e52-5e3fbc763061","type":"offline","state":"suspended"},{"id":"0fbe58ba-501e-40a9-8408-00a5b16f97d0","typ… (full detail in JSON)
- PASS: play: no zombie render callback loop while context remains lost — {"callbacksAfterLoss":0}
- PASS: play: native Retry reload restores the usable song menu

Reproduce: On the menu and separately during performer play, call the canvas WEBGL_lose_context extension. Check visible failure/recovery, halted audio/scoring and bounded render callbacks.

## cycles: not-run


## hidden: not-run


## tiers: not-run


Overall: **fail / incomplete**.
