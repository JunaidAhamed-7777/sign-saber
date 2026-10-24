# 15 — Audio Playback & Sync

**Implementation checkpoint:** the pure game/audio spine and synthetic assertions are implemented. Live camera/audio integration and phase acceptance remain unverified.

Scope: `audio/` — decoding, the `SongClock` that every other subsystem reads time from, playback and pause, the mapping between tracking timestamps and song time, the `AnalyserNode` band energies that drive reactive visuals, autoplay policy, and the SFX bus. The beatmap generator's offline analysis is in [08](08-beatmap-generation.md); it only borrows the decoder from here.

Design basis: [ADR-010](03-decisions.md#adr-010--audio-clock-is-the-master-clock) — the Web Audio clock is the master clock. Nothing else accumulates song time.

## 1. Decoding (`audio/decode.ts`)

```ts
export async function decodeForPlayback(bytes: ArrayBuffer, ctx: AudioContext): Promise<AudioBuffer>
export async function decodeForAnalysis(bytes: ArrayBuffer): Promise<{ mono: Float32Array; sampleRate: number }>
```

1. **Playback buffer.** `ctx.decodeAudioData(bytes.slice(0))` on the live `AudioContext` (its sample rate is the device's, typically 44.1 or 48 kHz). `.slice(0)` because `decodeAudioData` detaches the buffer and the same bytes are needed for hashing and analysis. Before the live context exists, selection decodes through an offline context at `PLAYBACK_DECODE_SR` (full-band 44.1 kHz). If a browser ignores explicit iTunSMPB gapless metadata, `audio/gapless.ts` removes the encoder delay/padding only when the decoded length equals the untrimmed count, so bundled maps keep the canonical sample zero.
2. **Analysis buffer.** Decode once (any context), then resample and down-mix with an `OfflineAudioContext(1, ceil(duration · ANALYSIS_SR), ANALYSIS_SR)`: create a buffer source with the decoded buffer, connect to destination, `startRendering()`. The result is mono at `ANALYSIS_SR`, which the generator worker receives as a transferred `Float32Array`. Resampling via `OfflineAudioContext` is high quality and runs off the main thread inside the browser.
3. **Hash.** `sourceHash = hex(SHA-256(bytes))` via `crypto.subtle.digest` on the original bytes, before any decode. Used as the beatmap cache key ([09](09-beatmap-format.md)).
4. Inputs are accepted only if the tested browser can decode them; MP3/WAV are the primary fixtures, and OGG/Vorbis, M4A/AAC and FLAC require browser-specific verification. File extensions/MIME types are hints, not proof of a valid file. Reject files above `MAX_UPLOAD_BYTES` before decoding; afterward reject duration outside `[MIN_TRACK_MS, MAX_TRACK_MS]`, non-finite/empty PCM, and `decoded.length · decoded.numberOfChannels · 4 > MAX_DECODED_PCM_BYTES` before creating analysis copies/resampling. Decoded PCM can greatly exceed compressed size. This post-decode bound is **not** a hard cap on the native decoder's peak allocation; catch resource/decode failures, release references and keep SELECT usable. Silence follows the generator's explicit empty-chart path ([08](08-beatmap-generation.md)).
5. Decoding happens in `SELECT` on upload, and bundled tracks decode on `select:start` (both buffers are needed before `CALIBRATION` begins so there is no stall at start).

## 2. SongClock (`audio/songClock.ts`)

```ts
class SongClock {
  constructor(private ctx: AudioContext) {}
  scheduleStart(leadS?: number): number;      // caller passes computed pre-roll; default SONG_START_LEAD_S for clock-only tests
  now(): number;                             // output-aligned song ms; negative during armed pre-roll, NaN before scheduling
  pause(): Promise<void>; resume(): Promise<void>; // asynchronous lifecycle; machine waits for successful completion
  fromPerformanceTime(tPerf: number): number;// maps a performance.now() stamp to song time (ms)
  readonly state: 'idle' | 'running' | 'paused' | 'ended';
}
```

### 2.1 Start

```
// At countdown BEGIN, while still in CALIBRATION and with all readiness guards met:
stepMs = confidentTempo ? 60000 / bpm : START_COUNTDOWN_MS / COUNTDOWN_STEPS
countSpanMs = COUNTDOWN_STEPS · stepMs
earliestSpawnMs = min(0, each travelling note.t − approachMs,
                        each beam.t − BEAM_LEAD_MS, each obstacle.t − approachMs)
leadMs = max(START_COUNTDOWN_MS, countSpanMs,
             −earliestSpawnMs + SONG_START_LEAD_S · 1000)
t0 = songClock.scheduleStart(leadMs / 1000) // internally ctx.currentTime + leadS, context seconds
source.start(t0)                           // schedule ONCE, never again at calib:complete
click k is scheduled at t0 − k · stepMs / 1000 // k = COUNTDOWN_STEPS ... 1; pitched only for confident tempo

graphSongTime = (ctx.currentTime − t0) · 1000  // processing position, not yet speaker output
songTime(now) = fromPerformanceTime(performance.now()) // output-aligned estimate (§2.4)
```

`now()` runs negative immediately after scheduling. Run spawning and rendering during this armed pre-roll, even though scoring remains disabled until `PLAYING` begins at audible song time 0 ([04](04-state-machine.md#calibration)). Thus a note at 412 ms with a 2000 ms approach appears at −1588 ms and receives its full travel, rather than materialising partway down the lane. Preparation can exceed the visible final digits for an early note or a slow confident tempo; show a short ready state before those digits.

The DOM shows digit `k` when output-aligned `SongClock.now()` crosses `−k · stepMs`; it uses the same output correlation as gameplay rather than a `ctx.currentTime`-only timer that ignores speaker delay. For confident tempo, clicks use the corresponding context-time schedule and are musical cues. A `lowTempoConfidence` warning selects a neutral visual countdown: do not use the numeric BPM estimate as a detected tempo or schedule a musical metronome. Its ticks are the unpitched `countNeutral` cue on the neutral digit grid (§6), which asserts no tempo or key. Cache hits preserve the same mode. Countdown cancellation stops/disconnects every scheduled music/click source, invalidates the epoch/anchors and clears pre-roll objects. Ignore stopped-source `onended` callbacks from that epoch so cancellation cannot produce RESULTS or a delayed song start.

### 2.2 Pause and resume

`AudioContext.suspend()` freezes its processing clock, but the request and physical output boundary are asynchronous. Freeze scoring/input immediately, await suspension, and record the actual suspended context position and pause reason. `now()` returns the stored pause position while paused. Do not subtract a guessed "leak" from song time while leaving the source at a different sample; that creates a permanent chart/audio offset.

On resume, wait for a running context and a valid fresh output timestamp before re-anchoring the performance mapping; discard old tracking samples and reset measured sweep/charge history. Retain a small history of running-segment anchors so `fromPerformanceTime` never maps a capture from a paused interval into a new segment. If the browser interrupts audio or a resume promise fails, remain `PAUSED` with an explicit enable-audio action. Test real output continuity; do not infer it solely from `ctx.state`.

The `RESUME_COUNTDOWN_MS` overlay runs while the context is suspended, using monotonic wall time. At its end request `ctx.resume()`; remain `PAUSED` with a brief resuming state until that promise succeeds and the output mapping is usable. Then transition to `PLAYING`. Do not promise the async browser operation restarts physical sound exactly at the zero digit. Rejection/interruption cancels the attempt and exposes an enable-audio action; a failed attempt never enables scoring.

### 2.3 End

`source.onended` → `state = 'ended'`; the game waits `SONG_TAIL_MS` for trailing notes ([04](04-state-machine.md#transitions)). `now()` keeps advancing past `durationMs` from the context clock (the context is not suspended) so the tail is measured correctly.

### 2.4 Mapping tracking timestamps to song time

Tracking frames carry `tCapture` in the `performance.now()` domain ([05 §1.2](05-tracking-pipeline.md#12-frame-callback-and-centre-crop)); judgements need song time ([07 §3](07-hit-detection-and-scoring.md#3-hit-zone-and-timing-error)).

```
// Preferred: correlate the device-output sample with the performance timeline.
{ contextTime, performanceTime } = ctx.getOutputTimestamp()
anchorPerf = performanceTime
anchorSong = (contextTime − t0) · 1000
fromPerformanceTime(tPerf) = anchorSong + (tPerf − anchorPerf)
```

- Refresh the correlation during running playback and retain segment boundaries across pause/resume. Both clocks are monotonic, but their rate error, timestamp precision and output-device behaviour are measured properties; do not promise sub-millisecond drift without evidence.
- Validate finite, advancing timestamp fields; before output starts the pair may not be useful. `getOutputTimestamp()` already correlates an output sample with performance time, so **do not add or subtract `outputLatency` again**. The [API's output correlation](https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/getOutputTimestamp) is the source for this mapping.
- Fallback: take a near-simultaneous `performance.now()` / `ctx.currentTime` pair and subtract an available latency estimate from the context-time position: `anchorSong = (ctx.currentTime − t0 − estimatedOutputDelayS) · 1000`. The audible position is behind processing, so the sign is negative. When available, use `baseLatency + outputLatency` as a reported estimate of graph-to-output delay; otherwise record which component is absent and the uncertainty. `inputOffsetMs` covers residual personal/device bias. Do not silently describe fallback timing as sample-accurate.

## 3. `inputOffsetMs`

Semantics: a positive `inputOffsetMs` makes every contact count as *later*; a negative one as *earlier*. It is added to the timing error ([07 §3](07-hit-detection-and-scoring.md#3-hit-zone-and-timing-error)). Default `INPUT_OFFSET_DEFAULT_MS`, user range ±150 in a settings drawer on `SELECT` (slider, persisted to `localStorage`).

Why it exists even though `tCapture` already removes processing latency: the *player's* perception loop (see block → decide → swing arrives) differs per person and per display latency; rhythm games always expose this knob.

**[STRETCH] Offset calibration mini-game.** In `SELECT`, "Calibrate timing" plays a 100 BPM click for 12 beats and asks the player to clap (both hands' cursors meet) on each click. The median of `songTimeAtCapture − clickTime` over the last 8 claps becomes `inputOffsetMs` (negated), shown with a "Looks good / Redo" confirmation.

## 4. Band energies (`audio/analyser.ts`)

Graph: `source → analyser → musicGain → master → destination`. The analyser taps the music only (SFX bypass it) so reactive visuals follow the song, not the sound effects.

```
analyser.fftSize = ANALYSER_FFT; analyser.smoothingTimeConstant = 0   // we smooth ourselves
binHz = ctx.sampleRate / ANALYSER_FFT
each frame: analyser.getByteFrequencyData(buf)
  bandAvg(lo, hi) = mean(buf[k] / 255 for k in [floor(lo/binHz), ceil(hi/binHz)))
  rawLow = bandAvg(BAND_LOW_HZ), rawMid = bandAvg(BAND_MID_HZ), rawHigh = bandAvg(BAND_HIGH_HZ)
  rawRms = sqrt(mean over time-domain (getFloatTimeDomainData) of x²) · ANALYSER_RMS_GAIN   (clamped 0..1)
```

Smoothing per band, frame-rate independent (`dt` in seconds):

```
retention = band === 'low' && raw > value ? ANALYSER_LOW_ATTACK : ANALYSER_SMOOTH
k = 1 − retention^(dt · 60)
value += (raw − value) · k
```

The default retention coefficients correspond to `τ = −1/(60 · ln(retention))`; do not also hardcode a contradictory release time. Then auto-gain uses `peak = max(raw, peak · exp(−dt / ANALYSER_PEAK_DECAY_S))` with `ANALYSER_PEAK_FLOOR`. Clamp normalized output to 0..1 and preserve actual silence at zero; gain normalization must not manufacture beats. Output is `BandEnergies { low, mid, high, rms }`, read by the renderer every frame ([10](10-rendering-silhouette.md), [13](13-rendering-environment-camera-postfx.md)). Allocate FFT/time-domain arrays once.

The analyser may run on an explicitly requested preview source in `SELECT`. A camera is not required to browse or preview the bundled library. If setup is incomplete, keep the static central person and **Set up camera** action; preview energy can tint the background grid but cannot animate that illustration as if it were tracked. Selecting/hovering a song or arming a hand target never autoplays its preview. Stop/disconnect the old preview on replacement, setup countdown, Start or SELECT exit so it cannot mix with the scheduled song.

## 5. Autoplay policy

Browsers block audio until a user gesture. Rules:

1. Create/unlock the live `AudioContext` inside a real browser mouse/key enable/start/preview action in SELECT, never from a background load timer. BOOT reaches the catalog without sound or camera permission. Unlocking does not itself start music. Until then the `SongClock` is `idle`; Start explains when audio needs enabling. Decode assets through the initialized context or an offline decoding context before the play session starts.
2. A webcam-recognized point is an app command, not trusted browser user activation; do not claim it can unlock a blocked context or grant camera permission. Reuse an already unlocked context for hand-operated preview/Start. If audio is still blocked, keep the current selection and show the explicit **Enable sound** mouse/key action; request `ctx.resume()` directly from that real event before awaiting unrelated work. On `select:start`, verify the context is running before proceeding. See [browser user activation](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/User_activation).
3. `visibilitychange` → hidden does *not* suspend the context by itself (that would double-pause); the state machine's `pause:request` does.

## 6. SFX bus and audio feel (`audio/sfx*.ts`)

Every sound is original and synthesized from code: `audio/sfxSynth.ts` renders deterministic PCM from fixed seeds (no recordings, samples or third-party audio; MIT like the code). No SFX files ship; `app/public/assets/sfx/` stays empty. Runtime synthesis was chosen over offline OGG files because buffers are rendered at the live context's own sample rate (no resampling or decode at start), Calm and per-track tonal variants are cheap re-renders, Safari's uneven Ogg Vorbis support is irrelevant, and the buffers the tests measure are exactly the ones that play.

| Module | Role |
| --- | --- |
| `sfxSynth.ts` | Recipes and DSP (TPT state-variable filters, polyBLEP oscillators, FM bells, grains, Karplus–Strong, small Schroeder room); loudness normalization |
| `sfxMetrics.ts` | BS.1770 K-weighted momentary loudness, peak, RMS and spectral centroid |
| `sfxRender.worker.ts` / `sfxBank.ts` | Off-main-thread rendering and tonal analysis; validated, bounded LRU `AudioBuffer` cache with inline fallback |
| `sfx.ts` | `SfxBus`: voices, stereo placement, polyphony, limiter, scheduling, pause-aware silencing, disposal |
| `sfxDirector.ts` | Audio game feel: maps game, lifecycle and menu events to cues |
| `tonic.ts` | Cheap tonal-centre estimate used only to tune pitched cues |

`scripts/render-sfx.mjs` renders 48 kHz WAV files for audition (`--out`), pins SHA-256 hashes and measurements in `assets-src/audio/sfx-receipt.json` (`--receipt`, verified by `tests/sfxSynth.test.ts`) and can cross-check loudness with ffmpeg's `ebur128` filter (`--ffmpeg`). Graph: `source → voice gain → stereo panner → bus input → limiter → bus output → master → destination`.

| Sound | Trigger | LUFS | Design |
| --- | --- | --- | --- |
| `slash` | `note:hit` slash | −24 | Noise swish swept up to ≈ 8.4 kHz, bright crackle sizzle, glassy 2.4 kHz ting, light body |
| `smash` | `note:hit` smash | −22.5 | Driven pitch-enveloped kick 190 → 46 Hz, click, decimated mid crunch, debris grains |
| `zap` | `beam:fire` | −23 | Detuned saw laser 2.6 kHz → 260 Hz with ring-mod edge, electric crackle, sub punch |
| `poof` | `note:hit` beam | −26.5 | Pop, noise puff and power-down sweep under the zap |
| `sparkle` | Perfect layer | −27 | Harmonic FM bell partials (2, 3, 4, 6 × tonic) staggered across the stereo field, glitter |
| `glint` | Great layer | −32 | Two short tonic partials |
| `badcut` | `note:badcut` | −24 | Struck-plate partials with a 9 % pitch-down, low-passed: corrective, not an alarm |
| `miss` | `note:miss`, at most one per `SFX_MISS_MIN_GAP_MS` | −34 | Soft low dud; must not punish |
| `wallWarn` | `obstacle:spawn`; peaks when the wall arrives | −27 | Rising pink-noise band, accelerating 72 Hz throb, rising saw |
| `wallHit` | `obstacle:hit` | −21.5 | Driven low impact and a shield buzz a fifth apart |
| `dodge` | `obstacle:dodged` | −25.5 | Falling band "pass-by" whoosh with a small tonic bell |
| `combo` | `combo:change`, multiplier increases | −21 | FM bell arpeggio root–fifth–octave, transposed per ladder step |
| `milestone` | Combo 10/25/50/100, then every 100 | −19 | Power-chord pad, bell arpeggio, glitter, sub |
| `comboBreak` | Break from ≥ `SFX_BREAK_MIN_COMBO` (not Calm) | −34 | Soft falling filtered saw |
| `drop` | `music:event` drop, on its chart time | −15 | Sub impact, wide crash and rising shimmer; music ducks |
| `count` / `countGo` | Confident-tempo countdown | −27 / −24.5 | Tuned woodblock; the final digit an octave up |
| `countNeutral` | Low-confidence countdown | −31.5 | Unpitched click; final digit at `SFX_NEUTRAL_GO_RATE` |
| `charge` | Beam charge while pointing | −31.5 | Resonant rising saw/square; a ready ping exactly at `BEAM_CHARGE_MS` |
| `resume` | `PAUSED → PLAYING` | −30 | Rising noise and glide |
| `resultsHigh` / `resultsLow` | `RESULTS` entry: SS/S/A vs lower ranks | −16 / −19 | Major chord swell with bells / open-fifth calm close |
| `uiHover` | New target: mouse hover, keyboard focus-visible, hand pointer | −42 | Short 1.76 kHz blip |
| `uiConfirm` / `uiBack` / `uiSelect` | Menu action that actually ran | −30 / −32 / −32 | Rising fifth / falling fifth / soft pluck |
| `uiArm` | Hand pointer enters `armed` | −36 | Soft rising tone |
| `uiEnable` | Sound unlocked (not on resume) | −24 | Bell triad confirming that output works |

LUFS are BS.1770 momentary (400 ms) levels each render is normalized to (`SFX_LOUDNESS_LUFS`), before the bus and master gain. The in-repo meter agrees with ffmpeg's `ebur128` within 0.1 LU on every render. These are offline measurements; audible balance against each track on real speakers is not yet reviewed.

Playback rules:

1. Each play creates an `AudioBufferSourceNode`, gain and stereo panner, unavoidable one-shot Web Audio allocations. `playbackRate = judgementRate × transposition × jitter`; `SFX_JUDGEMENT_RATE` applies to the gesture sound, ladder/milestone transposition to rewards, and seeded jitter (±`SFX_PITCH_JITTER_CENTS`) only to non-tonal hits. The jitter sequence is reseeded per session so replays are comparable; pitch never affects judgements.
2. Cap each sound at `SFX_POLYPHONY` (or its `SFX_VOICE_LIMITS` override) and all sounds at `SFX_MAX_VOICES`, stealing the oldest with an `SFX_STOP_RAMP_S` ramp; a not-yet-started stolen voice is cancelled outright. Source/gain/panner nodes disconnect on end, on `stop` (including fading voices, even while the context is suspended) and on dispose. Tests repeat song retries.
3. Loudness: renders are normalized to `SFX_LOUDNESS_LUFS` (Calm: `SFX_CALM_LOUDNESS_DB` quieter and low-passed at `SFX_CALM_LOWPASS_HZ`) under a soft-knee `SFX_PEAK_CEILING_DBFS` ceiling. Swing speed adds `SFX_DYNAMICS_DB` (full at `SFX_DYNAMICS_FULL_RATIO` × the gesture minimum), so any single cue stays below the bus limiter (`SFX_LIMITER`: hard knee, −3 dB, 20:1), which catches stacked voices. The bus output is trimmed by the compressor's specified automatic makeup gain so baked levels stay calibrated. The music path has no master limiter; music already near full scale plus SFX can still clip at the destination.
4. Timing: cues with a known chart time are scheduled on the context clock at `startAt + t / 1000 − SFX_LIMITER_LOOKAHEAD_S` (song sample 0 plus chart time, minus the compressor pre-delay): countdown ticks, wall warnings (late spawns start part-way through so the peak still lands on arrival), drop stings (scanned `SFX_LOOKAHEAD_MS` ahead each frame) and hits whose event arrives before the note time by at most `SFX_BEAT_SNAP_MS`. Other capture-time hits sound when the event resolves, so camera/inference delay remains audible; audiovisual skew still needs the [24](24-benchmark-and-evidence.md) measurement. SFX never feed back into scoring.
5. Pause suspends the shared context. At the boundary, voices already sounding are faded; cues scheduled in the future are kept, because the suspended context clock stays locked to song position. There is no pause sting or resume-countdown tick and Paused-screen menu cues are silent, because the context is suspended; `resume` plays once audio runs again. Quit, back, retry and countdown cancellation stop every voice.
6. Tuning: `tonic.ts` correlates a chroma vector from `SFX_TONIC_FRAMES` Hann-windowed `SFX_TONIC_FFT` frames of the selected music with Krumhansl–Kessler key profiles (in the worker; the main thread only copies the frames). Pitched gameplay cues (`sparkle`, `glint`, `dodge`, `combo`, `milestone`, `charge`, `resume`) re-render on that tonic folded into `[SFX_DEFAULT_ROOT_HZ, 2 × SFX_DEFAULT_ROOT_HZ)`; the mode chooses the combo/milestone intervals. Correlation below `SFX_TONIC_MIN_CORRELATION`, silence or unreadable buffers keep the default root. Countdown, results and menu cues keep fixed roots (they play without the track). This is a cosmetic heuristic, not verified key detection.
7. **Ducking on drop:** when the `drop` event fires, `musicGain` dips by `DUCK_DB` over `DUCK_ATTACK_S` and recovers over `DUCK_RELEASE_S` (`AudioPlayer.duck`). No other cue ducks the music.
8. Volume: the bus feeds the shared master gain, so the master volume buttons scale SFX and music together; `SFX_GAIN_DEFAULT` sets the bus level. Nothing plays before the explicit sound unlock.
9. Menu cues: a window bubble-phase `click` listener plays the cue for registered `button[data-target]` actions after the action ran (volume ticks at the new level); accepted hand activations call the director directly. Hover cues are rate limited by `SFX_UI_MIN_GAP_MS`; `audio` itself is silent, and `uiEnable` follows the actual unlock.

## 7. Latency compensation summary

| Source of delay | Measurement | Treatment |
| --- | --- | --- |
| Camera exposure and delivery | Device-dependent; capture metadata may be absent | Valid sensor `tCapture` maps the observed motion to song time. Callback-receipt fallback leaves this delay in the judgement bias; disclose the timestamp source and measure it. |
| Bitmap preparation, inference, result transfer/consumption | Measure separate marks plus `inferenceMs` and input-age distribution | Judge the unique measured sample at its timestamp; accept late results only within the bounded policy in [07](07-hit-detection-and-scoring.md). |
| Audio output latency | Device dependent | Output timestamp correlation; fallback subtracts a reported delay estimate, never double compensates |
| Display delivery (render → photon) | External synchronized recording; rAF pacing alone cannot establish it | Keep cursor prediction visual-only; evaluate perceived rhythmic bias using `inputOffsetMs`. |
| Player perception and movement bias | Measured per trial/player, with configuration disclosed | `inputOffsetMs` slider; [STRETCH] calibration mini-game |
| Suspend/resume boundary | Browser/device dependent | Freeze scoring, await actual transition, re-anchor and reject paused-segment input (§2.2) |
| Performance/audio clock drift | Measure over full track | Refresh correlation and retain segment history (§2.4) |

No measurements exist yet. Timing windows (`WINDOW_*`) and the input offset are playability controls; meeting the tracking-freshness and audiovisual checks still requires the actual evidence in [24](24-benchmark-and-evidence.md).

## 8. Acceptance criteria

- [ ] On the reference setup, loopback/physical recording measures scheduled start and countdown alignment; target error ≤ 5 ms and report measurement uncertainty. API timestamp agreement alone does not prove speaker/display onset.
- [ ] An early-note fixture spawns at negative song time and reaches the hit plane at its actual `note.t`; no countdown input changes score before `PLAYING`. Back/tracking loss on the final digit leaves no music or clicks scheduled, and a fresh attempt uses a new epoch.
- [ ] Low-confidence generation and its cache hit both use the neutral countdown. A slow confident tempo extends preparation enough to schedule every whole-beat digit without placing clicks in the past.
- [ ] Pausing for 10 s and resuming produces no audible jump and `now()` is continuous to within 5 ms of `pausedAtSong`.
- [ ] `now()` and `fromPerformanceTime(performance.now())` use the same output-aligned mapping and agree within timestamp precision; a recorded click-track trial checks real audible alignment at start, middle and end. Test nonzero output latency, missing timestamp API, pause boundaries and positive/negative input offsets.
- [ ] Band energies visibly react to the kick (`low`), vocals (`mid`) and hats (`high`) of the demo tracks; a near-silent intro drives values near 0, a loud chorus near 1 (auto-gain).
- [ ] No audio plays before a user gesture; the Start button explains why if audio is not yet enabled.
- [ ] 20 slash hits in 2 seconds do not clip or stutter (polyphony cap, random pitch, bus limiter), and the music ducks imperceptibly on drops. Voice caps, loudness and peak bounds are unit-tested; audible stacking and the drop duck still need a recorded listening check.
- [ ] All decoding happens before `CALIBRATION` begins; `PLAYING` never awaits a decode.

## Constants required

All constants referenced in this document are defined in the [02 constants table](02-architecture.md#constants).
