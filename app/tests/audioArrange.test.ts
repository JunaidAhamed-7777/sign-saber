import { afterEach, describe, expect, it, vi } from 'vitest';
import { arrangeAudio, encodeFloatWav, selectHighlightWindow } from '../src/audio/arrange';
import type { ArrangementAnalysis } from '../src/audio/arrange';
import { ANALYSIS_SR, ENERGY_HOP_MS } from '../src/core/constants';
import { analyzeMono, mapFromAnalysis } from '../src/beatmap/pipeline';
import { sha256 } from '../src/beatmap/bundled';
class TestAudioBuffer {
  readonly length: number;
  readonly sampleRate: number;
  readonly numberOfChannels: number;
  private readonly channels: Float32Array<ArrayBuffer>[];
  constructor(options: AudioBufferOptions) {
    this.length = options.length;
    this.sampleRate = options.sampleRate;
    this.numberOfChannels = options.numberOfChannels ?? 1;
    this.channels = Array.from({ length: this.numberOfChannels }, () => new Float32Array(this.length));
  }
  get duration(): number {
    return this.length / this.sampleRate;
  }
  getChannelData(channel: number): Float32Array<ArrayBuffer> {
    return this.channels[channel]!;
  }
}
function evidence(durationMs: number, first = 0, last = durationMs): ArrangementAnalysis {
  return {
    energy: Array.from({ length: Math.ceil(durationMs / ENERGY_HOP_MS) }, (_, i) =>
      i * ENERGY_HOP_MS >= first && i * ENERGY_HOP_MS < last ? 1 : 0.05,
    ),
    onsets: [],
    beats: [],
    tempoConfidence: 0,
  };
}
const buffer = (seconds: number): AudioBuffer =>
  new TestAudioBuffer({
    sampleRate: ANALYSIS_SR,
    length: seconds * ANALYSIS_SR,
    numberOfChannels: 1,
  }) as unknown as AudioBuffer;
afterEach(() => vi.unstubAllGlobals());
describe('continuous 10/60/10 arrangement selection', () => {
  it('selects the highest supported central sixty seconds, retaining ten-second handles', () => {
    const selected = selectHighlightWindow(160000, evidence(160000, 50000, 110000));
    expect(selected.sourceStartMs).toBe(40000);
    expect(selected.sourceEndMs).toBe(120000);
    expect(selected.fadeIn).toEqual({ startMs: 0, endMs: 10000 });
    expect(selected.highlight).toEqual({ startMs: 10000, endMs: 70000 });
    expect(selected.fadeOut).toEqual({ startMs: 70000, endMs: 80000 });
    expect(selected.selectionReason).toBe('energy-only-continuous-window');
    expect(selected.warnings).toContain('arrangementNotBeatLocked');
  });
  it('uses earliest tie-breaking and never claims uncertain beats are locked', () => {
    const input = evidence(160000);
    input.beats = Array.from({ length: 300 }, (_, i) => i * 500 + 125);
    const first = selectHighlightWindow(160000, input);
    expect(first.sourceStartMs).toBe(0);
    expect(first.beatAligned).toBe(false);
    input.tempoConfidence = 0.9;
    const aligned = selectHighlightWindow(160000, input);
    expect(input.beats).toContain(aligned.sourceStartMs + aligned.highlight.startMs);
    expect(aligned.beatAligned).toBe(true);
    expect(aligned.selectionReason).toBe('beat-supported-energy-onset-window');
  });
  it('provides a truthful proportional short-track fallback without looping or invented duration', () => {
    const short = selectHighlightWindow(20000, evidence(20000));
    expect(short.sourceStartMs).toBe(0);
    expect(short.outputDurationMs).toBe(20000);
    expect(short.highlight).toEqual({ startMs: 2500, endMs: 17500 });
    expect(short.shortTrack).toBe(true);
    expect(short.warnings).toContain('shortTrackProportionalArrangement');
  });
  it('uses anchored musical events without counting one broadband onset repeatedly', () => {
    const input = evidence(160000);
    input.onsets = Array.from({ length: 120 }, (_, index) => [
      { t: 50000 + index * 500, strength: 1, band: 'low' as const },
      { t: 50000 + index * 500, strength: 0.8, band: 'high' as const },
    ]).flat();
    const selected = selectHighlightWindow(160000, input);
    expect(selected.sourceStartMs).toBe(40000);
    expect(selected.score.onsetEvidencePerSecond).toBe(2);
    expect(selected.selectionReason).toBe('energy-onset-window-low-tempo-confidence');
  });
  it('rejects broken source/analysis instead of manufacturing a best part', () => {
    expect(() => selectHighlightWindow(1000, evidence(1000))).toThrow('duration');
    const bad = evidence(10000);
    bad.energy = [NaN];
    expect(() => selectHighlightWindow(10000, bad)).toThrow('energy');
    const unordered = evidence(10000);
    unordered.beats = [500, 100];
    expect(() => selectHighlightWindow(10000, unordered)).toThrow('beat');
  });
});
describe('actual derivative audio and chart identity (synthetic signal)', () => {
  it('renders smooth bounded fades, preserves its source and hashes an actual float WAV', async () => {
    vi.stubGlobal('AudioBuffer', TestAudioBuffer);
    const source = buffer(120),
      samples = source.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = 0.1 + (i / samples.length) * 0.8;
    const originalHash = await sha256(samples.buffer as ArrayBuffer);
    const result = await arrangeAudio(source, evidence(120000, 30000, 90000), {
      title: 'Synthetic ramp',
      artist: 'Sign Saber tests',
      source: 'upload',
      sourceAudioSha256: '0'.repeat(64),
    });
    expect(result.buffer.duration).toBe(80);
    expect(result.edit.sourceStartMs).toBe(20000);
    const rendered = result.buffer.getChannelData(0);
    expect(rendered[0]).toBe(0);
    expect(rendered.at(-1)).toBe(0);
    expect(rendered[5 * ANALYSIS_SR]).toBeCloseTo(samples[25 * ANALYSIS_SR]! * 0.5, 6);
    expect(rendered[40 * ANALYSIS_SR]).toBe(samples[60 * ANALYSIS_SR]);
    expect(await sha256(samples.buffer as ArrayBuffer)).toBe(originalHash);
    const wav = await result.file.arrayBuffer(),
      view = new DataView(wav);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF');
    expect(view.getUint16(20, true)).toBe(3);
    expect(view.getUint32(40, true)).toBe(rendered.length * 4);
    expect(view.getFloat32(44 + 40 * ANALYSIS_SR * 4, true)).toBe(rendered[40 * ANALYSIS_SR]);
    expect(await sha256(wav)).toBe(result.edit.outputAudioSha256);
    expect(result.edit.outputAudioSha256).not.toBe(result.edit.sourceAudioSha256);
    expect(result.edit.oldChartReused).toBe(false);
    const again = await arrangeAudio(source, evidence(120000, 30000, 90000), { title: 'Synthetic ramp' });
    expect(again.edit.outputAudioSha256).toBe(result.edit.outputAudioSha256);
  });
  it('generates a fresh validated map from the edited PCM under the derivative audio hash', async () => {
    vi.stubGlobal('AudioBuffer', TestAudioBuffer);
    const source = buffer(100),
      samples = source.getChannelData(0);
    for (let at = ANALYSIS_SR / 2; at < samples.length; at += ANALYSIS_SR / 2) {
      for (let offset = 0; offset < ANALYSIS_SR * 0.005; offset++)
        samples[Math.round(at) + offset] = Math.exp(-offset / (ANALYSIS_SR * 0.001));
    }
    const result = await arrangeAudio(source, undefined, {
      title: 'Synthetic clicks',
      artist: 'Sign Saber tests',
      sourceAudioSha256: '0'.repeat(64),
    });
    const mono = result.buffer.getChannelData(0).slice();
    const analysis = analyzeMono(mono, ANALYSIS_SR, result.buffer.duration * 1000);
    const generated = mapFromAnalysis(
      analysis,
      {
        title: result.edit.outputTitle,
        artist: result.edit.sourceArtist,
        source: 'upload',
        sourceHash: result.edit.outputAudioSha256,
      },
      'normal',
    );
    expect(generated.map.song.durationMs).toBe(80000);
    expect(generated.map.song.sourceHash).toBe(await sha256(await result.file.arrayBuffer()));
    expect(generated.map.notes.length).toBeGreaterThan(50);
    expect(generated.map.notes.every((note) => note.t >= 0 && note.t <= 80000)).toBe(true);
  });
  it('checks cancellation and rejects a derivative larger than file admission limits', async () => {
    vi.stubGlobal('AudioBuffer', TestAudioBuffer);
    await expect(
      arrangeAudio(buffer(5), undefined, {
        checkCancelled: () => {
          throw new Error('cancelled');
        },
      }),
    ).rejects.toThrow('cancelled');
    const tooLarge = { length: 20000000, numberOfChannels: 2, sampleRate: 48000 } as AudioBuffer;
    expect(() => encodeFloatWav(tooLarge)).toThrow('admission');
  });
});
