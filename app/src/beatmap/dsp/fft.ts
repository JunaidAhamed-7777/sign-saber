/** Radix-2 in-place FFT. Split arrays are caller-owned and reusable. */
export class FFT {
  private readonly rev: Uint32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  constructor(readonly n: number) {
    if (!Number.isInteger(n) || n < 2 || (n & (n - 1)) !== 0)
      throw new Error('FFT size must be a power of two');
    const bits = Math.log2(n);
    this.rev = new Uint32Array(n);
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n; i++) {
      let r = 0,
        x = i;
      for (let b = 0; b < bits; b++) {
        r = (r << 1) | (x & 1);
        x >>= 1;
      }
      this.rev[i] = r;
    }
    for (let k = 0; k < n / 2; k++) {
      this.cos[k] = Math.cos((-2 * Math.PI * k) / n);
      this.sin[k] = Math.sin((-2 * Math.PI * k) / n);
    }
  }
  transform(re: Float32Array | Float64Array, im: Float32Array | Float64Array): void {
    if (re.length !== this.n || im.length !== this.n) throw new Error('FFT input length mismatch');
    for (let i = 0; i < this.n; i++) {
      const j = this.rev[i]!;
      if (j > i) {
        const r = re[i]!,
          v = im[i]!;
        re[i] = re[j]!;
        im[i] = im[j]!;
        re[j] = r;
        im[j] = v;
      }
    }
    for (let size = 2; size <= this.n; size *= 2) {
      const half = size / 2,
        step = this.n / size;
      for (let start = 0; start < this.n; start += size) {
        for (let k = 0, tw = 0; k < half; k++, tw += step) {
          const i = start + k,
            j = i + half;
          const wr = this.cos[tw]!,
            wi = this.sin[tw]!;
          const xr = re[j]! * wr - im[j]! * wi,
            xi = re[j]! * wi + im[j]! * wr;
          re[j] = re[i]! - xr;
          im[j] = im[i]! - xi;
          re[i] = re[i]! + xr;
          im[i] = im[i]! + xi;
        }
      }
    }
  }
}
