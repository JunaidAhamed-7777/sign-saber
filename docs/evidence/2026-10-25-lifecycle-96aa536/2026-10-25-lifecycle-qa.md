# Lifecycle QA — 2026-10-25

Source commit: `96aa53681c71e915077a0a8ad9b1a1de9acae529`. Dirty working tree: **false**.
Recorded: 2026-10-24T23:38:05.422Z. Browser: Chrome/155.0.8059.86.

Synthetic original WAVs and planned performer motion only; no camera, person, recognition, audible-sync or performance acceptance.
The JSON retains exact checks, errors, resource samples, source hashes and environment. Unrun scenarios are never passes.

## upload: pass

- PASS: original synthesized upload generated a real nonempty chart — {"title":"lifecycle-valid","sourceHash":"66b612749396cba0fb4da11de8416455d3cb3ae63ef13e8628efdaf5e1c8c734","difficulty":"normal","notes":13,"warnings":[]}
- PASS: generation progress was observed — [{"active":true,"fraction":0,"stage":"read"},{"active":true,"fraction":0,"stage":"resample"},{"active":true,"fraction":0,"stage":"resample"},{"active":true,"fraction":0,"stage":"resample"},{"active":true,"fraction":0,"stage":"resample"},{"a… (full detail in JSON)
- PASS: performer reached real results with nonzero hits — {"perfect":12,"great":0,"good":0,"miss":0,"badcut":0,"obstaclesHit":0,"obstaclesDodged":1}
- PASS: Songs returns to a usable menu
- PASS: no browser console errors (warnings retained separately) — []

Reproduce: Upload lifecycle-valid.wav, wait for analysis, choose Easy then Normal, Enable sound, Watch synthetic performer, wait for Results, choose Songs.

## cancel: pass

- PASS: a second upload succeeds after cancellation — {"title":"lifecycle-second","sourceHash":"0ec8fc97d01184f7fbdc1abbde8fa96f192ce4d05d9814ca2419119eceefc6e0","difficulty":"normal","notes":14,"warnings":[]}
- PASS: cancelled job cannot overwrite the new selection — {"title":"lifecycle-second","sourceHash":"0ec8fc97d01184f7fbdc1abbde8fa96f192ce4d05d9814ca2419119eceefc6e0","difficulty":"normal","notes":14,"warnings":[]}
- PASS: no browser console errors (warnings retained separately) — []

Reproduce: Upload lifecycle-long.wav; click Cancel analysis while progress is active; upload lifecycle-second.wav; verify its source hash remains selected after old work could return.

## invalid: pass

- PASS: corrupt: an actual input error is shown — This browser could not decode that audio. Try MP3 or WAV.
- PASS: corrupt: menu remains usable — {"title":"Pamgaea","sourceHash":"9f0ad72567c49d9e1ab895937bef03058a6fc1cfcc20ba7fdd4b681f3c7b5586","difficulty":"normal","notes":178,"warnings":["lowTempoConfidence","humanRhythmAndComfortReviewPending"]}
- PASS: wrong: an actual input error is shown — This browser could not decode that audio. Try MP3 or WAV.
- PASS: wrong: menu remains usable — {"title":"Pamgaea","sourceHash":"9f0ad72567c49d9e1ab895937bef03058a6fc1cfcc20ba7fdd4b681f3c7b5586","difficulty":"normal","notes":178,"warnings":["lowTempoConfidence","humanRhythmAndComfortReviewPending"]}
- PASS: short: an actual input error is shown — Choose audio between 5 and 300 seconds.
- PASS: short: menu remains usable — {"title":"Pamgaea","sourceHash":"9f0ad72567c49d9e1ab895937bef03058a6fc1cfcc20ba7fdd4b681f3c7b5586","difficulty":"normal","notes":178,"warnings":["lowTempoConfidence","humanRhythmAndComfortReviewPending"]}
- PASS: oversized: an actual input error is shown — Choose a non-empty audio file smaller than 60 MiB
- PASS: oversized: menu remains usable — {"title":"Pamgaea","sourceHash":"9f0ad72567c49d9e1ab895937bef03058a6fc1cfcc20ba7fdd4b681f3c7b5586","difficulty":"normal","notes":178,"warnings":["lowTempoConfidence","humanRhythmAndComfortReviewPending"]}

Reproduce: Choose each corrupt/wrong-format/one-second/over-60-MiB fixture in turn; inspect error, then select bundled music to verify menu recovery.

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
1 of 2
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

- PASS: menu: actual context-loss extension available
- PASS: menu: useful visible graphics failure or successful recovery — {"before":{"state":"SELECT","pauseReason":null,"status":"","error":null,"fatal":"Graphics context was lost. Reload the game to restore the arena.","camera":{"state":"not-set-up","mode":"browse","calibrationValid":false,"error":null},"camera… (full detail in JSON)
- PASS: menu: no zombie scoring/audio run — {"state":"SELECT","songTimeMs":null,"audio":{"contextState":null,"activeSfxVoices":0},"nativeAudio":[]}
- PASS: menu: no zombie render callback loop while context remains lost — {"callbacksAfterLoss":0}
- PASS: menu: native Retry reload restores the usable song menu
- PASS: play: actual context-loss extension available
- PASS: play: useful visible graphics failure or successful recovery — {"before":{"state":"PAUSED","pauseReason":"fatal","status":"Get ready.","error":null,"fatal":"Graphics context was lost. Reload the game to restore the arena.","camera":{"state":"not-set-up","mode":"browse","calibrationValid":false,"error":… (full detail in JSON)
- PASS: play: no zombie scoring/audio run — {"state":"PAUSED","songTimeMs":null,"audio":{"contextState":"suspended","activeSfxVoices":0},"nativeAudio":[{"id":"b0f6e757-9641-4b82-badb-fcaf83ee19e2","type":"offline","state":"suspended"},{"id":"45628102-fc87-4299-aa99-223196c927fc","typ… (full detail in JSON)
- PASS: play: no zombie render callback loop while context remains lost — {"callbacksAfterLoss":0}
- PASS: play: native Retry reload restores the usable song menu

Reproduce: On the menu and separately during performer play, call the canvas WEBGL_lose_context extension. Check visible failure/recovery, halted audio/scoring and bounded render callbacks.

## cycles: pass

- PASS: fixed baseline is the actual suspended-audio menu boundary — [{"id":"280ac64b-c924-4cfa-9e05-81b8c19fc83b","type":"offline","state":"suspended"},{"id":"39d3ee66-d51e-498b-bd02-b61bffdecf83","type":"realtime","state":"suspended"},{"id":"4c65d47b-1244-4e34-97d6-bf212b3cc8e7","type":"offline","state":"s… (full detail in JSON)
- PASS: quit leaves no connected native buffer sources or active SFX voices
- PASS: all 20 complete measured cycles
- PASS: warmed retained resources do not grow — []
- PASS: no browser console errors during repeated lifecycle — []

Reproduce: Warm a complete uploaded performer run, return to Songs, collect garbage, then measure all 20 real start/pause/resume/quit cycles with periodic Results/retry; compare the same idle menu boundary.

## hidden: pass

- PASS: countdown: browser actually hid the game tab — {"state":"SELECT","pauseReason":null,"status":"Choose music when you are ready.","error":null,"fatal":null,"camera":{"state":"not-set-up","mode":"browse","calibrationValid":false,"error":null},"cameraSource":null,"cameraStage":"","calibrati… (full detail in JSON)
- PASS: countdown: expected hidden-tab semantics — {"state":"SELECT","pauseReason":null,"status":"Choose music when you are ready.","error":null,"fatal":null,"camera":{"state":"not-set-up","mode":"browse","calibrationValid":false,"error":null},"cameraSource":null,"cameraStage":"","calibrati… (full detail in JSON)
- PASS: countdown: returning alone never auto-starts — SELECT
- PASS: play: browser actually hid the game tab — {"state":"PAUSED","pauseReason":"hidden","status":"Get ready.","error":null,"fatal":null,"camera":{"state":"not-set-up","mode":"browse","calibrationValid":false,"error":null},"cameraSource":null,"cameraStage":"","calibrationReady":true,"tra… (full detail in JSON)
- PASS: play: expected hidden-tab semantics — {"state":"PAUSED","pauseReason":"hidden","status":"Get ready.","error":null,"fatal":null,"camera":{"state":"not-set-up","mode":"browse","calibrationValid":false,"error":null},"cameraSource":null,"cameraStage":"","calibrationReady":true,"tra… (full detail in JSON)
- PASS: play: returning alone never auto-starts — PAUSED
- PASS: native Resume works after tab return

Reproduce: Activate another real Chrome tab during the start countdown and separately during play; return to the game tab and inspect cancellation/pause/manual resume.

## tiers: pass

- PASS: low: requested quality tier boots — {"tier":"low","preset":{"renderScale":0.75,"bloomResolutionScale":0.25,"bloomMipLevels":4,"bloomIntensity":0.9,"chromaticAberration":"off","antialiasing":"none","trailParticlesPerHand":96,"ribbonLayers":1,"ribbonCoreWidened":true,"ribbonSpi… (full detail in JSON)
- PASS: low: performer reaches genuine positive results — {"perfect":12,"great":0,"good":0,"miss":0,"badcut":0,"obstaclesHit":0,"obstaclesDodged":1}
- PASS: low: no browser console errors — []
- PASS: medium: requested quality tier boots — {"tier":"medium","preset":{"renderScale":1,"bloomResolutionScale":0.35,"bloomMipLevels":5,"bloomIntensity":1,"chromaticAberration":"off","antialiasing":"fxaa","trailParticlesPerHand":160,"ribbonLayers":2,"ribbonCoreWidened":false,"ribbonSpi… (full detail in JSON)
- PASS: medium: performer reaches genuine positive results — {"perfect":12,"great":0,"good":0,"miss":0,"badcut":0,"obstaclesHit":0,"obstaclesDodged":1}
- PASS: medium: no browser console errors — []
- PASS: high: requested quality tier boots — {"tier":"high","preset":{"renderScale":1,"bloomResolutionScale":0.5,"bloomMipLevels":6,"bloomIntensity":1.2,"chromaticAberration":"optional-drop","antialiasing":"smaa-medium","trailParticlesPerHand":256,"ribbonLayers":2,"ribbonCoreWidened":… (full detail in JSON)
- PASS: high: performer reaches genuine positive results — {"perfect":12,"great":0,"good":0,"miss":0,"badcut":0,"obstaclesHit":0,"obstaclesDodged":1}
- PASS: high: no browser console errors — []

Reproduce: Load fresh low/medium/high fixed-tier pages, upload the same original synthesized WAV, enable sound and complete the planned performer through actual results.

Overall: **pass**.
