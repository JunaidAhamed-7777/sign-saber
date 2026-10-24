/**
 * Sign Saber — tracking/wave.ts
 *
 * Responsibility: Wave detector for calibration: direction reversals of hand x within WAVE_WINDOW_MS.
 * Spec: docs/05-tracking-pipeline.md §Wave detector
 * Inputs: Hand x history
 * Outputs: waveDetected boolean
 *
 * Implementation: bounded live/replay input; hardware acceptance remains separate from synthetic assertions.
 */
import {
  WAVE_DEAD_BAND,
  WAVE_MIN_AMPLITUDE,
  WAVE_REVERSALS,
  WAVE_WINDOW_MS,
  INPUT_MAX_AGE_MS,
} from '../core/constants';
export class WaveDetector {
  private direction = 0;
  private previous = Number.NaN;
  private extreme = 0;
  private lastT = -Infinity;
  private times = new Float64Array(WAVE_REVERSALS);
  private count = 0;
  private index = 0;
  progress = 0;
  reset(): void {
    this.direction = this.count = this.index = this.progress = 0;
    this.previous = Number.NaN;
    this.lastT = -Infinity;
  }
  update(u: number, tCapture: number, present: boolean): boolean {
    if (!present || !Number.isFinite(u) || !Number.isFinite(tCapture)) {
      this.reset();
      return false;
    }
    if (tCapture <= this.lastT) return false;
    if (tCapture - this.lastT > INPUT_MAX_AGE_MS) this.reset();
    this.lastT = tCapture;
    if (!Number.isFinite(this.previous)) {
      this.previous = this.extreme = u;
      return false;
    }
    const delta = u - this.previous;
    this.previous = u;
    if (!this.direction) {
      if (Math.abs(delta) > WAVE_DEAD_BAND) {
        this.direction = Math.sign(delta);
        this.extreme = u;
      }
      return false;
    }
    if ((u - this.extreme) * this.direction > 0) this.extreme = u;
    if ((this.extreme - u) * this.direction >= WAVE_MIN_AMPLITUDE) {
      this.times[this.index] = tCapture;
      this.index = (this.index + 1) % WAVE_REVERSALS;
      this.count = Math.min(WAVE_REVERSALS, this.count + 1);
      this.direction *= -1;
      this.extreme = u;
    }
    let recent = 0;
    for (let i = 0; i < this.count; i++) if (tCapture - this.times[i]! <= WAVE_WINDOW_MS) recent++;
    this.progress = recent / WAVE_REVERSALS;
    return recent >= WAVE_REVERSALS;
  }
}
