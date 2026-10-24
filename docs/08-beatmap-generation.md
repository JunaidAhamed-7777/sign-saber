# 08 — Beatmap Generation

The generator turns an audio file into a `BeatmapV1` ([09](09-beatmap-format.md)) with no human authoring. It is the embodiment of pillar P4 (*the music is the author*): every note sits on a validated onset that is aligned to a tracked beat grid, and silence or noise produces nothing.

It is implemented entirely in TypeScript, runs in a dedicated Web Worker (`beatmap/generator.worker.ts`), and is deterministic: the same bytes, difficulty and `GENERATOR_VERSION` always yield byte-identical JSON.

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

1. The mono signal MUST be peak-normalised to 0.95 before analysis (`gain = 0.95 / max|x|`); if `max|x| < 1e-4` the file is **silent** → return the empty-map failure (§14).
2. Files shorter than 5 s → failure `tooShort`.
3. `sourceHash` is SHA-256 of the *original* bytes (`crypto.subtle.digest`), computed on the main thread before decode, so the cache lookup (§11) happens before any DSP.

Cost: decode is browser-native (≈ 0.3–0.8 s for a 3-minute MP3); the offline render ≈ 0.1 s.

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

Unit test: a pure sine at bin `k` MUST produce `|X[k]| ≈ n/2` and `< 1 %` of that anywhere else; FFT of an impulse MUST be flat.

### 2.2 Framing and log-magnitude (`dsp/stft.ts`)

```
N        = FFT_SIZE, H = HOP
window   = Hann: w[i] = 0.5 − 0.5·cos(2πi/(N−1))
padded   = zeros(N/2) ++ mono ++ zeros(N/2)
frames   = floor((len(padded) − N) / H) + 1
for n in 0..frames−1:
  re = padded[n·H .. n·H+N] · window ; im = 0
  fft(re, im)
  for k in 0..N/2:  mag[n][k] = log(1 + 10 · sqrt(re[k]² + im[k]²))
```

- Only bins `0..N/2` (1025) are kept; bin `k` is centred at `k · ANALYSIS_SR / N = k · 10.77 Hz`.
- `mag` is a single `Float32Array(frames · 1025)` to avoid per-frame allocations.
- Log compression `log(1 + 10|X|)` tames the dynamic range so quiet hi-hats contribute to flux in the high band without being drowned by the kick.

Cost: 3 minutes → ≈ 7 750 frames × (2048-point FFT ≈ 25 k flops) ≈ 0.2 G flop ≈ 150–300 ms in JS.

## 3. Band spectral flux (`dsp/flux.ts`)

Bands from `BAND_EDGES_HZ`: low 20–150 Hz (bins 2–13), mid 150–2000 Hz (bins 14–185), high 2000–10000 Hz (bins 186–928). Band membership is precomputed once as bin index ranges.

```
for b in {low, mid, high}:
  for n in 1..frames−1:
    SF_b[n] = Σ_{k ∈ bins(b)} max(0, mag[n][k] − mag[n−1][k])      // half-wave rectified
  SF_b[0] = 0
  p95_b   = percentile(SF_b, 95)                                   // via copy + sort, once per band
  SF_b   /= max(p95_b, ε)                                          // normalise; values > 1 are allowed
sum[n]  = SF_low[n] + SF_mid[n] + SF_high[n]                       // "onset envelope" used by tempo + beats
```

Half-wave rectification means only energy *increases* count; a note decaying produces no flux. Normalising per band makes thresholds genre-independent (a quiet acoustic track and a loud EDM track produce comparable flux scales).

## 4. Onset peak picking (`dsp/peaks.ts`)

Applied to each band separately, producing `Onset { t, strength, band }`.

```
W_PRE = 10 frames (232 ms), W_POST = 3 frames (70 ms), W_MAX = 3 frames
MIN_GAP = round(ONSET_MIN_GAP_MS / HOP_MS)   // 80 ms → 3 frames

for n in W_PRE .. frames − W_POST − 1:
  isLocalMax = SF[n] ≥ SF[m] for all m in [n−W_MAX, n+W_MAX]
  mean       = avg(SF[n−W_PRE .. n+W_POST])
  passes     = isLocalMax && SF[n] ≥ mean + ONSET_DELTA && SF[n] ≥ ONSET_MIN_STRENGTH
  if passes && (n − lastOnsetFrame) ≥ MIN_GAP:
     strength = clamp(SF[n], 0, 1)        // SF already normalised by p95
     emit { t: tMs(n), strength, band }
     lastOnsetFrame = n
  else if passes && SF[n] > SF[lastOnsetFrame]:
     replace the last onset with this one   // keep the stronger of two onsets closer than MIN_GAP
```

Rationale for the asymmetric window (10 before, 3 after): an onset is a rise relative to the recent *past*; a symmetric window would suppress the first onset of a loud section. `ONSET_MIN_STRENGTH` (0.25 of the 95th percentile) is the "not random noise" gate: breathing-level fluctuations in a quiet intro never pass.

Output: `onsetsByBand: Record<Band, Onset[]>` and `allOnsets` merged and sorted by `t`.

## 5. Tempo estimation (`dsp/tempo.ts`)

Input: `sum[n]` (the summed onset envelope), locally normalised first to remove slow dynamics:

```
env[n] = max(0, sum[n] − movingAverage(sum, 16 frames)[n])
```

Autocorrelation over the lag range corresponding to `BPM_MIN..BPM_MAX`:

```
lagMin = round(60 · FRAME_HZ / BPM_MAX)     // 200 BPM → 12.9 frames
lagMax = round(60 · FRAME_HZ / BPM_MIN)     //  60 BPM → 43.1 frames
for L in lagMin..lagMax:
  ac[L] = Σ_n env[n] · env[n+L]  /  (frames − L)
  bpm(L) = 60 · FRAME_HZ / L
  prior(L) = exp( −0.5 · ( log2(bpm(L) / BPM_PRIOR) / 0.9 )² )     // log-Gaussian, σ = 0.9 octaves
  score[L] = ac[L] · prior(L)
```

Sub-frame refinement: fit a parabola through `score[L−1], score[L], score[L+1]` at the arg-max and use the fractional peak `L*`. Candidate period `T = L* frames`, `bpm = 60 · FRAME_HZ / L*`.

**Octave disambiguation.** Compute `score` for `T/2` and `2T` (interpolated). Choose the candidate whose *harmonic sum* `ac(T) + 0.5·ac(2T) + 0.5·ac(T/2)` is highest, but only switch away from the prior-weighted winner if the alternative's harmonic sum exceeds it by ≥ 15 %. Ties resolve toward the candidate closest to `BPM_PRIOR`.

**Confidence.**

```
confidence = (score[L*] − median(score)) / (max(score) − median(score) + ε)   // 0..1, peakiness
```

plus a secondary check: fraction of onsets within ±`SNAP_MAX_MS` of *some* multiple of `T` from the best phase (computed cheaply after §6). `tempoConfidence < 0.35` → low-confidence path (§14).

Unit test (§16): a synthetic click track at 128 BPM MUST yield 128 ± 1.

## 6. Beat tracking (`dsp/beats.ts`)

Ellis (2007) dynamic programming over the onset envelope `O[n] = env[n]` with target period `T` (frames, fractional allowed; the search uses integer lags).

```
tightness = BEAT_TIGHTNESS                         // 100
lo = round(0.5 · T), hi = round(2 · T)
C[n]   = −∞ for n < lo ; C[n] = O[n] for n in 0..lo−1 (no predecessor)
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
2. Trim leading beats before the first onset − 1 beat period, and trailing beats after the last onset + 1 period (the DP extends into silence; those "beats" would spawn nothing anyway but would mislead the HUD pulse).
3. `intervals = diff(beatMs)`; `bpm = round(60000 / median(intervals), 1)`.
4. `beatOffsetMs`: phase-align a perfect grid of period `60000/bpm` to the tracked beats by minimising `Σ |beat_i − (offset + k_i · period)|` (one-dimensional, solve as the median of `beat_i mod period`), then reduce into `[0, period)`.
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
  else if onset.strength ≥ 0.8:
     keep as-is; onset.snapped = false          // strong syncopation (e.g. a real off-grid hit) is musical, keep it
  else:
     drop                                        // weak + off-grid = noise
```

Two onsets that snap to the same grid line in the same band are merged (max strength). After snapping, onsets closer than `ONSET_MIN_GAP_MS` across bands are *kept* (they become chords in §9) — the gap rule in §4 is per band.

Definition of **valid beat** used in the acceptance tests: an onset that survives §7. The ratio `valid / detected` is reported in the generator summary for tuning.

## 8. Energy envelope and sections (`dsp/energy.ts`)

### 8.1 RMS envelope

```
hopSamples = ANALYSIS_SR · ENERGY_HOP_MS / 1000          // 2205
for i: rms[i] = sqrt( mean( mono[i·hop .. (i+1)·hop]² ) )
energy = rms / percentile(rms, 98)   clamped to 0..1       // → BeatmapV1.analysis.energy
smooth = movingAverage(energy, 40)                          // 4 s window for section logic
```

### 8.2 Events

| Event | Rule |
| --- | --- |
| `kick` | Every low-band onset with `strength ≥ 0.6` → `{ t, kind: 'kick', intensity: strength }`. Rate-limited to one per beat period/2. |
| `drop` | At time `t`, `smooth[t] ≥ DROP_RISE_RATIO · mean(smooth over [t − DROP_MIN_BUILD_MS, t − 1000 ms])` **and** `smooth[t] ≥ 0.6` **and** the preceding window never exceeded `smooth[t] / DROP_RISE_RATIO`. Snap `t` to the nearest tracked beat. Minimum 16 s between drops. `intensity = clamp((smooth[t] − windowMean) / windowMean, 0, 1)`. |
| `build` | Start of any 8 s window in which `smooth` rises monotonically (allowing ≤ 2 dips of < 0.03) by ≥ 0.25 total, and the window ends in a `drop` within 4 s. `intensity = rise`. |
| `calm` | Start of any ≥ 6 s window with `smooth ≤ percentile(smooth, 25)`, snapped to the nearest beat. Min 12 s apart. `intensity = 1 − smooth / p25`. |

Events are sorted and emitted into `BeatmapV1.events`.

## 9. Note assignment (`assign.ts`)

Input: snapped onsets per band with `strength`, tracked beats, `energy`, per-frame spectral centroid (computed in §2 as `Σ k·mag[n][k] / Σ mag[n][k]`, mapped to Hz), difficulty.

### 9.1 Candidate notes

Each surviving onset becomes a **candidate** with a provisional type:

| Band | Type | Condition |
| --- | --- | --- |
| low | `smash` | always |
| mid, high | `slash` | default |
| mid | `beam` | *sustained*: band energy in the mid bins stays within 3 dB of its value at onset for ≥ 500 ms **and** no other onset in any band within ±`BEAM_ISOLATION_MS` **and** last beam ≥ 4000 ms ago |

Easy difficulty converts every other `smash` to `slash` (smash requires more deliberate motion) and keeps at most one beam per 8 s.

### 9.2 Density cap

Sliding 4-second window; cap `MAX_DENSITY_PER_S[difficulty] · 4`. When a window is over cap, remove the weakest candidates first (by `strength`, then prefer removing `high` band, then `mid`, never `smash` with `strength ≥ 0.8`) until the cap holds. Iterate windows left to right; a removal is final.

### 9.3 Gap rules

Walk candidates in time order:

- If `t − prev.t < MIN_NOTE_GAP_MS[difficulty]` and both are not in a chord (`|Δt| ≥ 20 ms`) → drop the weaker.
- Chords (`|Δt| < 20 ms`, different bands) are allowed only on normal/hard, at most 2 notes, and they MUST take different columns on opposite sides (one in cols 0–1, one in cols 2–3). On easy the weaker is dropped.

### 9.4 Column choice (hand alternation and flow)

State: `lastSide ∈ {L, R}`, `lastCell`, `lastT`.

```
side = opposite(lastSide) unless (t − lastT) > 1200 ms, in which case side = R (natural dominant-hand start)
colsOnSide = side == L ? [0,1] : [2,3]
prefer the column within 1 of lastCell.col (ergonomic flow); otherwise the inner column (1 or 2)
every 4th note on the same side may jump to the outer column if strength ≥ 0.7 (accent)
if the chosen (col,row) equals a cell used within MIN_SAME_CELL_GAP_MS → pick the other column on the same side; if still same → shift row by ±1
```

For `smash` notes prefer the inner columns (1,2) — punches travel less laterally. For `beam` notes prefer the outer columns (0,3) and row 2 — the target reads as distant and high.

### 9.5 Row choice

Spectral centroid `c` (Hz) of the onset frame → row:

| centroid | row |
| --- | --- |
| `< 400 Hz` | 0 (bottom) |
| `400–2500 Hz` | 1 |
| `> 2500 Hz` | 2 (top) |

Then flow correction: if `|row − lastCell.row| == 2` and `t − lastT < 400 ms` → move to row 1 (no bottom→top jumps in under 400 ms). On easy, row 0 is used at most once per 2 s (bending down is tiring).

### 9.6 Finalise

Assign ascending `id`s, `dir = 'any'`, `strength` copied. Beam notes get `t` unchanged (the spawner handles lead time).

## 10. Obstacle placement

Candidate slots:

1. Any window ≥ 2000 ms with no notes (breakdowns), and
2. On normal/hard, every 16th tracked beat (bars 4, 8, 12 …) if the next 2 beats contain ≤ 1 note.

For each slot, the wall is placed on the side the body must *leave*: the player leans **away** from the wall, toward the side where the upcoming notes are, so hands and body move together.

```
notesSide   = side with more notes in [t, t + 2 beats]   (ties → alternate from the last wall)
kind        = notesSide == R ? 'wallLeft' : 'wallRight'   // wall on the empty side; lean toward the notes
durationMs  = clamp(2 · beatPeriod, MIN_OBSTACLE_MS, MAX_OBSTACLE_MS)
reject if any note in the covered columns has t within [t − 600, t + durationMs + 600]
reject if t − lastObstacle.t < MIN_OBSTACLE_GAP_MS
reject if t < 8000 (no walls in the first 8 s)
```

Easy: only rule-1 slots, duration 1.5 beats, and at most one wall per 12 s. Hard: also allow walls during note sections when the covered columns are empty for the duration.

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
  // Repair pass: drop offending notes/obstacles named in errors, re-validate once; if still failing → fail the job.
}
```

Cache (`beatmap/cache.ts`): IndexedDB database `sign-saber`, object store `beatmaps`, key `${sourceHash}:${difficulty}:${GENERATOR_VERSION}`, value `{ map, createdAt }`. Also store `${sourceHash}:analysis` with the shared stage-2–8 intermediate (`onsets`, `beats`, `energy`, `events`, `centroids`) so switching difficulty re-runs only §9–10 (< 50 ms). Eviction: keep the 30 most recent by `createdAt`.

Title/artist: from ID3 tags if the main thread extracted them (simple ID3v2 TIT2/TPE1 parse), else from the filename, else `"Untitled"`.

## 12. Worker protocol

```ts
// main → worker
type GenRequest =
  | { type: 'analyze', jobId: string, mono: Float32Array /* transferred */, sr: number, durationMs: number, meta: { title: string; artist: string; sourceHash: string; source: BeatmapV1['song']['source'] } }
  | { type: 'assign',  jobId: string, sourceHash: string, difficulty: Difficulty }   // reuse cached analysis held in worker memory
  | { type: 'cancel',  jobId: string };

// worker → main
type GenResponse =
  | { type: 'progress', jobId: string, stage: 'stft' | 'flux' | 'onsets' | 'tempo' | 'beats' | 'energy' | 'assign' | 'validate', fraction: number /* 0..1 overall */ }
  | { type: 'analysis', jobId: string, summary: { bpm: number; tempoConfidence: number; onsetCount: number; validOnsetCount: number; beatCount: number } }
  | { type: 'done', jobId: string, map: BeatmapV1, warnings: string[] }
  | { type: 'error', jobId: string, code: 'silent' | 'tooShort' | 'decode' | 'invalid' | 'cancelled', message: string };
```

Progress weights: stft 0.45, flux 0.05, onsets 0.05, tempo 0.10, beats 0.05, energy 0.05, assign 0.20, validate 0.05. The STFT loop posts progress every 500 frames. The worker checks a `cancelled` flag between stages and every 500 STFT frames.

The main-thread client (`beatmap/generatorClient.ts`) wraps this in `generate(file, difficulty): Promise<BeatmapV1>` with `onProgress`, and performs: hash → cache lookup → decode → `analyze` → `done`. Difficulty switch in Song Select → `assign` only.

## 13. Determinism and performance

Determinism rules:

- No `Math.random`, no `Date.now()` in any stage. Tie-breaks are by index order.
- Floating-point reductions use the same loop order every time (no SIMD/WASM paths that could reorder).
- `GENERATOR_VERSION` is bumped whenever any threshold or rule changes.
- Unit test: generating the same fixture twice MUST produce `JSON.stringify`-identical maps.

Cost estimate for a 3-minute track (7 750 frames):

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
| **Total** | **≈ 0.7–1.4 s**, well under the 4 s target |

Memory peak: `mag` = 7 750 × 1025 × 4 B ≈ 32 MB. Acceptable; free it after §3 by keeping only the three band-flux arrays and the per-frame centroid.

## 14. Failure handling

| Condition | Behaviour |
| --- | --- |
| Silent (`max|x| < 1e-4`) or < 5 s | `error: silent` / `tooShort`; Song Select shows "No audio detected" / "Track too short (min 5 s)". |
| `decodeAudioData` rejects | `error: decode`; "Unsupported or corrupt audio file". |
| `tempoConfidence < 0.35` | **Onset-only mode**: skip §6–7 snapping; `bpm` from the best autocorrelation peak anyway (for pulses) with `warnings: ['lowTempoConfidence']`; notes placed on raw onsets with `strength ≥ 0.4`; no `drop` events; Song Select shows a badge "Free rhythm — beats not detected". |
| Zero valid onsets after §7 but tempo confident | Lower `ONSET_MIN_STRENGTH` by 0.05 once and redo §4–7 (quiet masters); warn `lowOnsetDensity`. |
| Validation errors after repair | `error: invalid` with the first three messages; this is a generator bug and MUST be logged with the `sourceHash` for reproduction. |
| Worker crash | Client rejects; UI offers retry; a second failure falls back to the bundled tracks list. |

## 15. Tuning methodology

Five CC0/CC-BY test clips (60–90 s each, committed under `app/tests/fixtures/audio/` as OGG, with hand-tapped beat annotations `*.beats.json` recorded by tapping along in a small dev page three times and taking the median):

| Clip | Genre | Challenge |
| --- | --- | --- |
| `edm-128` | Four-on-the-floor EDM, 128 BPM | Baseline; drop detection |
| `rock-140` | Live-drummed rock, ~140 BPM | Tempo drift, snare vs kick separation |
| `hiphop-90` | Hip-hop, 90 BPM | Octave ambiguity (90 vs 180), sparse hats |
| `acoustic-110` | Acoustic guitar + voice | Weak onsets, no kick → mostly slash |
| `ambient` | Beatless pad | Must produce ≤ 3 notes per minute or go to onset-only mode |

Metrics (reported by `npm run beatmaps -- --eval`):

| Metric | Target |
| --- | --- |
| Beat F-measure (tracked beats vs tapped beats, ±70 ms tolerance) | ≥ 0.85 on the four rhythmic clips |
| BPM error | ≤ 2 BPM (octave errors counted as failures) |
| Note-on-beat ratio: fraction of notes within ±`SNAP_MAX_MS` of a sixteenth grid line from the tapped beats | ≥ 0.90 |
| Notes per second at normal | within `[0.6, MAX_DENSITY_PER_S.normal]` on rhythmic clips |
| Ambient clip | ≤ 3 notes/min or `lowTempoConfidence` warning |

Tuning order: `ONSET_DELTA` and `ONSET_MIN_STRENGTH` first (precision of onsets), then `BEAT_TIGHTNESS` (lower = follows drift more), then the prior σ, then assignment rules. Each change bumps `GENERATOR_VERSION`.

## 16. Unit tests (`app/tests/unit/dsp.test.ts`, `assign.test.ts`)

Synthetic signals are generated in-test at `ANALYSIS_SR`:

1. **FFT correctness**: sine at bin 100 → peak at bin 100 within 1 %; impulse → flat magnitude.
2. **Click track 128 BPM**, 30 s, 5 ms clicks: tempo = 128 ± 1; tracked beats within ±`HOP_MS` of true clicks (F ≥ 0.98); every click yields exactly one `low` onset.
3. **Click track 90 BPM with hats at 180**: tempo resolves to 90 (octave test).
4. **White noise** at −6 dBFS, 30 s: zero notes after §7 (or `lowTempoConfidence` with ≤ 2 notes).
5. **Silence**: `error: silent`.
6. **Determinism**: two runs on clip 2 are byte-identical.
7. **Density cap**: a 400 ms-spaced click track at hard MUST produce ≤ `MAX_DENSITY_PER_S.hard × 4` notes per 4 s window, and ≤ `.easy × 4` at easy.
8. **Validation**: every generated map passes `validateBeatmap` with zero errors.
9. **Obstacle safety**: no note lies in a wall's covered columns during `[t − 600, t + durationMs + 600]`.
10. **Chord rule**: two simultaneous band onsets at normal produce two notes on opposite sides; at easy produce one.

## Acceptance criteria

- [ ] Generating a bundled 3-minute track at normal completes in < 4 s on the demo laptop including decode, and in < 1.5 s excluding decode.
- [ ] All 10 unit tests pass; the five-clip evaluation meets the §15 targets for the four rhythmic clips.
- [ ] Repeated generation is byte-identical; changing difficulty re-uses cached analysis (< 100 ms).
- [ ] Silence, noise, and a 3-second file produce the documented errors/warnings and never a map with notes on silence.
- [ ] Every emitted map passes `validateBeatmap`; every note is on a snapped grid line or is a strength ≥ 0.8 syncopation.
- [ ] Song Select shows BPM, note count and any warning badge from the `analysis` summary before Start is enabled.

## Constants required

All constants referenced in this document are defined in the [02 constants table](02-architecture.md#constants).
