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
  CONTACT_MIN_SPEED,
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
/** Forgiving webcam play: any moving hand that reaches a slash or smash block hits it, whatever its shape. */
export function contactOutcome(type: NoteType, gesture: Gesture, speed: number): ContactOutcome {
  void gesture;
  if (!Number.isFinite(speed) || speed < 0) return 'ignore';
  if ((type === 'slash' || type === 'smash') && speed >= CONTACT_MIN_SPEED) return 'hit';
  return 'ignore';
}
export const timingError = (songTimeAtCapture: number, noteTime: number, inputOffsetMs: number): number =>
  songTimeAtCapture - noteTime + inputOffsetMs;
