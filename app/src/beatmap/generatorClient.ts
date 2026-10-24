/**
 * Sign Saber — beatmap/generatorClient.ts
 *
 * Responsibility: Main-thread client for the generator worker: hash → cache lookup → decode → analyze → done; difficulty switch re-runs assign only; progress callbacks; cancellation.
 * Spec: docs/08-beatmap-generation.md §12
 * Inputs: File, Difficulty
 * Outputs: Promise<BeatmapV1>, onProgress
 *
 * Implementation begins at the hackathon kick-off (docs/19-build-plan.md). This file documents the module contract only.
 */
export {};
