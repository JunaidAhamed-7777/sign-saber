/**
 * Sign Saber — utils/pool.ts
 *
 * Responsibility: Fixed-capacity object pool.
 * Spec: docs/16-performance-budget.md §Memory
 * Inputs: —
 * Outputs: Pool<T>
 *
 * Implemented for the first playable spine. Replay/unit evidence is separate from live-camera acceptance.
 */
/** Fixed capacity pool: exhaustion is explicit, never an implicit hot-path allocation. */
export class Pool<T> {
  private readonly available: T[];
  private readonly leased = new Set<T>();
  readonly capacity: number;
  highWater = 0;
  constructor(
    capacity: number,
    factory: (index: number) => T,
    private readonly reset?: (value: T) => void,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('Pool capacity must be positive');
    this.capacity = capacity;
    this.available = Array.from({ length: capacity }, (_, index) => factory(index));
  }
  take(): T | null {
    const value = this.available.pop();
    if (value === undefined) return null;
    this.leased.add(value);
    this.highWater = Math.max(this.highWater, this.leased.size);
    return value;
  }
  release(value: T): void {
    if (!this.leased.delete(value)) return;
    this.reset?.(value);
    this.available.push(value);
  }
  clear(): void {
    for (const value of this.leased) this.release(value);
  }
  get occupancy(): number {
    return this.leased.size;
  }
}
