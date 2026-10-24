# 15 — Audio Playback & Sync

Scope: `audio/` — decoding, the `SongClock` that every other subsystem reads time from, playback and pause, the mapping between tracking timestamps and song time, the `AnalyserNode` band energies that drive reactive visuals, autoplay policy, and the SFX bus. The beatmap generator's offline analysis is in [08](08-beatmap-generation.md); it only borrows the decoder from here.

Design basis: [ADR-010](03-decisions.md#adr-010--audio-clock-is-the-master-clock) — the Web Audio clock is the master clock. Nothing else accumulates song time.

## 1. Decoding (`audio/decode.ts`)

```ts
export async function decodeForPlayback(bytes: ArrayBuffer, ctx: AudioContext): Promise<AudioBuffer>
export async function decodeForAnalysis(bytes: ArrayBuffer): Promise<{ mono: Float32Array; sampleRate: number }>
```

1. **Playback buffer.** `ctx.decodeAudioData(bytes.slice(0))` on the live `AudioContext` (its sample rate is the device's, typically 44.1 or 48 kHz). `.slice(0)` because `decodeAudioData` detaches the buffer and the same bytes are needed for hashing and analysis.
2. **Analysis buffer.** Decode once (any context), then resample and down-mix with an `OfflineAudioContext(1, ceil(duration · ANALYSIS_SR), ANALYSIS_SR)`: create a buffer source with the decoded buffer, connect to destination, `startRendering()`. The result is mono at `ANALYSIS_SR`, which the generator worker receives as a transferred `Float32Array`. Resampling via `OfflineAudioContext` is high quality and runs off the main thread inside the browser.
3. **Hash.** `sourceHash = hex(SHA-256(bytes))` via `crypto.subtle.digest` on the original bytes, before any decode. Used as the beatmap cache key ([09](09-beatmap-format.md)).
4. Inputs are accepted only if the tested browser can decode them; MP3/WAV are the primary fixtures, and OGG/Vorbis, M4A/AAC and FLAC require browser-specific verification. File extensions/MIME types are hints, not proof of a valid file. Reject files above `MAX_UPLOAD_BYTES` before decoding; afterward reject duration outside `[MIN_TRACK_MS, MAX_TRACK_MS]`, non-finite/empty PCM, and `decoded.length · decoded.numberOfChannels · 4 > MAX_DECODED_PCM_BYTES` before creating analysis copies/resampling. Decoded PCM can greatly exceed compressed size. This post-decode bound is **not** a hard cap on the native decoder's peak allocation; catch resource/decode failures, release references and keep SELECT usable. Silence follows the generator's explicit empty-chart path ([08](08-beatmap-generation.md)).
5. Decoding happens in `SELECT` on upload, and bundled tracks decode on `select:start` (both buffers are needed before `CALIBRATION` begins so there is no stall at start).

## 2. SongClock (`audio/songClock.ts`)

```ts
class SongClock {
  constructor(private ctx: AudioContext) {}
  scheduleStart(leadS?: number): number;      // default SONG_START_LEAD_S; returns t0 in context seconds
  now(): number;                             // output-aligned estimated song ms; frozen while paused; NaN before start
  pause(): Promise<void>; resume(): Promise<void>; // asynchronous lifecycle; machine waits for successful completion
  fromPerformanceTime(tPerf: number): number;// maps a performance.now() stamp to song time (ms)
  readonly state: 'idle' | 'running' | 'paused' | 'ended';
}
```

### 2.1 Start

```
t0 = ctx.currentTime + leadS                // 150 ms lead so the scheduled source starts glitch-free
source.start(t0)
graphSongTime = (ctx.currentTime − t0) · 1000  // processing position, not yet speaker output
songTime(now) = fromPerformanceTime(performance.now()) // output-aligned estimate (§2.4)
```

Choose `t0` early enough to schedule the calibration clicks before it; do not choose a 150 ms lead and then try to schedule three beats into the past. `CALIBRATION`'s final countdown digit is scheduled at `t0 − 60 / bpm` in **context seconds** ([04](04-state-machine.md#calibration)). Clicks use the audio clock; the DOM countdown reads the same schedule. Account for enough pre-roll to show/spawn early notes at `note.t − approachMs`; a track starting at 0 cannot show its first block's full approach unless the chart reserves an intro or the clock starts negative.

### 2.2 Pause and resume

`AudioContext.suspend()` freezes its processing clock, but the request and physical output boundary are asynchronous. Freeze scoring/input immediately, await suspension, and record the actual suspended context position and pause reason. `now()` returns the stored pause position while paused. Do not subtract a guessed "leak" from song time while leaving the source at a different sample; that creates a permanent chart/audio offset.

On resume, wait for a running context and a valid fresh output timestamp before re-anchoring the performance mapping; discard old tracking samples and reset measured sweep/charge history. Retain a small history of running-segment anchors so `fromPerformanceTime` never maps a capture from a paused interval into a new segment. If the browser interrupts audio or a resume promise fails, remain `PAUSED` with an explicit enable-audio action. Test real output continuity; do not infer it solely from `ctx.state`.

The `RESUME_COUNTDOWN_MS` overlay runs *before* `ctx.resume()` is called, on wall-clock time, so the music restarts exactly when the count hits zero.

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

The analyser is also running (on the preview source) in `SELECT` so the attract scene's silhouette edge reacts to a track preview if the user plays one.

## 5. Autoplay policy

Browsers block audio until a user gesture. Rules:

1. Create/unlock the live `AudioContext` inside an explicit enable/start/preview action in BOOT or SELECT, never from a background load timer. Unlocking does not itself start music. Until then the `SongClock` is `idle`; Start explains when audio needs enabling. Decode assets through the initialized context or an offline decoding context, before the play session starts.
2. On `select:start`, `await ctx.resume()` and verify `ctx.state === 'running'`; if not, show "Click anywhere to enable audio" and retry on the next gesture.
3. `visibilitychange` → hidden does *not* suspend the context by itself (that would double-pause); the state machine's `pause:request` does.

## 6. SFX bus (`audio/sfx.ts`)

All SFX are short OGG one-shots in `app/public/assets/sfx/`, decoded once at BOOT into `AudioBuffer`s. Graph: `oneShot → sfxGain(per sound) → sfxBus → master`.

| Sound | File | Trigger | Gain (dB) | Notes |
| --- | --- | --- | --- | --- |
| slash | `slash.ogg` | `note:hit` slash | −6 | Whoosh + glassy crack, 250 ms |
| smash | `smash.ogg` | `note:hit` smash | −4 | Low thud + debris, 400 ms |
| poof | `poof.ogg` | `note:hit` beam | −6 | Power-down sweep + pop, 350 ms |
| miss | `miss.ogg` | `note:miss` | −10 | Soft low tick, 120 ms — must not punish |
| badcut | `badcut.ogg` | `note:badcut`, `obstacle:hit` | −8 | Metallic clang with pitch-down, 300 ms |
| dodge | `dodge.ogg` | `obstacle:dodged` | −8 | Airy pass-by, 300 ms |
| combo | `combo.ogg` | `combo:change` when multiplier increases | −6 | Rising chime, 500 ms; pitch +2 semitones per ladder step |
| drop | `drop.ogg` | `music:event` kind `drop` | −3 | Sub impact + riser tail, 800 ms |
| count | `count.ogg` | countdown digits | −6 | Short click; the final digit plays `count_go` variant (+5 semitones) |

Playback rules:

1. Each play creates an `AudioBufferSourceNode`, an unavoidable one-shot Web Audio allocation; profile it rather than claiming the browser creates no objects. `playbackRate = 2^(cents/1200) · judgementRate`, with cents limited by `SFX_PITCH_JITTER_CENTS` and `judgementRate = SFX_JUDGEMENT_RATE[judgement]` for note judgements, otherwise 1.
2. Cap concurrent instances at `SFX_POLYPHONY`; evict the oldest with an `SFX_STOP_RAMP_S` gain ramp. Disconnect source/gain nodes on end and clear references; tests must include repeated song retries.
3. **Ducking on drop:** when the `drop` sting plays, `musicGain` ramps from 0 dB to −1.5 dB over 30 ms and back over 400 ms (`setTargetAtTime`). The dip makes the impact feel bigger without being audible as a volume change.
4. SFX scheduling uses the current audio clock as soon as the event resolves. Measure audiovisual onset skew on the target setup; frame scheduling, graph buffering, device output, display latency and late tracking delivery all contribute, so "same frame" is not an end-to-end guarantee. Seed cosmetic pitch jitter in replay capture if stable audiovisual comparisons require it; pitch randomness never affects judgements.
5. Master/SFX volume sliders map to gain and persist validated finite values, initialized from `MASTER_GAIN_DEFAULT` / `SFX_GAIN_DEFAULT`. Clamp their range and mix with enough headroom to pass peak-output checks; polyphony limits alone do not prevent clipping.

The results screen sting (`RESULTS` entry) is a 2-second `results.ogg` played once on the SFX bus — not in the table above because it is cosmetic and `[POLISH]`.

## 7. Latency compensation summary

| Source of delay | Size | Compensated by |
| --- | --- | --- |
| Camera exposure/delivery + bitmap + inference + transfer | 70–130 ms | Judging on `tCapture` (not arrival) via `fromPerformanceTime` |
| Audio output latency | Device dependent | Output timestamp correlation; fallback subtracts a reported delay estimate, never double compensates |
| Display latency (render → photon) | 16–33 ms | Not compensated directly; folded into the player's `inputOffsetMs` |
| Player reaction / perception bias | ±50 ms, personal | `inputOffsetMs` slider; [STRETCH] mini-game |
| Suspend/resume boundary | Browser/device dependent | Freeze scoring, await actual transition, re-anchor and reject paused-segment input (§2.2) |
| Performance/audio clock drift | Measure over full track | Refresh correlation and retain segment history (§2.4) |

Generous timing windows (`WINDOW_*`) absorb what remains (P3).

## 8. Acceptance criteria

- [ ] On the reference setup, loopback/physical recording measures scheduled start and countdown alignment; target error ≤ 5 ms and report measurement uncertainty. API timestamp agreement alone does not prove speaker/display onset.
- [ ] Pausing for 10 s and resuming produces no audible jump and `now()` is continuous to within 5 ms of `pausedAtSong`.
- [ ] `now()` and `fromPerformanceTime(performance.now())` use the same output-aligned mapping and agree within timestamp precision; a recorded click-track trial checks real audible alignment at start, middle and end. Test nonzero output latency, missing timestamp API, pause boundaries and positive/negative input offsets.
- [ ] Band energies visibly react to the kick (`low`), vocals (`mid`) and hats (`high`) of the demo tracks; a near-silent intro drives values near 0, a loud chorus near 1 (auto-gain).
- [ ] No audio plays before a user gesture; the Start button explains why if audio is not yet enabled.
- [ ] 20 slash hits in 2 seconds do not clip or stutter (polyphony cap, random pitch), and the music ducks imperceptibly on drops.
- [ ] All decoding happens before `CALIBRATION` begins; `PLAYING` never awaits a decode.

## Constants required

All constants referenced in this document are defined in the [02 constants table](02-architecture.md#constants).
