# Lifecycle QA — 2026-10-25

Source commit: `670291cc35b2f7c025022861cff87f7d29a1e975`. Dirty working tree: **false**.
Recorded: 2026-10-25T00:16:57.888Z. Browser: Chrome/155.0.8059.86.

Synthetic original WAVs and planned performer motion only; no camera, person, recognition, audible-sync or performance acceptance.
The JSON retains exact checks, errors, resource samples, source hashes and environment. Unrun scenarios are never passes.

## upload: not-run


## cancel: not-run


## invalid: not-run


## cache: pass

- PASS: unavailable: generation succeeds without cache — {"title":"lifecycle-valid","sourceHash":"66b612749396cba0fb4da11de8416455d3cb3ae63ef13e8628efdaf5e1c8c734","difficulty":"normal","notes":13,"warnings":["cacheUnavailable"]}
- PASS: unavailable: cache failure is retained in chart warnings — ["cacheUnavailable"]
- PASS: unavailable: visible honest cache-fallback message — SIGN SABER
Camera not set up
Mouse / keyboard to browse · Esc to pause
MUSIC LIBRARY
Choose your own audio
Choose your own audio

MP3, WAV, OGG or M4A · up to 5 minutes · Use mouse or keyboard for this step.

←
Previous
Choose your own audi… (full detail in JSON)
- PASS: compact viewport keeps the cache notice visible — SIGN SABER
Camera not set up
Choose your music
1 of 4
←
Previous
P
Pamgaea
2:48
E
Electro Cabello
3:10
C
Cipher
3:51
→
Next

Illustrative upper body · camera not set up

lifecycle-valid · Normal · 0:12

Local cache unavailable · chart not s… (full detail in JSON)
- PASS: quota: generation succeeds without cache — {"title":"lifecycle-valid","sourceHash":"66b612749396cba0fb4da11de8416455d3cb3ae63ef13e8628efdaf5e1c8c734","difficulty":"normal","notes":13,"warnings":["cacheUnavailable"]}
- PASS: quota: cache failure is retained in chart warnings — ["cacheUnavailable"]
- PASS: quota: visible honest cache-fallback message — SIGN SABER
Camera not set up
Mouse / keyboard to browse · Esc to pause
MUSIC LIBRARY
Choose your own audio
Choose your own audio

MP3, WAV, OGG or M4A · up to 5 minutes · Use mouse or keyboard for this step.

←
Previous
Choose your own audi… (full detail in JSON)

Reproduce: Before load, deny IndexedDB access or make real readwrite transactions throw QuotaExceededError; upload the synthesized WAV and inspect the visible fallback notice.

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
- PASS: play: no zombie scoring/audio run — {"state":"PAUSED","songTimeMs":null,"audio":{"contextState":"suspended","activeSfxVoices":0},"nativeAudio":[{"id":"4e23fe5c-9954-43ca-a89a-05a5461d8f59","type":"offline","state":"suspended"},{"id":"98343d99-8e40-4307-a0d8-bb6f5ffb06e5","typ… (full detail in JSON)
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
