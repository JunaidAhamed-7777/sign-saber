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
4. Supported inputs: whatever `decodeAudioData` accepts in Chrome — MP3, WAV, OGG/Vorbis, M4A/AAC, FLAC. Reject files > 60 MB with a UI message ("Use a shorter or more compressed file").
5. Decoding happens in `SELECT` on upload, and bundled tracks decode on `select:start` (both buffers are needed before `CALIBRATION` begins so there is no stall at start).

## 2. SongClock (`audio/songClock.ts`)

```ts
class SongClock {
  constructor(private ctx: AudioContext) {}
  scheduleStart(leadS = 0.15): number;      // returns t0 (ctx time) at which song time 0 plays
  now(): number;                             // song time in ms; frozen while paused; NaN before start
  pause(): void; resume(): void;             // via ctx.suspend()/resume()
  fromPerformanceTime(tPerf: number): number;// maps a performance.now() stamp to song time (ms)
  readonly state: 'idle' | 'running' | 'paused' | 'ended';
}
```

### 2.1 Start

```
t0 = ctx.currentTime + leadS                // 150 ms lead so the scheduled source starts glitch-free
source.start(t0)
songTime(now) = (ctx.currentTime − t0) · 1000
```

`CALIBRATION`'s final countdown digit is scheduled so that it lands exactly at `t0 − 60000 / bpm` ([04](04-state-machine.md#calibration)): the count beats are played as SFX scheduled on the audio clock, not on timers.

### 2.2 Pause and resume

`AudioContext.suspend()` freezes `ctx.currentTime`, so `songTime` freezes with it and resumes seamlessly on `ctx.resume()`. No offset bookkeeping is needed while suspended. Two caveats:

1. `suspend()` and `resume()` are asynchronous. `pause()` sets `state = 'paused'` immediately and records `pausedAtSong = now()`; until the promise resolves, `now()` returns `pausedAtSong`. `resume()` likewise returns `pausedAtSong` until `ctx.state === 'running'` and `ctx.currentTime` has advanced.
2. Some browsers leak a few ms of `currentTime` across suspend/resume. After resume, compute `drift = now() − pausedAtSong` on the first running frame and fold it into a `pauseOffsetMs` subtracted from all future `now()` so the song time stays continuous with what the player heard.

The `RESUME_COUNTDOWN_MS` overlay runs *before* `ctx.resume()` is called, on wall-clock time, so the music restarts exactly when the count hits zero.

### 2.3 End

`source.onended` → `state = 'ended'`; the game waits `SONG_TAIL_MS` for trailing notes ([04](04-state-machine.md#transitions)). `now()` keeps advancing past `durationMs` from the context clock (the context is not suspended) so the tail is measured correctly.

### 2.4 Mapping tracking timestamps to song time

Tracking frames carry `tCapture` in the `performance.now()` domain ([05 §1.2](05-tracking-pipeline.md#12-frame-callback-and-centre-crop)); judgements need song time ([07 §3](07-hit-detection-and-scoring.md#3-hit-zone-and-timing-error)).

```
on scheduleStart (and again on every resume, after drift correction):
  anchorPerf = performance.now(); anchorSong = now()
fromPerformanceTime(tPerf) = anchorSong + (tPerf − anchorPerf) − pauseAdjust
```

- Both clocks are monotonic and nominally run at the same rate; re-anchoring on every resume bounds any drift to the length of one unpaused segment (minutes), over which `performance.now()` vs the audio clock differ by well under 1 ms.
- `AudioContext.getOutputTimestamp()` returns a `{ contextTime, performanceTime }` pair that is the most accurate anchor when available; use it in preference to the two separate reads above, falling back if it returns `undefined` fields.
- `outputLatency` (`ctx.outputLatency`, seconds, Chrome) is the delay between `currentTime` and sound leaving the speakers (typically 10–40 ms). Add `ctx.outputLatency · 1000` to `anchorSong` so song time means "what the player is hearing", not "what the DAC was fed". If undefined, use `ctx.baseLatency` or 0.

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
  rawRms = sqrt(mean over time-domain (getFloatTimeDomainData) of x²) · 3   (clamped 0..1)
```

Smoothing per band, frame-rate independent (`dt` in seconds):

```
k = 1 − exp(−dt / τ);  τ_release = 0.12 s (≈ ANALYSER_SMOOTH 0.6 at 60 Hz), τ_attack = 0.035 s for `low` (≈ 0.3), 0.08 s for others
value += (raw − value) · (raw > value ? k_attack : k_release)
```

Then auto-gain: each band is divided by a slowly adapting peak (`peak = max(raw, peak · exp(−dt / 4 s))`, floor 0.15) so quiet songs still drive full-range visuals. Output is `BandEnergies { low, mid, high, rms }` in 0..1, read by the renderer every frame ([10](10-rendering-silhouette.md), [13](13-rendering-environment-camera-postfx.md)).

The analyser is also running (on the preview source) in `SELECT` so the attract scene's silhouette edge reacts to a track preview if the user plays one.

## 5. Autoplay policy

Browsers block audio until a user gesture. Rules:

1. Create the `AudioContext` lazily on the first `pointerdown` / `keydown` anywhere in `SELECT` (the user must click to pick a song anyway). Until then the `SongClock` is `idle` and the Start button is disabled with a hint if `ctx.state !== 'running'`.
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

1. Each play creates an `AudioBufferSourceNode`; `playbackRate = 2^(cents/1200)` with `cents` uniformly random in ±69 (≈ ±4 %) so repeated hits do not machine-gun. Judgement adds a deterministic shift: Perfect +3 %, Great 0, Good −3 %.
2. Per-sound polyphony cap: 6 simultaneous instances; the oldest is stopped (`stop()` with a 10 ms gain ramp) when exceeded.
3. **Ducking on drop:** when the `drop` sting plays, `musicGain` ramps from 0 dB to −1.5 dB over 30 ms and back over 400 ms (`setTargetAtTime`). The dip makes the impact feel bigger without being audible as a volume change.
4. SFX scheduling uses `source.start(ctx.currentTime)` immediately; triggers come from game events in the same frame as the visual, so audio and visual onset differ by at most one frame plus `outputLatency`.
5. Master volume and SFX volume (two sliders in the settings drawer, persisted) map linearly to gain; master default 0.8, SFX default 1.0.

The results screen sting (`RESULTS` entry) is a 2-second `results.ogg` played once on the SFX bus — not in the table above because it is cosmetic and `[POLISH]`.

## 7. Latency compensation summary

| Source of delay | Size | Compensated by |
| --- | --- | --- |
| Camera exposure/delivery + bitmap + inference + transfer | 70–130 ms | Judging on `tCapture` (not arrival) via `fromPerformanceTime` |
| Audio output latency (`outputLatency`) | 10–40 ms | Added to the song-time anchor so "song time" is what is heard |
| Display latency (render → photon) | 16–33 ms | Not compensated directly; folded into the player's `inputOffsetMs` |
| Player reaction / perception bias | ±50 ms, personal | `inputOffsetMs` slider; [STRETCH] mini-game |
| Suspend/resume clock leak | 0–5 ms | Drift fold-in after resume (§2.2) |
| `performance.now()` vs audio clock drift | ≪ 1 ms/min | Re-anchor on every resume (§2.4) |

Generous timing windows (`WINDOW_*`) absorb what remains (P3).

## 8. Acceptance criteria

- [ ] A bundled track starts within ±5 ms of the scheduled `t0` (verify by recording the output and the countdown clicks with a loopback or by comparing `getOutputTimestamp` to the first `note.t`).
- [ ] Pausing for 10 s and resuming produces no audible jump and `now()` is continuous to within 5 ms of `pausedAtSong`.
- [ ] `fromPerformanceTime(performance.now())` agrees with `now()` to within 2 ms at any point during a 3-minute song.
- [ ] Band energies visibly react to the kick (`low`), vocals (`mid`) and hats (`high`) of the demo tracks; a near-silent intro drives values near 0, a loud chorus near 1 (auto-gain).
- [ ] No audio plays before a user gesture; the Start button explains why if audio is not yet enabled.
- [ ] 20 slash hits in 2 seconds do not clip or stutter (polyphony cap, random pitch), and the music ducks imperceptibly on drops.
- [ ] All decoding happens before `CALIBRATION` begins; `PLAYING` never awaits a decode.

## Constants required

All constants referenced in this document are defined in the [02 constants table](02-architecture.md#constants).
