/**
 * Sign Saber — core/clock.ts
 *
 * Responsibility: Frame delta clamping and the bridge between performance.now() and song time.
 * Spec: docs/15-audio-playback-sync.md §SongClock
 * Inputs: AudioContext time, performance.now()
 * Outputs: dt, songTime
 *
 * Implementation follows ROADMAP.md phase gates. This file documents the module contract only.
 */
export {};
