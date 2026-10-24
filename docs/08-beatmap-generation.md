# 08 — Beatmap Generation

**Dynamic arrangements:** `audio/arrange.ts` selects one continuous source window using measured energy/onset evidence: 10 s raised-cosine amplitude fade-in, 60 s highlight and 10 s fade-out for sources at least 80 s long. It does not claim chorus detection or human judgement of the “best” part. Confident beat alignment is supported; missing confidence remains disclosed. Short sources scale the parts proportionally and report actual duration. One continuous window makes the joins sample-continuous; no unrelated phrases are pasted across a hidden hard cut. Actual derivative float32 WAV/PCM hashes and source/sample/fade bounds are retained in the edit receipt. A fresh chart is generated from that edited audio; old note times are never shifted under it.


**Implementation checkpoint (generator v4):** DSP, assignment, validation, upload cancellation and grouped caching are implemented and tested. v3 replaced onset-per-note assignment with salience selection under readability caps, phrase rests, a per-phrase gesture mix and a per-hand recovery budget (§9). v4 adds a fine beat-period search (§5): Electro Cabello (117.0 BPM, confidence 0.496) and Cipher (150.0 BPM, 0.558) now produce confident beat-snapped maps; Pamgaea (94.0 BPM, 0.252) remains a disclosed onset-only map because its strong onsets are mostly syncopated against the beat. Held-out musical F1, comfort and performance targets are not yet established.

The implemented onset path gates raw spectral novelty and local RMS rise before percentile normalization, refines each onset to a supported positive PCM-power derivative within the FFT half-window, and anchors nearby tracked beats to those supported sample-zero-relative onsets. Tempo octave selection retains the BPM prior and refines period from supported long onset spans. Analysis resampling uses a registered windowed-sinc kernel; browser tests exposed unacceptable aliasing from the earlier native AudioBufferSourceNode resampling path.

Sustained mid/high beam candidates reserve real measured onsets and an isolation zone before other notes are chosen (§9.2). All final chord groups, density, on-screen and hand-recovery constraints pass the shared validator. Canonical decoding honours iTunSMPB gapless trim before analysis; gameplay applies no compensating second offset.

**Measured effect of v3/v4 on the bundled charts** (`node scripts/chart-report.mjs`; unplayable = notes the synthetic performer's two hands cannot reach under the game's contact rules):

| Chart | v2 notes (slash/smash/beam) | v2 unplayable | v4 notes (slash/smash/beam) | v4 unplayable |
| --- | --- | --- | --- | --- |
| Pamgaea Easy | 133 (76/51/6) | 0 | 89 (45/34/10) | 0 |
| Pamgaea Normal | 269 (122/140/7) | 2 (0.7%) | 178 (97/69/12) | 0 |
| Pamgaea Hard | 426 (258/161/7) | 59 (13.8%) | 230 (112/100/18) | 0 |
| Electro Cabello Easy | 172 (88/84/0) | 0 | 117 (57/51/9) | 0 |
| Electro Cabello Normal | 329 (9/320/0) | 23 (7.0%) | 176 (104/64/8) | 0 |
| Electro Cabello Hard | 578 (168/410/0) | 149 (25.8%) | 281 (132/135/14) | 0 |
| Cipher Easy | 166 (95/60/11) | 0 | 111 (59/41/11) | 0 |
| Cipher Normal | 310 (112/183/15) | 6 (1.9%) | 195 (98/82/15) | 0 |
| Cipher Hard | 405 (179/211/15) | 56 (13.8%) | 266 (108/140/18) | 0 |

Average density fell from 0.7–0.9 / 1.3–1.7 / 1.8–3.0 notes per second (Easy/Normal/Hard) to 0.5–0.6 / 0.8–1.1 / 1.2–1.5, and at most 3/4/5 notes share the screen. These are algorithmic and synthetic-performer results, not human comfort or musical-quality evidence.

The generator turns an audio file into a `BeatmapV1` ([09](09-beatmap-format.md)) with no human authoring. Pillar P4 (*the music is the author*) means notes follow musical evidence, density/reach constraints keep them playable, and silence is rejected. Noisy or beatless material may be unsuitable; show uncertainty rather than manufacturing a convincing tempo.

**Status: planned implementation.** The TypeScript DSP runs in `beatmap/generator.worker.ts`. Identical canonical PCM, metadata, difficulty and `GENERATOR_VERSION` must yield identical output. Browser-native lossy decode/resampling can vary across engines, so byte-identical maps from MP3 bytes on every browser are not promised. Cross-runtime regression tests use canonical PCM; evaluation hashes both source audio and PCM. [24](24-benchmark-and-evidence.md) defines the proof protocol.

```
audio bytes ──► decode ──► mono @ ANALYSIS_SR ──► STFT ──► band flux ──► onsets
                                                      │                     │
                                                      ├──► energy envelope  ├──► tempo ──► beats ──► snap
                                                      │        │            │                        │
                                                      ▼        ▼            ▼                        ▼
                                                   sections/events ◄──── assign (notes, obstacles) ◄─┘
                                                                              │
                                                                              ▼
                                                                validateBeatmap → cache → BeatmapV1
```

Module layout:

| File | Stage |
| --- | --- |
| `beatmap/generator.worker.ts` | Worker entry: protocol, orchestration, progress |
| `beatmap/dsp/resample.ts` | Stage 1 helpers (runs on main thread, see §1) |
| `beatmap/dsp/fft.ts` | Radix-2 FFT |
| `beatmap/dsp/stft.ts` | Framing, windowing, log-magnitude |
| `beatmap/dsp/flux.ts` | Band spectral flux |
| `beatmap/dsp/peaks.ts` | Onset peak picking |
| `beatmap/dsp/tempo.ts` | Autocorrelation tempo estimate |
| `beatmap/dsp/beats.ts` | DP beat tracker, snapping |
| `beatmap/dsp/energy.ts` | RMS envelope, sections, music events |
| `beatmap/assign.ts` | Notes + obstacles from onsets |
| `beatmap/cache.ts` | IndexedDB cache |
| `beatmap/validate.ts` | From [09](09-beatmap-format.md) |

All constants (`ANALYSIS_SR`, `FFT_SIZE`, `HOP`, `BAND_EDGES_HZ`, `ONSET_DELTA`, `ONSET_MIN_GAP_MS`, `ONSET_MIN_STRENGTH`, `BPM_MIN`, `BPM_MAX`, `BPM_PRIOR`, `BEAT_TIGHTNESS`, `SNAP_GRID`, `SNAP_MAX_MS`, `MAX_DENSITY_PER_S`, `MIN_NOTE_GAP_MS`, `MIN_SAME_CELL_GAP_MS`, `MIN_OBSTACLE_GAP_MS`, `MIN_OBSTACLE_MS`, `MAX_OBSTACLE_MS`, `DROP_RISE_RATIO`, `DROP_MIN_BUILD_MS`, `ENERGY_HOP_MS`, `GENERATOR_VERSION`, `BEAM_ISOLATION_MS`, `APPROACH_MS`) come from [02 §Constants](02-architecture.md#constants). Derived quantities used below:

- Frame rate of the analysis: `FRAME_HZ = ANALYSIS_SR / HOP = 43.07 frames/s`; one frame = `HOP_MS = 23.22 ms`.
- Frame index ↔ time: `tMs(n) = n · HOP_MS` (the window is centred by padding `FFT_SIZE/2` zeros at the start so frame `n` is centred on sample `n·HOP`).

**Registry policy:** [02 §Constants](02-architecture.md#constants) supplies a named initial default for every tunable used below. These are proposed design values, not measurements; P2 calibrates them on development fixtures, commits any changed defaults with `GENERATOR_VERSION`, then freezes them before held-out evaluation. Implementation exports the registered names from `core/constants.ts`; subsystem literals and an extra tuning registry are forbidden. `FRAME_HZ`, `HOP_MS`, bin ranges, loop bounds and seconds↔milliseconds conversions are derived. FFT radix, Hann coefficients, the v1 grid topology, two-member chord limit and one-decimal BPM representation are structural algorithm/schema choices rather than adjustable knobs. In the pseudocode, `ε = DSP_EPSILON`.

## 1. Decode, mono mix, resample

Decoding needs an `AudioContext`, which is unavailable in workers in some browsers, so stage 1 runs on the **main thread** in `audio/decode.ts` and the result (a single `Float32Array`) is transferred to the worker.

```ts
async function prepareForAnalysis(bytes: ArrayBuffer): Promise<{ mono: Float32Array; sr: number; durationMs: number }> {
  const ctx = getSharedAudioContext();                     // the game's AudioContext (sr = device rate)
  const buf = await ctx.decodeAudioData(bytes.slice(0));   // slice: decodeAudioData detaches the buffer
  const durationMs = buf.duration * 1000;
  // Mono mix + resample in one OfflineAudioContext render.
  const frames = Math.ceil(buf.duration * ANALYSIS_SR);
  const off = new OfflineAudioContext(1, frames, ANALYSIS_SR); // 1 channel → browser down-mixes (L+R)/2
  const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start(0);
  const rendered = await off.startRendering();
  return { mono: rendered.getChannelData(0), sr: ANALYSIS_SR, durationMs };
}
```

Rules:

0. Reject files above `MAX_UPLOAD_BYTES` before decoding. After native decode, reject duration above `MAX_TRACK_MS` or `length * numberOfChannels * Float32Array.BYTES_PER_ELEMENT > MAX_DECODED_PCM_BYTES`; release the result before analysis/resampling. These planned defaults are five minutes and 128 MiB. Native decode allocates first, so this is not a hard guarantee on decoder peak memory; catch resource failures, use trustworthy metadata for early rejection where available, and keep SELECT recoverable. Compressed bytes alone do not bound PCM.
1. Stage 1 returns raw resampled mono. At worker startup, preserve its RMS envelope at `ENERGY_HOP_MS` before normalising to `ANALYSIS_PEAK_TARGET` (`gain = ANALYSIS_PEAK_TARGET / max|x|`). If `max|x| < SILENCE_PEAK_MAX`, fail as silent (§14). The raw envelope supplies the local `ONSET_RAW_RMS_MIN` gate; it must not be measured after normalisation has amplified noise. Playback PCM is never modified by analysis gain.
2. Files shorter than `MIN_TRACK_MS` → failure `tooShort`.
3. `sourceHash` is SHA-256 of the *original* bytes (`crypto.subtle.digest`), computed on the main thread before decode, so the cache lookup (§11) happens before any DSP.

Planning estimates, not measurements: decode 0.3–0.8 s and offline resampling about 0.1 s for a three-minute MP3. Measure them separately from DSP. [`decodeAudioData`](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData) consumes complete encoded data and resamples to the context rate. Keep playback PCM separate from analysis transfers and retain bytes until hashing completes. Test antiphase stereo, whose mono mix may cancel; reject or warn rather than fabricate notes.

## 2. STFT

### 2.1 Radix-2 FFT (`dsp/fft.ts`)

In-place iterative Cooley–Tukey on interleaved-free split arrays. `FFT_SIZE` is a power of two, so no fallback is needed.

```ts
export class FFT {
  private readonly rev: Uint32Array;     // bit-reversal table
  private readonly cos: Float32Array;    // twiddles, length n/2
  private readonly sin: Float32Array;
  constructor(readonly n: number) {
    const bits = Math.log2(n) | 0;
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) { let r = 0, x = i; for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; } this.rev[i] = r; }
    this.cos = new Float32Array(n / 2); this.sin = new Float32Array(n / 2);
    for (let k = 0; k < n / 2; k++) { this.cos[k] = Math.cos(-2 * Math.PI * k / n); this.sin[k] = Math.sin(-2 * Math.PI * k / n); }
  }
  /** re, im: length n, modified in place. im is all-zero on input for real signals. */
  transform(re: Float32Array, im: Float32Array): void {
    const n = this.n;
    for (let i = 0; i < n; i++) { const j = this.rev[i]!; if (j > i) { let t = re[i]!; re[i] = re[j]!; re[j] = t; t = im[i]!; im[i] = im[j]!; im[j] = t; } }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0, tw = 0; k < half; k++, tw += step) {
          const i = start + k, j = i + half;
          const wr = this.cos[tw]!, wi = this.sin[tw]!;
          const xr = re[j]! * wr - im[j]! * wi, xi = re[j]! * wi + im[j]! * wr;
          re[j] = re[i]! - xr; im[j] = im[i]! - xi;
          re[i] = re[i]! + xr; im[i] = im[i]! + xi;
        }
      }
    }
  }
}
```

Unit test on the unwindowed FFT: a real sine at bin `k` has conjugate peaks at `k` and `n-k`, each about `n/2`, with <1% leakage elsewhere. The retained one-sided spectrum contains only `k`. An impulse is flat. Hann-windowed tests account for expected spreading.

### 2.2 Framing and log-magnitude (`dsp/stft.ts`)

```
N        = FFT_SIZE, H = HOP
window   = Hann: w[i] = 0.5 − 0.5·cos(2πi/(N−1))
padded   = zeros(N/2) ++ mono ++ zeros(N/2)
frames   = floor((len(padded) − N) / H) + 1
for n in 0..frames−1:
  re = padded[n·H .. n·H+N] · window ; im = 0
  fft(re, im)
  for k in 0..N/2:  mag[n][k] = log(1 + STFT_LOG_GAIN · sqrt(re[k]² + im[k]²))
```

- Only bins `0..N/2` (1025) are kept; bin `k` is centred at `k · ANALYSIS_SR / N = k · 10.77 Hz`.
- `mag` is a single `Float32Array(frames * (FFT_SIZE/2 + 1))`; the current one-sided bin count is derived, never hard-coded separately.
- Log compression `log(1 + STFT_LOG_GAIN · |X|)` tames dynamic range so quiet hi-hats can contribute alongside the kick.

Cost: 3 minutes → ≈ 7 750 frames × (2048-point FFT ≈ 25 k flops) ≈ 0.2 G flop ≈ 150–300 ms in JS.

## 3. Band spectral flux (`dsp/flux.ts`)

Bands from `BAND_EDGES_HZ`: low 20–150 Hz (bins 2–13), mid 150–2000 Hz (bins 14–185), high 2000–10000 Hz (bins 186–928). Band membership is precomputed once as bin index ranges.

```
for b in {low, mid, high}:
  for n in 1..frames−1:
    SF_b[n] = Σ_{k ∈ bins(b)} max(0, mag[n][k] − mag[n−1][k])      // half-wave rectified
  SF_b[0] = 0
  scale_b = percentile(SF_b, FLUX_NORM_PERCENTILE)                  // copy + sort, once per band
  SF_b   /= max(scale_b, ε)                                        // normalise; values > 1 are allowed
sum[n]  = SF_low[n] + SF_mid[n] + SF_high[n]                       // "onset envelope" used by tempo + beats
```

Half-wave rectification counts energy increases. Per-band normalisation makes relative scales more comparable; it does not prove a peak is musical. Normalised noise can cross drum thresholds. Evaluate noise, hum and quiet-intro negatives explicitly.

## 4. Onset peak picking (`dsp/peaks.ts`)

Applied to each band separately, producing `Onset { t, strength, band }`.

```
W_PRE = ONSET_MEAN_PRE_FRAMES, W_POST = ONSET_MEAN_POST_FRAMES
W_MAX = ONSET_MAX_RADIUS_FRAMES
MIN_GAP = ceil(ONSET_MIN_GAP_MS / HOP_MS)    // never round a minimum downward

for n in max(W_PRE, W_MAX) .. frames − max(W_POST, W_MAX) − 1:
  isLocalMax = SF[n] ≥ SF[m] for all m in [n−W_MAX, n+W_MAX]
  mean       = avg(SF[n−W_PRE .. n+W_POST])
  rawRms     = rawEnergy[min(rawEnergy.length - 1, floor(tMs(n) / ENERGY_HOP_MS))]
  passes     = isLocalMax && SF[n] ≥ mean + ONSET_DELTA
               && SF[n] ≥ ONSET_MIN_STRENGTH && rawRms ≥ ONSET_RAW_RMS_MIN
  if passes && (lastOnsetFrame is unset || (n − lastOnsetFrame) ≥ MIN_GAP):
     strength = clamp(SF[n], 0, 1)        // SF uses FLUX_NORM_PERCENTILE
     emit { t: tMs(n), strength, band }
     lastOnsetFrame = n
  else if passes && lastOnsetFrame is set && SF[n] > SF[lastOnsetFrame]:
     replace the last onset with this one   // keep the stronger of two onsets closer than MIN_GAP
```

The asymmetric window compares an onset to recent history. `ONSET_MIN_STRENGTH` is relative; `ONSET_RAW_RMS_MIN` rejects weak local evidence before gain. Neither proves musicality. The temporal-support/confidence gate in §5 is also required, and noise/ambient fixtures must pass the independent quality evaluation. Never lower thresholds silently to make every file appear successful.

Output: `onsetsByBand: Record<Band, Onset[]>` and `allOnsets` merged and sorted by `t`.

## 5. Tempo estimation (`dsp/tempo.ts`)

Input: `sum[n]` (the summed onset envelope), locally normalised first to remove slow dynamics:

```
env[n] = max(0, sum[n] − movingAverage(sum, TEMPO_DETREND_FRAMES)[n])
```

Autocorrelation over the lag range corresponding to `BPM_MIN..BPM_MAX`:

```
lagMin = round(60 · FRAME_HZ / BPM_MAX)     // 200 BPM → 12.9 frames
lagMax = round(60 · FRAME_HZ / BPM_MIN)     //  60 BPM → 43.1 frames
for L in floor(lagMin/2)..ceil(2*lagMax):   // include harmonic support lags
  ac[L] = Σ_n env[n] · env[n+L]  /  (frames − L)
for L in lagMin..lagMax:                  // tempo candidates remain in range
  bpm(L) = 60 · FRAME_HZ / L
  prior(L) = exp( −0.5 · ( log2(bpm(L) / BPM_PRIOR) / TEMPO_PRIOR_SIGMA_OCT )² )
  score[L] = ac[L] · prior(L)
```

Sub-frame refinement: fit a parabola only when neighbouring scores are defined and the denominator is non-degenerate; otherwise keep the integer winner. Clamp the refined candidate to `BPM_MIN..BPM_MAX`. Candidate period `T = L* frames`, `bpm = 60 · FRAME_HZ / L*`.

**Octave disambiguation.** Consider `T/2` and `2T` only when BPM remains in range. Compare `ac(T) + TEMPO_HARMONIC_WEIGHT * (ac(2T) + ac(T/2))` using defined interpolation neighbours; compute required support lags before lookup. Switch only when `alternativeSum ≥ winnerSum * TEMPO_OCTAVE_SWITCH_RATIO`; ties choose closest to `BPM_PRIOR`, then the smaller lag.

**Fine period search.** Autocorrelation and span refinement work in whole or interpolated STFT hops (23.2 ms). A period off by a few hundredths of a BPM keeps local beats but makes a song-long grid drift by more than `SNAP_MAX_MS` within a minute, and syncopated onsets bias the span refinement. The final period is therefore searched in steps of `TEMPO_REFINE_STEP` within ±`TEMPO_REFINE_RANGE` of the refined estimate. Each candidate scores the number of supported onsets within ±`SNAP_MAX_MS` of its best rigid-grid phase (`gridAlignment`, a circular two-pointer count). The tolerance makes the maximum a plateau; the plateau's middle is taken, and ties between plateaus keep the one closest to the estimate. On the bundled songs this moved 94.1 → 94.0, 117.2 → 117.0 and 150.8 → 150.0 BPM, matching the publisher's catalog tempi (94/117/150), which the search does not use. A syncopated 117 BPM synthetic click test fails without the search (117.2 BPM, low confidence) and passes with it. The search maximises the same alignment the confidence uses, so it carries a small upward selection bias; the catalog agreement is the independent check for the bundled tracks, not a general accuracy result.

**Confidence.**

```
support = onsets whose strength ≥ TEMPO_SUPPORT_MIN_STRENGTH,
          merged into anchored CHORD_WINDOW_MS groups for distinct event times
peakContrast = clamp((score[L*] − median(score)) / (score[L*] + ε), 0, 1)
alignmentSupport = fraction of support close to the best-phase beat grid
confidence = support.length < TEMPO_MIN_SUPPORT_ONSETS ? 0 : min(peakContrast, alignmentSupport)
```

Calculate alignment support within ±`SNAP_MAX_MS` after §6, excluding silence. Zero/degenerate envelopes or too few strong onsets yield zero confidence. `(best-median)/(max-median)` would be approximately one whenever best equals max and cannot establish confidence. Calibrate the replacement score on development clips, then freeze it before held-out tests. `tempoConfidence < TEMPO_MIN_CONFIDENCE` takes §14's fallback. This score is not a statistical probability.

Unit test (§16): a synthetic click track at 128 BPM MUST yield 128 ± 1.

## 6. Beat tracking (`dsp/beats.ts`)

[Ellis (2007)](https://www.ee.columbia.edu/~dpwe/pubs/Ellis07-beattrack.pdf) dynamic programming over `O[n] = env[n]` with target period `T` (fractional frames; the search uses integer lags).

```
tightness = BEAT_TIGHTNESS                         // 100
lo = max(1, round(BEAT_MIN_PERIOD_FACTOR · T))
hi = max(lo, round(BEAT_MAX_PERIOD_FACTOR · T))
C[n]   = −∞ for all n ; C[n] = O[n] for n in 0..lo−1 (no predecessor)
P[n]   = −1                                        // backpointer

for n in lo .. frames−1:
  best = −∞, arg = −1
  for τ in n−hi .. n−lo:                             // τ = previous beat frame
    if τ < 0: continue
    penalty = −tightness · ( log((n − τ) / T) )²     // natural log; 0 when interval == T
    v = C[τ] + penalty
    if v > best: best = v, arg = τ
  C[n] = O[n] + best
  P[n] = arg
```

Backtracking:

```
start = argmax over n in [frames − hi, frames−1] of C[n]       // best final beat near the end
beats = []
n = start
while n ≥ 0: beats.push(n); n = P[n]
beats.reverse()
```

Post-processing:

1. Convert to ms: `beatMs = tMs(n)`.
2. Trim beats before `firstOnset - BEAT_EDGE_PAD_PERIODS * period` and after `lastOnset + BEAT_EDGE_PAD_PERIODS * period`; a DP extension into silence must not produce a misleading pulse.
3. `intervals = diff(beatMs)`; `bpm = round(60000 / median(intervals), 1)`.
4. `beatOffsetMs`: fit a phase in `[0, 60000/bpm)` using circular distance. Deterministically search candidate beat phases, with ties to the smallest phase. A linear median of modulo phases fails across zero. This offset is a grid phase, not necessarily the first tracked beat.
5. `analysis.beats` keeps the *tracked* beats (not the grid), so tempo drift in live recordings is visible.

Complexity: `frames × (hi − lo)` ≈ 7 750 × 32 ≈ 250 k inner iterations → < 10 ms.

Why DP and not "nearest grid line": the DP tolerates tempo drift and gaps (breakdowns with no onsets) while still enforcing regularity through `tightness`; a rigid grid phase-locked at the start drifts out of alignment on any non-click-tracked recording.

## 7. Grid snapping — "only valid beats"

The grid has resolution `SNAP_GRID = 4` subdivisions per beat (sixteenths). Grid lines are generated from the **tracked beats**, not the perfect grid: between consecutive tracked beats `b_i, b_{i+1}` the lines are `b_i + j · (b_{i+1} − b_i) / SNAP_GRID`, `j = 0..3`.

```
for onset in allOnsets:
  g = nearestGridLine(onset.t)
  d = |onset.t − g|
  if d ≤ SNAP_MAX_MS:
     onset.t = g; onset.snapped = true; keep
  else if onset.strength ≥ UNSNAPPED_MIN_STRENGTH:
     keep as-is; onset.snapped = false          // strong syncopation (e.g. a real off-grid hit) is musical, keep it
  else:
     drop                                        // weak + off-grid = noise
```

Two onsets that snap to the same grid line in the same band are merged (max strength). After snapping, onsets closer than `ONSET_MIN_GAP_MS` across bands are *kept* (they become chords in §9) — the gap rule in §4 is per band.

Internally, a **validated onset** survives §7. Report `valid / detected` as a diagnostic, never beat accuracy: the generator can agree with its own incorrect grid. External accuracy uses independent annotations (§15 and [24](24-benchmark-and-evidence.md)).

## 8. Energy envelope and sections (`dsp/energy.ts`)

### 8.1 RMS envelope

```
hopSamples = ANALYSIS_SR · ENERGY_HOP_MS / 1000          // 2205
for i: rms[i] = sqrt( mean( mono[i·hop .. (i+1)·hop]² ) )
energy = rms / max(percentile(rms, ENERGY_NORM_PERCENTILE), ε) clamped to 0..1
smoothFrames = max(1, ceil(SECTION_SMOOTH_MS / ENERGY_HOP_MS))
smooth = movingAverage(energy, smoothFrames)  // → section logic
```

### 8.2 Events

| Event | Rule |
| --- | --- |
| `kick` | Low-band onset `strength ≥ KICK_MIN_STRENGTH`; minimum `KICK_MIN_GAP_BEATS * beatPeriod` between events. Intensity is onset strength. |
| `drop` | `smooth[t] ≥ DROP_RISE_RATIO * windowMean` and `smooth[t] ≥ DROP_MIN_ENERGY`; baseline is `[t-DROP_MIN_BUILD_MS, t-DROP_BASELINE_END_MS]` and its maximum must not exceed `smooth[t]/DROP_RISE_RATIO`. Require a complete baseline, snap to nearest tracked beat, and keep ≥`DROP_MIN_GAP_MS` between events. Intensity is `clamp((smooth[t]-windowMean)/max(windowMean,ε),0,1)`. |
| `build` | A `BUILD_WINDOW_MS` span rises by ≥`BUILD_MIN_RISE`; at most `BUILD_MAX_DIPS` adjacent-sample decreases, each <`BUILD_MAX_DIP_DEPTH`. Its end is followed by a drop within `BUILD_DROP_LOOKAHEAD_MS`. Emit at the window start; intensity is total rise, clamped to `[0,1]`. |
| `calm` | A ≥`CALM_WINDOW_MS` span stays below `percentile(smooth,CALM_PERCENTILE)`. Emit at its start, snap to nearest tracked beat and keep ≥`CALM_MIN_GAP_MS` separation. Intensity is `clamp(1-smooth/max(calmCeiling,ε),0,1)`. |

Events are sorted into `BeatmapV1.events`. Guard divisions by zero, clamp finite intensities, and deduplicate overlapping section candidates. A near-zero baseline must not turn silence into a drop. These are heuristic visual cues, not verified structure annotations.

## 9. Note assignment (`assign.ts`)

**Generator v3.** A chart follows the strongest measured accents, not every onset. Earlier versions converted almost every surviving onset into a note, which filled the screen, gave Electro Cabello Normal 320 smashes to 9 slashes and left notes neither hand could reach (synthetic performer: up to 25.8% on Electro Cabello Hard). v3 selects events by salience under hard readability caps, mixes gestures per phrase and budgets each hand's recovery. Every note still carries the timestamp of a real onset; removals never invent or move evidence.

Input: snapped (or onset-only) onsets per band, tracked beats, per-frame centroid, linear band power, the normalized energy envelope, difficulty.

### 9.1 Musical events

Onsets are grouped into anchored `CHORD_WINDOW_MS` events (one broadband transient is one event). Each event keeps:

- `primary`: its strongest member (ties prefer low, then mid, then high band);
- `partner`: the strongest different-band member at a *distinct* instant, the only evidence a two-note chord may use;
- `salience = primary.strength + 0.25 · secondBand.strength`: multi-band transients read as accents;
- `sustained`: the most sustained mid/high member. Sustain is the dB variation of that member's own linear band power over `BEAM_SUSTAIN_MS`. A member qualifies when it is ≤ `BEAM_SUSTAIN_DB`, or when it lies within the song's `BEAM_SUSTAIN_PERCENTILE` most sustained mid/high onsets **and** ≤ `BEAM_SUSTAIN_MAX_DB`. The relative rule exists because pumped electronic mixes (Electro Cabello: lowest mid variation 8.2 dB) have no flat 3 dB sustain; the ceiling stops arbitrary transients from becoming beams. A beam keeps the sustained member's own time.

### 9.2 Selection under readability caps

Walls are planned first (§10). Beams are then reserved: sustained events sorted by how few other events lie within ±`BEAM_ISOLATION_MS` (sparse, held accents first), then salience, at most one per `BEAM_MIN_SPACING_MS[difficulty]`. All remaining events are tried strongest first. A candidate is accepted only if, with it inserted:

| Rule | Bound |
| --- | --- |
| Gap to each neighbouring note group | `MIN_NOTE_GAP_MS[d] / (DENSITY_ENERGY_FLOOR + (1 − DENSITY_ENERGY_FLOOR) · e)`, `e` = energy smoothed over `DENSITY_ENERGY_SMOOTH_MS`, larger of the two notes' local values |
| Beam neighbours | more than `BEAM_ISOLATION_MS` (+ `CHORD_WINDOW_MS` for a trailing chord partner) on both sides |
| Sliding density | at most `floor(MAX_DENSITY_PER_S[d] · DENSITY_WINDOW_MS / 1000)` notes in any half-open window; a chord counts two |
| Simultaneously on screen | at most `MAX_VISIBLE_NOTES[d]` notes in any `APPROACH_MS[d]` span |
| Two-hand budget | the note two contacts earlier (a chord occupies both hands) is at least the worst-case same-hand gap (§9.4) away |
| Wall span | Easy: no notes; Normal/Hard: no chord, consecutive notes need the single-hand gap |
| Chord | only when `partner` exists, salience ≥ `CHORD_MIN_STRENGTH`, ≥ `CHORD_MIN_SPACING_MS[d]` from another chord; never on Easy |

A rejected chord is retried as a single note. Greedy salience order means weaker onsets only fill room the strong accents leave; quiet passages thin out through the energy term.

### 9.3 Deliberate rests

Walking the selection in time order, a phrase is a run without a note-to-note gap of `PHRASE_REST_MS[d]`. When a phrase would exceed `PHRASE_MAX_MS[d]`, a rest of `PHRASE_REST_MS[d]` is opened after one of its notes in the second half of the phrase, choosing the position that removes the least total salience. Removal is final and only relaxes the other caps.

### 9.4 Gestures and hands

Gesture mix is phrase-local. A non-beam event is smash-eligible when its strongest low-band member has strength ≥ `SMASH_MIN_LOW_STRENGTH`; its low score is `low − 0.5 · max(mid, high)`. Within ±`GESTURE_MIX_WINDOW_MS/2`, the eligible events whose low score ranks inside `max(1, round(SMASH_MAX_SHARE[d] · strikes in window))` become smashes; every other strike is a slash. Strong kicks therefore punch, melodic/high-band accents slash, and a song dominated by low-band onsets still gets slashes.

Each hand plays its own side: left hand columns 0–1, right hand columns 2–3. A contact goes to the hand that has rested longer (ties: `FLOW_RESTART_SIDE`), inside a wall span to the open hand only. A hand may take a note only if

```
t − previous.t ≥ FLOW_HAND_FOLLOW_MS[kind(previous)] + FLOW_HAND_LEAD_MS[kind(next)]
                 + (previous.type ≠ next.type ? FLOW_GESTURE_CHANGE_MS : 0)      // kind: beam | strike
```

otherwise the other hand is tried and the note is dropped if neither fits. Defaults give 620 ms between same-hand strikes, 700 ms with a gesture change and about one second before a beam, matching the time the synthetic performer ([17](17-testing-and-qa.md)) needs to recover, travel, settle outside the judgement window and stroke. A chord needs both hands free, otherwise it becomes a single note. The validator enforces the same function (`handGapMs`).

### 9.5 Cells

- Beam: outer column on its hand's side, top row: an occasional far target.
- Smash: inner column; bottom row when the onset centroid is below `CENTROID_ROW_HZ[0]`, else middle.
- Slash: inner column, outer every `FLOW_OUTER_ACCENT_EVERY`th slash on that side when strength ≥ `FLOW_OUTER_ACCENT_MIN_STRENGTH`; top row for high-band evidence or centroid ≥ `CENTROID_ROW_HZ[1]`, else middle.
- A bottom↔top jump within `FLOW_FULL_ROW_JUMP_MIN_GAP_MS` uses the middle row; Easy uses the bottom row at most once per `EASY_LOW_ROW_MIN_GAP_MS`.

Because each hand is on its own side and same-hand gaps exceed `MIN_SAME_CELL_GAP_MS`, two notes never share a lane at the same moment. IDs are assigned last; `dir = 'any'`. These are layout/time rules checked by an automated performer; standing comfort still needs player trials.

## 10. Obstacle placement

Walls are planned before notes on the tracked-beat cadence: every `OBSTACLE_PERIOD_BEATS[d]`th tracked beat after `OBSTACLE_INTRO_MS`, at least `max(OBSTACLE_SPACING_MS[d], MIN_OBSTACLE_GAP_MS)` apart (Easy also `EASY_OBSTACLE_MIN_GAP_MS`), fully inside the song. Occupancy is `clamp(OBSTACLE_DURATION_BEATS[d] · beatPeriod, MIN_OBSTACLE_MS, MAX_OBSTACLE_MS)`. Sides alternate, starting with the wall that makes the player lean toward `FLOW_RESTART_SIDE`.

During `[t − WALL_NOTE_MARGIN_MS, t + durationMs + WALL_NOTE_MARGIN_MS]` Easy has no notes at all; Normal/Hard notes go only to the open side, played by one hand with the single-hand gap. `assignObstacles` keeps each planned wall only if no note lies in its covered columns during that span, so a wall is never unfair.

## 11. Output, validation, cache

```ts
const map: BeatmapV1 = {
  version: 1, generatorVersion: GENERATOR_VERSION,
  song: { title, artist, durationMs, bpm, beatOffsetMs, sourceHash, source },
  difficulty, approachMs: APPROACH_MS[difficulty],
  notes, obstacles, events,
  analysis: { beats, onsets: snappedOnsets, energy },
};
const errors = validateBeatmap(map);
if (errors.length) {
  // The generator MUST produce valid maps; an error here is a generator bug.
  // Development: fail with actionable paths; this is a generator bug.
  // A separately specified removal-only release repair may re-validate once,
  // retaining original failures and a visible warning. Never fabricate valid
  // timestamps, schemas, hashes or non-finite values into apparent success.
}
```

Cache (`beatmap/cache.ts`): IndexedDB `sign-saber`, store `beatmaps`, map key `${sourceHash}:${difficulty}:${GENERATOR_VERSION}`, value `{ map, warnings, createdAt }`. Analysis key `${sourceHash}:analysis:${GENERATOR_VERSION}` stores stage-2–8 intermediates, so difficulty changes rerun assignment only. Preserve confidence/fallback warnings on cache hits rather than relabelling uncertain audio as a confident map. Evict complete source-analysis groups, retaining `ANALYSIS_CACHE_MAX` recent groups and their maps. Verify schema/version/hash on reads; discard corrupt entries. Quota/private-mode failures return the validated map with a cache warning, not a fabricated success or failed song. Reassignment timing is measured in [24](24-benchmark-and-evidence.md).

Title/artist: from ID3 tags if the main thread extracted them (simple ID3v2 TIT2/TPE1 parse), else from the filename, else `"Untitled"`.

## 12. Worker protocol

```ts
// main → worker
type GenRequest =
  | { type: 'analyze', jobId: string, difficulty: Difficulty, mono: Float32Array /* transferred */, sr: number, durationMs: number, meta: { title: string; artist: string; sourceHash: string; source: BeatmapV1['song']['source'] } }
  | { type: 'assign',  jobId: string, sourceHash: string, difficulty: Difficulty }   // reuse cached analysis held in worker memory
  | { type: 'cancel',  jobId: string };

// worker → main
type GenResponse =
  | { type: 'progress', jobId: string, stage: 'stft' | 'flux' | 'onsets' | 'tempo' | 'beats' | 'energy' | 'assign' | 'validate', fraction: number /* 0..1 overall */ }
  | { type: 'analysis', jobId: string, summary: { bpm: number; tempoConfidence: number; onsetCount: number; validOnsetCount: number; beatCount: number } }
  | { type: 'done', jobId: string, map: BeatmapV1, warnings: string[] }
  | { type: 'error', jobId: string, code: 'silent' | 'tooShort' | 'tooLarge' | 'unsuitable' | 'decode' | 'invalid' | 'cancelled', message: string };
```

`GEN_PROGRESS_WEIGHTS` supplies stage fractions that sum to one; each stage reports only completed work. Process chunks for at most `GEN_WORK_CHUNK_MS` of worker CPU before yielding to a task boundary so cancel messages can execute. Checking a flag inside uninterrupted synchronous work cannot receive a new message. Alternatively terminate/recreate the worker. Job IDs are generation-scoped; ignore stale results/progress, allow one terminal response or client rejection per job, and cancel superseded assignments. Missing in-memory analysis explicitly reloads/recomputes it. Exceeding a chunk budget because one FFT took longer is recorded, not hidden as a proven cancellation guarantee.

The main-thread client (`beatmap/generatorClient.ts`) wraps this in `generate(file, difficulty): Promise<BeatmapV1>` and exposes progress, analysis summary and warnings through explicit callbacks/state updates. Cache hits replay the same summary/warnings; returning just the map must not erase an uncertainty badge. Flow: hash → cache lookup → decode → `analyze` → `done`. Difficulty switch uses `assign` after confirming the worker owns the matching analysis.

## 13. Determinism and performance

Determinism rules:

- No `Math.random`, no `Date.now()` in any stage. Tie-breaks are by index order.
- Floating-point reductions use the same loop order every time (no SIMD/WASM paths that could reorder).
- `GENERATOR_VERSION` is bumped whenever any threshold or rule changes.
- Unit test: identical canonical PCM, metadata and difficulty produce `JSON.stringify`-identical maps with stable ordering and tie-breaks. Evaluate native MP3 decode separately; do not promise cross-engine bit identity.

Unverified planning estimate for a three-minute track (about 7,750 frames), to be measured with [24](24-benchmark-and-evidence.md):

| Stage | Estimate |
| --- | --- |
| Decode + resample (main) | 400–900 ms (browser native) |
| STFT | 150–300 ms |
| Flux + percentiles | 20 ms |
| Peak picking | 5 ms |
| Tempo (31 lags × 7 750) | 5 ms |
| Beat DP | 10 ms |
| Energy + sections | 10 ms |
| Assign + obstacles | 10 ms |
| Validate + IndexedDB write | 20 ms |
| **Total** | **≈ 0.7–1.4 s**, to be measured against the target |

Spectrogram allocation: `mag` = 7,750 × 1,025 × 4 B ≈ 32 MB, **not total pipeline peak memory**. Release it after extracting flux, centroids and linear band-power envelopes needed for beam sustain checks. The encoded bytes, decoded playback PCM, mono analysis, resampling buffers and worker copies add to peak memory; measure and bound them separately before calling it acceptable.

## 14. Failure handling

| Condition | Behaviour |
| --- | --- |
| Peak below `SILENCE_PEAK_MAX` or duration below `MIN_TRACK_MS` | `error: silent` / `tooShort`; show the actual configured duration limit in recovery text. |
| `decodeAudioData` rejects | `error: decode`; "Unsupported or corrupt audio file". |
| `tempoConfidence < TEMPO_MIN_CONFIDENCE` | **Onset-only mode**: no snapping/drop events, `warnings: ['lowTempoConfidence']`; use raw onsets with `strength ≥ FREE_RHYTHM_MIN_STRENGTH`, raw-RMS admission and density/flow caps. If fewer than `TEMPO_MIN_SUPPORT_ONSETS` distinct supported events remain, reject as unsuitable. Otherwise show "Free rhythm — beats not detected" and suppress precise BPM/metronome claims. Passing these heuristics does not prove musicality; noise/ambient tests remain real P2 gates, not a claim of universal noise detection. |
| Zero valid onsets | Return `lowOnsetDensity`/unsuitable-track feedback and keep Start disabled; never lower thresholds silently to force notes. |
| Validation errors | `error: invalid` with actionable paths and `sourceHash`; retain originals for any explicitly specified removal-only repair and show its warning. |
| Worker crash | Reject the job; offer at most `GEN_MAX_RETRIES` user-requested retry, then return to bundled selection. Never loop automatic retries or replace the current song silently. |

## 15. Tuning methodology

Build a licensed corpus; **none of these audio fixtures or annotations is committed yet**. Begin with five CC0/CC-BY development clips (60–90 s each) under `app/tests/fixtures/audio/`, as OGG and canonical PCM WAV, with `*.beats.json` annotations. Annotate by listening and waveform inspection with a second reviewer; taps alone include human latency. Keep licences, method and disagreements. Add at least one held-out rhythmic clip per genre that is never used for tuning.

| Clip | Genre | Challenge |
| --- | --- | --- |
| `edm-128` | Four-on-the-floor EDM, 128 BPM | Baseline; drop detection |
| `rock-140` | Live-drummed rock, ~140 BPM | Tempo drift, snare vs kick separation |
| `hiphop-90` | Hip-hop, 90 BPM | Octave ambiguity (90 vs 180), sparse hats |
| `acoustic-110` | Acoustic guitar + voice | Weak onsets, no kick → mostly slash |
| `ambient` | Beatless pad | ≤ 3 notes/minute or an unsuitable-track rejection; a warning cannot excuse dense random notes |

Planned metrics for `npm run beatmaps -- --eval` after implementation (today `npm run beatmaps` is a deliberate TODO failure):

| Metric | Target |
| --- | --- |
| Beat F-measure (tracked beats vs tapped beats, ±70 ms tolerance) | ≥ 0.85 on the four rhythmic clips |
| BPM error | ≤ 2 BPM (octave errors counted as failures) |
| Note-on-beat ratio: fraction of notes within ±`SNAP_MAX_MS` of a sixteenth grid line from the tapped beats | ≥ 0.90 |
| Notes per second at normal | within `[0.6, MAX_DENSITY_PER_S.normal]` on rhythmic clips |
| Ambient clip | ≤ 3 notes/min or rejected as unsuitable |

Use one-to-one beat matching, report each clip and half/double-tempo failures, freeze tuning before held-out evaluation, and derive the reference grid from annotations rather than predictions. [24](24-benchmark-and-evidence.md) defines statistics and artifacts. Tuning order: onset precision first, then `BEAT_TIGHTNESS`, prior width and assignment. Every output-changing rule/threshold increments `GENERATOR_VERSION`; test fixtures are never silently changed to make a failing version pass.

## 16. Unit tests (`app/tests/unit/dsp.test.ts`, `assign.test.ts`)

Synthetic signals are generated in-test at `ANALYSIS_SR`:

1. **FFT correctness**: unwindowed real sine at bin 100 has conjugate peaks at 100 and `N-100`, correct retained amplitude and negligible leakage; impulse is flat.
2. **Click track 128 BPM**, 30 s, 5 ms clicks: tempo = 128 ± 1; tracked beats within ±`HOP_MS` of true clicks (F ≥ 0.98). Merge coincident broadband evidence before assignment so one click does not become three notes; a frequency band is not an instrument label.
3. **Click track 90 BPM with hats at 180**: tempo resolves to 90 (octave test).
4. **White noise**, hum and quiet-intro noise with fixed seeds: reject as unsuitable or return the explicitly bounded sparse outcome. A low-confidence warning cannot excuse dense noise notes.
5. **Silence**: `error: silent`.
6. **Determinism**: two runs on clip 2 are byte-identical.
7. **Density cap**: an over-dense fixture never exceeds `floor(MAX_DENSITY_PER_S[difficulty] * DENSITY_WINDOW_MS / 1000)` notes in any registered window, including strong smashes/chords.
8. **Validation**: every generated map passes `validateBeatmap` with zero errors.
9. **Obstacle safety**: no note lies in covered columns during `[t − WALL_NOTE_MARGIN_MS, t + durationMs + WALL_NOTE_MARGIN_MS]`.
10. **Chord rule**: independent simultaneous band onsets at normal make at most two opposite-side notes; easy makes one. Three close onsets cannot form a transitive chord that evades gap/density limits.
11. **Gesture mix**: a stream of only strong low-band onsets still yields slashes, with smashes bounded by `SMASH_MAX_SHARE`; every packaged chart has ≥30% slashes, 20–60% smashes and 1–12% beams (`tests/unit/chartQuality.test.mjs`).
12. **Readability**: packaged charts respect `MAX_VISIBLE_NOTES`, per-side `handGapMs`, beam isolation, phrase rests and no shared lane within 400 ms; quiet energy thins notes relative to loud passages.
13. **Playability oracle**: `tests/performer.test.mjs` replays all nine packaged charts through the real input pipeline and judge; zero unplayable notes are allowed on Easy/Normal and at most 2% on Hard.

Also test non-finite PCM, constant tones, antiphase stereo, truncated bytes, cancellation during STFT, stale results, denied/corrupt cache, phase wraparound, beam/wall overlaps and rapid gesture transitions. Integration tests exercise real browser decode and worker transfer instead of mocking every boundary.

## Acceptance criteria

- [ ] Generation timing meets [24 §6](24-benchmark-and-evidence.md#6-initial-acceptance-targets), including cold decode and declared repetitions.
- [ ] All 10 unit tests pass; the five-clip evaluation meets the §15 targets for the four rhythmic clips.
- [ ] Repeated canonical-PCM generation is byte-identical; difficulty changes reuse versioned analysis and meet the [24](24-benchmark-and-evidence.md) timing target.
- [ ] Silence, noise, and a 3-second file produce the documented errors/warnings and never a map with notes on silence.
- [ ] Every map passes complete validation/playability constraints; each note comes from snapped evidence, retained strong syncopation or the labelled onset-only fallback.
- [ ] Song Select shows BPM, note count and any warning badge from the `analysis` summary before Start is enabled.
- [ ] Every referenced tunable has its planned named default in [02](02-architecture.md#constants) and an implementation export; P2 records development-fixture tuning before freezing the held-out run.

## Constants required

All constants referenced in this document are defined in the [02 constants table](02-architecture.md#constants).
