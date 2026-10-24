export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
export function percentile(values: ArrayLike<number>, p: number): number {
  if (!values.length) return 0;
  const copy = Array.from(values).sort((a, b) => a - b);
  return copy[Math.max(0, Math.ceil((p / 100) * copy.length) - 1)]!;
}
export function movingAverage(values: ArrayLike<number>, window: number): Float32Array {
  const result = new Float32Array(values.length);
  const before = Math.floor(window / 2),
    after = window - before - 1;
  let sum = 0,
    lo = 0,
    hi = 0;
  for (let n = 0; n < values.length; n++) {
    const targetLo = Math.max(0, n - before),
      targetHi = Math.min(values.length, n + after + 1);
    while (hi < targetHi) sum += values[hi++]!;
    while (lo < targetLo) sum -= values[lo++]!;
    result[n] = sum / (hi - lo);
  }
  return result;
}
