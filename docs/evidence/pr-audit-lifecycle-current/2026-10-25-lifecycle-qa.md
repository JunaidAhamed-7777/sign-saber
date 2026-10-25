# Lifecycle QA — 2026-10-25

Source commit: `ce300c80536de1b004252884057c3b6efd492622`. Dirty working tree: **false**.
Recorded: 2026-10-25T00:24:05.420Z. Browser: Chrome/155.0.8059.86.

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
- PASS: play: no zombie scoring/audio run — {"state":"PAUSED","songTimeMs":null,"audio":{"contextState":"suspended","activeSfxVoices":0},"nativeAudio":[{"id":"9a9cd95d-9d78-4d2e-b415-62c8c81ab705","type":"offline","state":"suspended"},{"id":"b4cf4783-0665-43c8-825d-0082181d964c","typ… (full detail in JSON)
- PASS: play: no zombie render callback loop while context remains lost — {"callbacksAfterLoss":0}
- PASS: play: native Retry reload restores the usable song menu

Reproduce: On the menu and separately during performer play, call the canvas WEBGL_lose_context extension. Check visible failure/recovery, halted audio/scoring and bounded render callbacks.

## cycles: not-run


## hidden: pass

- PASS: countdown: browser actually hid the game tab — {"state":"SELECT","pauseReason":null,"status":"Choose music when you are ready.","error":null,"fatal":null,"camera":{"state":"not-set-up","mode":"browse","calibrationValid":false,"error":null},"cameraSource":null,"cameraStage":"","calibrati… (full detail in JSON)
- PASS: countdown: expected hidden-tab semantics — {"state":"SELECT","pauseReason":null,"status":"Choose music when you are ready.","error":null,"fatal":null,"camera":{"state":"not-set-up","mode":"browse","calibrationValid":false,"error":null},"cameraSource":null,"cameraStage":"","calibrati… (full detail in JSON)
- PASS: countdown: returning alone never auto-starts — SELECT
- PASS: play: browser actually hid the game tab — {"state":"PAUSED","pauseReason":"hidden","status":"Get ready.","error":null,"fatal":null,"camera":{"state":"not-set-up","mode":"browse","calibrationValid":false,"error":null},"cameraSource":null,"cameraStage":"","calibrationReady":true,"tra… (full detail in JSON)
- PASS: play: expected hidden-tab semantics — {"state":"PAUSED","pauseReason":"hidden","status":"Get ready.","error":null,"fatal":null,"camera":{"state":"not-set-up","mode":"browse","calibrationValid":false,"error":null},"cameraSource":null,"cameraStage":"","calibrationReady":true,"tra… (full detail in JSON)
- PASS: play: returning alone never auto-starts — PAUSED
- PASS: native Resume works after tab return

Reproduce: Activate another real Chrome tab during the start countdown and separately during play; return to the game tab and inspect cancellation/pause/manual resume.

## tiers: not-run


Overall: **fail / incomplete**.
