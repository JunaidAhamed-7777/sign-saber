import { describe, expect, it } from 'vitest';
import { ANALYSIS_SR, FFT_SIZE, HOP } from '../../src/core/constants';
import { FFT } from '../../src/beatmap/dsp/fft';
import { stft } from '../../src/beatmap/dsp/stft';
import { analyzeMono, GeneratorError, mapFromAnalysis } from '../../src/beatmap/pipeline';

function clicks(bpm: number, seconds = 30): Float32Array {
  const mono = new Float32Array(seconds * ANALYSIS_SR);
  const period = (60 / bpm) * ANALYSIS_SR;
  for (let onset = period; onset < mono.length; onset += period) {
    for (let i = 0; i < Math.round(0.005 * ANALYSIS_SR); i++) {
      const index = Math.round(onset) + i;
      if (index < mono.length) mono[index] = Math.exp(-i / (ANALYSIS_SR * 0.001));
    }
  }
  return mono;
}
describe('canonical signal DSP (synthetic evidence)', () => {
  it('FFT preserves sine amplitude and conjugate bins with negligible leakage', () => {
    const re = Float64Array.from({ length: FFT_SIZE }, (_, i) =>
      Math.sin((2 * Math.PI * 100 * i) / FFT_SIZE),
    );
    const im = new Float64Array(FFT_SIZE);
    new FFT(FFT_SIZE).transform(re, im);
    expect(Math.hypot(re[100]!, im[100]!)).toBeCloseTo(FFT_SIZE / 2, 6);
    expect(Math.hypot(re[FFT_SIZE - 100]!, im[FFT_SIZE - 100]!)).toBeCloseTo(FFT_SIZE / 2, 6);
    for (let i = 0; i < FFT_SIZE; i++)
      if (i !== 100 && i !== FFT_SIZE - 100) expect(Math.hypot(re[i]!, im[i]!)).toBeLessThan(FFT_SIZE * 0.01);
  });
  it('an impulse has flat FFT magnitude, with no input-size ambiguity', () => {
    const re = new Float64Array(FFT_SIZE),
      im = new Float64Array(FFT_SIZE);
    re[0] = 1;
    new FFT(FFT_SIZE).transform(re, im);
    expect([...re].every((v) => v === 1)).toBe(true);
    expect([...im].every((v) => v === 0)).toBe(true);
    expect(() => new FFT(17)).toThrow('power of two');
    expect(() => new FFT(2).transform(new Float64Array(3), new Float64Array(3))).toThrow('length');
  });
  it('centres STFT frames on sample zero instead of shifting every detected onset', () => {
    const mono = new Float32Array(FFT_SIZE * 2);
    mono[HOP * 2] = 1;
    const spectrum = stft(mono);
    let best = -1,
      maximum = -Infinity;
    for (let i = 0; i < spectrum.frames; i++) {
      const value = spectrum.magnitudes[i * spectrum.bins + 100]!;
      if (value > maximum) {
        maximum = value;
        best = i;
      }
    }
    expect(best).toBe(2);
  });
  it('detects 128 BPM clicks within one BPM and tracks actual transients', () => {
    const mono = clicks(128);
    const analysis = analyzeMono(mono, ANALYSIS_SR, (mono.length / ANALYSIS_SR) * 1000);
    expect(Math.abs(analysis.bpm - 128)).toBeLessThanOrEqual(1);
    const period = 60000 / 128;
    const usable = analysis.beats.filter((t) => t > period && t < 29000);
    expect(usable.length).toBeGreaterThan(40);
    const aligned = usable.filter(
      (t) => Math.abs(t - Math.round(t / period) * period) <= (HOP / ANALYSIS_SR) * 1000,
    );
    expect(aligned.length / usable.length).toBeGreaterThanOrEqual(0.98);
    expect(analysis.onsets.every((o) => Number.isFinite(o.t) && o.t >= 0)).toBe(true);
  });
  it('rejects silence, short or oversized timebases and invalid samples', () => {
    const silent = new Float32Array(ANALYSIS_SR * 5);
    expect(() => analyzeMono(silent, ANALYSIS_SR, 5000)).toThrow('silent');
    expect(() => analyzeMono(silent, ANALYSIS_SR, 1000)).toThrow('at least');
    const invalid = silent.slice();
    invalid[0] = NaN;
    expect(() => analyzeMono(invalid, ANALYSIS_SR, 5000)).toThrow('invalid PCM');
    expect(() => analyzeMono(silent, 44100, 5000)).toThrow('canonical mono');
  });
  it('produces identical maps from identical canonical PCM, retaining warnings', () => {
    const mono = clicks(128, 10),
      meta = {
        title: 'Synthetic clicks',
        artist: 'Sign Saber tests',
        sourceHash: '0'.repeat(64),
        source: 'upload' as const,
      };
    const a = analyzeMono(mono, ANALYSIS_SR, 10000),
      b = analyzeMono(mono, ANALYSIS_SR, 10000);
    const first = mapFromAnalysis(a, meta, 'normal'),
      second = mapFromAnalysis(b, meta, 'normal');
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.map.notes.length).toBeGreaterThan(0);
    expect(first.warnings).toEqual(a.warnings);
  });
  it('rejects a steady hum instead of manufacturing a level', () => {
    const mono = Float32Array.from(
      { length: ANALYSIS_SR * 10 },
      (_, i) => 0.2 * Math.sin((i * 2 * Math.PI * 60) / ANALYSIS_SR),
    );
    expect(() => analyzeMono(mono, ANALYSIS_SR, 10000)).toThrow(GeneratorError);
  });
  it('rejects fixed-seed stationary noise and noise after a quiet introduction', () => {
    for (const quietIntro of [false, true]) {
      let seed = 42;
      const mono = Float32Array.from({ length: ANALYSIS_SR * 10 }, (_, i) => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return (seed / 2 ** 32 - 0.5) * (quietIntro && i < ANALYSIS_SR * 2 ? 0.00001 : 0.2);
      });
      expect(() => analyzeMono(mono, ANALYSIS_SR, 10000)).toThrow(GeneratorError);
    }
  });
  it('keeps 90 BPM low pulses separate from 180 BPM weaker high hats', () => {
    const mono = clicks(90);
    const period = (60 / 180) * ANALYSIS_SR;
    for (let onset = period; onset < mono.length; onset += period) {
      for (let i = 0; i < Math.round(0.005 * ANALYSIS_SR); i++) {
        const index = Math.round(onset) + i;
        if (index < mono.length)
          mono[index] =
            mono[index]! +
            0.1 * Math.sin((i * 2 * Math.PI * 8000) / ANALYSIS_SR) * Math.exp(-i / (ANALYSIS_SR * 0.001));
      }
    }
    const analysis = analyzeMono(mono, ANALYSIS_SR, 30000);
    expect(Math.abs(analysis.bpm - 90)).toBeLessThanOrEqual(1);
  });
});
