/**
 * Sign Saber — game/kinetic.ts
 *
 * Responsibility: Kinetic energy estimate: per-swing peak KE (HAND_MASS_KG) + torso (TORSO_MASS_KG) → J and kcal.
 * Spec: docs/07-hit-detection-and-scoring.md §Kinetic energy
 * Inputs: HandCursor speeds, BodyState
 * Outputs: kineticJoules, kcal
 *
 * Implemented for the first playable spine. Replay/unit evidence is separate from live-camera acceptance.
 */
import type { HandCursor, BodyState } from '../core/types';
import {
  PLAY_W,
  HAND_MASS_KG,
  TORSO_MASS_KG,
  SWING_MIN_SPEED,
  TORSO_SWING_MIN_SPEED,
  SWING_REFRACTORY_MS,
  SWING_TROUGH_RATIO,
  METABOLIC_EFFICIENCY,
} from '../core/constants';

interface PeakChannel {
  previous: number;
  before: number;
  previousTime: number;
  lastPeak: number;
  lastAccepted: number;
  trough: boolean;
}
const channel = (): PeakChannel => ({
  previous: 0,
  before: 0,
  previousTime: -Infinity,
  lastPeak: 0,
  lastAccepted: -Infinity,
  trough: true,
});
/** A monocular, assumed-scale game metric. It does not measure exertion or calories. */
export class KineticMeter {
  private readonly left = channel();
  private readonly right = channel();
  private readonly torso = channel();
  joules = 0;
  constructor(private readonly physicalScale = 0) {}
  private sample(state: PeakChannel, speed: number, time: number, mass: number, floor: number): void {
    if (!Number.isFinite(speed) || !Number.isFinite(time) || time <= state.previousTime) return;
    if (speed < state.lastPeak * SWING_TROUGH_RATIO) state.trough = true;
    if (
      state.previous >= floor &&
      state.previous >= state.before &&
      state.previous > speed &&
      state.trough &&
      state.previousTime - state.lastAccepted >= SWING_REFRACTORY_MS
    ) {
      this.joules += 0.5 * mass * state.previous ** 2;
      state.lastPeak = state.previous;
      state.lastAccepted = state.previousTime;
      state.trough = speed < state.lastPeak * SWING_TROUGH_RATIO;
    }
    state.before = state.previous;
    state.previous = speed;
    state.previousTime = time;
  }
  update(hands: readonly HandCursor[], body: BodyState | null): void {
    for (const hand of hands) {
      const state = hand.hand === 'left' ? this.left : this.right;
      if (hand.present)
        this.sample(
          state,
          (hand.speed * this.physicalScale) / PLAY_W,
          hand.tCapture,
          HAND_MASS_KG,
          SWING_MIN_SPEED,
        );
      else this.clearChannel(state);
    }
    if (body?.present)
      this.sample(this.torso, body.torsoSpeed, body.tCapture, TORSO_MASS_KG, TORSO_SWING_MIN_SPEED);
    else this.clearChannel(this.torso);
  }
  private clearChannel(state: PeakChannel): void {
    state.before = 0;
    state.previous = 0;
    state.previousTime = -Infinity;
    state.lastPeak = 0;
    state.trough = true;
  }
  resetHistory(): void {
    this.clearChannel(this.left);
    this.clearChannel(this.right);
    this.clearChannel(this.torso);
  }
  get kcal(): number {
    return this.joules / 4184 / METABOLIC_EFFICIENCY;
  }
}
