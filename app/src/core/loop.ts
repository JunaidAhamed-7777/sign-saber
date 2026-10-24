/** Bounded raw instrumentation. Durations are CPU/callback measurements, never GPU latency. */
import { TELEMETRY_CAPACITY } from './constants';
export class SampleRing {
  private readonly values: Float64Array;
  private cursor = 0;
  private size = 0;
  total = 0;
  constructor(readonly capacity = TELEMETRY_CAPACITY) { this.values = new Float64Array(capacity); }
  add(value: number): void {
    if (!Number.isFinite(value) || value < 0) return;
    this.values[this.cursor] = value; this.cursor = (this.cursor + 1) % this.capacity;
    this.size = Math.min(this.size + 1, this.capacity); this.total++;
  }
  export(): number[] {
    const start = (this.cursor - this.size + this.capacity) % this.capacity;
    return Array.from({ length: this.size }, (_, i) => this.values[(start + i) % this.capacity]!);
  }
  summary(): { count: number; p50: number | null; p95: number | null; p99: number | null; max: number | null } {
    const sorted = this.export().sort((a,b) => a-b);
    const q = (p: number) => sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length)-1)]! : null;
    return { count: this.size, p50: q(.5), p95: q(.95), p99: q(.99), max: q(1) };
  }
}
export class Instrumentation {
  readonly frameIntervalMs = new SampleRing();
  readonly frameWorkMs = new SampleRing();
  readonly inferenceMs = new SampleRing();
  readonly inputAgeMs = new SampleRing();
  export() { return { frameIntervalMs: this.frameIntervalMs.export(), frameWorkMs: this.frameWorkMs.export(), inferenceMs: this.inferenceMs.export(), inputAgeMs: this.inputAgeMs.export(), gpuDurationMs: null, gpuStatus: 'unavailable' as const }; }
}
