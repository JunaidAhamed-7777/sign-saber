import { describe, expect, it } from 'vitest';
import { ANALYSIS_SR } from '../../src/core/constants';
import { monoForAnalysis } from '../../src/beatmap/dsp/resample';
function buffer(rate: number, channels: Float32Array[]): AudioBuffer {
  return {
    sampleRate: rate,
    length: channels[0]?.length ?? 0,
    numberOfChannels: channels.length,
    getChannelData: (channel: number) => channels[channel]!,
  } as AudioBuffer;
}
describe('band-limited analysis resampling (synthetic numeric assertions)', () => {
  it.each([16000, 32000, 44100, 48000])(
    'preserves impulse time/integral from %s Hz with transferable ownership',
    async (sampleRate) => {
      const mono = new Float32Array(sampleRate);
      mono[sampleRate / 2] = 1;
      const output = await monoForAnalysis(buffer(sampleRate, [mono]));
      let peak = 0,
        sum = 0;
      for (let i = 0; i < output.length; i++) {
        if (Math.abs(output[i]!) > Math.abs(output[peak]!)) peak = i;
        sum += output[i]!;
      }
      expect(output.length).toBe(ANALYSIS_SR);
      expect(Math.abs(peak - ANALYSIS_SR / 2)).toBeLessThanOrEqual(1);
      expect(Math.abs((sum / ANALYSIS_SR) * sampleRate - 1)).toBeLessThan(0.05);
      const copy = structuredClone(output, { transfer: [output.buffer as ArrayBuffer] });
      expect(output.byteLength).toBe(0);
      expect(copy.length).toBe(ANALYSIS_SR);
      expect(mono[sampleRate / 2]).toBe(1);
    },
  );
  it('removes above-Nyquist energy instead of aliasing it into fake musical onsets', async () => {
    const mono = Float32Array.from(
      { length: 48000 },
      (_, i) => 0.25 * Math.sin((i * 2 * Math.PI * 16000) / 48000),
    );
    const output = await monoForAnalysis(buffer(48000, [mono]));
    let sum = 0,
      count = 0;
    for (let i = ANALYSIS_SR / 10; i < output.length - ANALYSIS_SR / 10; i++) {
      sum += output[i]! ** 2;
      count++;
    }
    expect(Math.sqrt(sum / count)).toBeLessThan(0.01);
  });
  it('preserves a 1 kHz amplitude and cancels antiphase stereo', async () => {
    const left = Float32Array.from(
      { length: 44100 },
      (_, i) => 0.25 * Math.sin((i * 2 * Math.PI * 1000) / 44100),
    );
    const right = Float32Array.from(left, (v) => -v);
    expect((await monoForAnalysis(buffer(44100, [left, right]))).every((v) => v === 0)).toBe(true);
    const output = await monoForAnalysis(buffer(44100, [left, left]));
    let sum = 0,
      count = 0;
    for (let i = ANALYSIS_SR / 10; i < output.length - ANALYSIS_SR / 10; i++) {
      sum += output[i]! ** 2;
      count++;
    }
    expect(Math.sqrt(sum / count)).toBeCloseTo(0.25 / Math.sqrt(2), 3);
  });
  it('honors cancellation checkpoints and rejects malformed PCM', async () => {
    const mono = new Float32Array(44100);
    let checkpoints = 0;
    await expect(
      monoForAnalysis(buffer(44100, [mono]), () => {
        if (++checkpoints === 2) throw new Error('cancelled');
      }),
    ).rejects.toThrow('cancelled');
    mono[100] = NaN;
    await expect(monoForAnalysis(buffer(44100, [mono]))).rejects.toThrow('invalid samples');
    await expect(monoForAnalysis(buffer(0, [new Float32Array(2)]))).rejects.toThrow('Invalid decoded');
    await expect(monoForAnalysis(buffer(44100, [new Float32Array(2), new Float32Array(1)]))).rejects.toThrow(
      'length mismatch',
    );
  });
});
