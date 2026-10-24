/**
 * Sign Saber — game/judge.ts
 *
 * Responsibility: Timing error → Perfect/Great/Good; gesture requirement and bad cut rules; cut plane construction.
 * Spec: docs/07-hit-detection-and-scoring.md §Judgement
 * Inputs: Contacts
 * Outputs: note:hit / note:badcut / note:miss
 *
 * Implemented for the first playable spine. Replay/unit evidence is separate from live-camera acceptance.
 */
import type { Gesture } from '../core/types';
import type { NoteType } from '../beatmap/types';
import {
  WINDOW_PERFECT_MS,
  WINDOW_GREAT_MS,
  WINDOW_GOOD_MS,
  WINDOW_SCALE,
  SLASH_MIN_SPEED,
  SMASH_MIN_SPEED,
} from '../core/constants';

export type Judgement = 'perfect' | 'great' | 'good';
export type ContactOutcome = 'hit' | 'badcut' | 'ignore';
export function judgeTiming(errorMs: number, windowScale = WINDOW_SCALE): Judgement | null {
  if (!Number.isFinite(errorMs) || !Number.isFinite(windowScale) || windowScale <= 0) return null;
  const error = Math.abs(errorMs);
  if (error <= WINDOW_PERFECT_MS * windowScale) return 'perfect';
  if (error <= WINDOW_GREAT_MS * windowScale) return 'great';
  if (error <= WINDOW_GOOD_MS * windowScale) return 'good';
  return null;
}
export function contactOutcome(type: NoteType, gesture: Gesture, speed: number): ContactOutcome {
  if (!Number.isFinite(speed) || speed < 0) return 'ignore';
  if (type === 'slash') {
    if (gesture === 'open' && speed >= SLASH_MIN_SPEED) return 'hit';
    if ((gesture === 'fist' || gesture === 'point') && speed >= SMASH_MIN_SPEED) return 'badcut';
  }
  if (type === 'smash') {
    if (gesture === 'fist' && speed >= SMASH_MIN_SPEED) return 'hit';
    if (gesture === 'open' && speed >= SLASH_MIN_SPEED) return 'badcut';
  }
  return 'ignore';
}
export const timingError = (songTimeAtCapture: number, noteTime: number, inputOffsetMs: number): number =>
  songTimeAtCapture - noteTime + inputOffsetMs;
