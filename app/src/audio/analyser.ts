/**
 * Sign Saber — audio/analyser.ts
 *
 * Responsibility: AnalyserNode → BandEnergies (ANALYSER_FFT, band edges, smoothing).
 * Spec: docs/15-audio-playback-sync.md §Band energies; docs/02-architecture.md §BandEnergies
 * Inputs: Audio graph
 * Outputs: BandEnergies per frame
 *
 * Implemented for the first playable spine. Replay/unit evidence is separate from live-camera acceptance.
 */
import {
  ANALYSER_FFT,
  ANALYSER_SMOOTH,
  ANALYSER_LOW_ATTACK,
  ANALYSER_PEAK_DECAY_S,
  ANALYSER_PEAK_FLOOR,
  ANALYSER_RMS_GAIN,
  BAND_LOW_HZ,
  BAND_MID_HZ,
  BAND_HIGH_HZ,
} from '../core/constants';
import type { BandEnergies } from '../core/types';
import { clamp } from '../utils/math';

/** Reusable FFT/time buffers. SFX bypass this node so they cannot manufacture musical energy. */
export class MusicAnalyser {
  readonly node: AnalyserNode;
  readonly energies: BandEnergies = { low: 0, mid: 0, high: 0, rms: 0 };
  private readonly frequency: Uint8Array<ArrayBuffer>;
  private readonly waveform: Float32Array<ArrayBuffer>;
  private readonly peaks = { low: ANALYSER_PEAK_FLOOR, mid: ANALYSER_PEAK_FLOOR, high: ANALYSER_PEAK_FLOOR };
  constructor(private readonly ctx: AudioContext) {
    this.node = ctx.createAnalyser();
    this.node.fftSize = ANALYSER_FFT;
    this.node.smoothingTimeConstant = 0;
    this.frequency = new Uint8Array(this.node.frequencyBinCount);
    this.waveform = new Float32Array(ANALYSER_FFT);
  }
  private band(bounds: readonly number[]): number {
    const binHz = this.ctx.sampleRate / ANALYSER_FFT;
    const lo = Math.max(0, Math.floor(bounds[0]! / binHz));
    const hi = Math.min(this.frequency.length, Math.ceil(bounds[1]! / binHz));
    let sum = 0;
    for (let index = lo; index < hi; index++) sum += this.frequency[index]! / 255;
    return hi > lo ? sum / (hi - lo) : 0;
  }
  update(dt: number): BandEnergies {
    this.node.getByteFrequencyData(this.frequency);
    this.node.getFloatTimeDomainData(this.waveform);
    this.updateBand('low', this.band(BAND_LOW_HZ), dt);
    this.updateBand('mid', this.band(BAND_MID_HZ), dt);
    this.updateBand('high', this.band(BAND_HIGH_HZ), dt);
    let square = 0;
    for (let index = 0; index < this.waveform.length; index++) square += this.waveform[index]! ** 2;
    const rms = clamp(Math.sqrt(square / this.waveform.length) * ANALYSER_RMS_GAIN, 0, 1);
    this.energies.rms += (rms - this.energies.rms) * (1 - ANALYSER_SMOOTH ** (Math.max(0, dt) * 60));
    return this.energies;
  }
  private updateBand(name: 'low' | 'mid' | 'high', raw: number, dt: number): void {
    this.peaks[name] = Math.max(
      ANALYSER_PEAK_FLOOR,
      raw,
      this.peaks[name] * Math.exp(-Math.max(0, dt) / ANALYSER_PEAK_DECAY_S),
    );
    const value = raw / this.peaks[name];
    const retention = name === 'low' && value > this.energies[name] ? ANALYSER_LOW_ATTACK : ANALYSER_SMOOTH;
    this.energies[name] +=
      (clamp(value, 0, 1) - this.energies[name]) * (1 - retention ** (Math.max(0, dt) * 60));
  }
  reset(): void {
    this.energies.low = this.energies.mid = this.energies.high = this.energies.rms = 0;
  }
  dispose(): void {
    this.node.disconnect();
    this.reset();
  }
}
