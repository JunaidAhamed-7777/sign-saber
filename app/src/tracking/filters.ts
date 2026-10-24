/**
 * Sign Saber — tracking/filters.ts
 *
 * Responsibility: One Euro filtering of landmarks (ONE_EURO_* constants), presence and tracking-lost timers.
 * Spec: docs/05-tracking-pipeline.md §Smoothing
 * Inputs: Raw landmarks
 * Outputs: Filtered landmarks
 *
 * Implementation: bounded live/replay input; hardware acceptance remains separate from synthetic assertions.
 */
import { ONE_EURO_MIN_CUTOFF, ONE_EURO_BETA, ONE_EURO_D_CUTOFF } from '../core/constants';
export class OneEuroFilter {
  private value = 0;
  private derivative = 0;
  private t = Number.NaN;
  constructor(
    private beta = ONE_EURO_BETA,
    private cutoff = ONE_EURO_MIN_CUTOFF,
  ) {}
  reset(): void {
    this.t = Number.NaN;
    this.derivative = 0;
  }
  filter(value: number, tSec: number): number {
    if (!Number.isFinite(value) || !Number.isFinite(tSec)) return this.value;
    if (!Number.isFinite(this.t)) {
      this.t = tSec;
      this.value = value;
      return value;
    }
    if (tSec <= this.t) return this.value;
    const dt = tSec - this.t;
    const alpha = (cutoff: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
    this.derivative += ((value - this.value) / dt - this.derivative) * alpha(ONE_EURO_D_CUTOFF);
    this.value += (value - this.value) * alpha(this.cutoff + this.beta * Math.abs(this.derivative));
    this.t = tSec;
    return this.value;
  }
}
export class LandmarkFilters {
  private filters: OneEuroFilter[];
  constructor(length: number) {
    this.filters = Array.from({ length }, () => new OneEuroFilter());
  }
  reset(): void {
    for (const filter of this.filters) filter.reset();
  }
  apply(source: Float32Array, target: Float32Array, tMs: number, stride = 3): void {
    for (let i = 0; i < source.length; i++)
      target[i] = i % stride < 2 ? this.filters[i]!.filter(source[i]!, tMs / 1000) : source[i]!;
  }
}
