/**
 * Sign Saber — beatmap/dsp/resample.ts
 *
 * Responsibility: Main-thread helper: decode, mono mix and resample to ANALYSIS_SR via OfflineAudioContext; peak-normalise; silence/too-short checks.
 * Spec: docs/08-beatmap-generation.md §1
 * Inputs: ArrayBuffer
 * Outputs: { mono: Float32Array, sr, durationMs }
 *
 * Implementation begins at the hackathon kick-off (docs/19-build-plan.md). This file documents the module contract only.
 */
export {};
