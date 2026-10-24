/**
 * Sign Saber — gestures/blade.ts
 *
 * Responsibility: Blade on/off hysteresis, blade length, beam charge accumulation and decay.
 * Spec: docs/06-gesture-recognition.md §Blade and charge
 * Inputs: HandCursor speed/gesture
 * Outputs: bladeActive, bladeLength, charge
 *
 * Implementation: bounded live/replay input; hardware acceptance remains separate from synthetic assertions.
 */
import type { HandCursor } from '../core/types';
import {
  BLADE_ON_SPEED,
  BLADE_OFF_SPEED,
  BLADE_FULL_SPEED,
  BLADE_LEN_MIN,
  BLADE_LEN_MAX,
} from '../core/constants';
export function updateBlade(cursor: HandCursor): void {
  if (!cursor.bladeActive && cursor.gesture === 'open' && cursor.speed >= BLADE_ON_SPEED)
    cursor.bladeActive = true;
  if (cursor.bladeActive && (cursor.gesture !== 'open' || cursor.speed <= BLADE_OFF_SPEED))
    cursor.bladeActive = false;
  cursor.bladeLength = cursor.bladeActive
    ? BLADE_LEN_MIN +
      (BLADE_LEN_MAX - BLADE_LEN_MIN) *
        Math.max(0, Math.min(1, (cursor.speed - BLADE_ON_SPEED) / (BLADE_FULL_SPEED - BLADE_ON_SPEED)))
    : 0;
}
