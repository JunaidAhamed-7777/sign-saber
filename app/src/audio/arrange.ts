/** Deterministic continuous highlight selection and real derivative audio rendering.
 * The receipt describes an energy/onset heuristic, never verified chorus detection.
 */
import {
  ARRANGEMENT_VERSION,
  ARRANGEMENT_TOTAL_MS,
  ARRANGEMENT_FADE_MS,
  ARRANGEMENT_HIGHLIGHT_MS,
  ARRANGEMENT_SELECTION_HOP_MS,
  ARRANGEMENT_ENERGY_WEIGHT,
  ARRANGEMENT_ONSET_WEIGHT,
  ARRANGEMENT_SILENCE_ENERGY,
  ARRANGEMENT_SILENCE_PENALTY,
  ENERGY_HOP_MS,
  CHORD_WINDOW_MS,
  DSP_EPSILON,
  TEMPO_MIN_CONFIDENCE,
  MAX_UPLOAD_BYTES,
  GEN_WORK_CHUNK_MS,
  MIN_TRACK_MS,
  MAX_TRACK_MS,
  ASSET_TEXT_MAX_CHARS,
} from '../core/constants';
import type { Onset } from '../beatmap/types';
import { sha256 } from '../beatmap/bundled';
import { monoForAnalysis } from '../beatmap/dsp/resample';
import { validateDecodedAudio } from './decode';

export interface ArrangementAnalysis {
  energy: readonly number[];
  onsets: readonly Onset[];
  beats: readonly number[];
  tempoConfidence: number;
}
export interface ArrangementWindow {
  sourceStartMs: number;
  sourceEndMs: number;
  outputDurationMs: number;
  fadeIn: { startMs: number; endMs: number };
  highlight: { startMs: number; endMs: number };
  fadeOut: { startMs: number; endMs: number };
  selectionReason: string;
  tempoConfidence: number;
  beatAligned: boolean;
  shortTrack: boolean;
  score: { meanEnergy: number; onsetEvidencePerSecond: number; activeFraction: number; combined: number };
  warnings: string[];
}
export interface ArrangementProvenance {
  sourceAudioSha256?: string;
  title?: string;
  artist?: string;
  source?: 'bundled' | 'upload' | 'youtube';
  checkCancelled?: () => void;
}
export interface AudioArrangementEdit extends ArrangementWindow {
  version: 1;
  sourceTitle: string;
  sourceArtist: string;
  sourceKind: NonNullable<ArrangementProvenance['source']> | 'unknown';
  sourceAudioSha256: string | null;
  sourceDurationMs: number;
  outputTitle: string;
  outputAudioSha256: string;
  outputCanonicalPcmSha256: string;
  sourceStartSample: number;
  sourceEndSample: number;
  sampleRate: number;
  channels: number;
  fadeCurve: 'raised-cosine-amplitude';
  continuity: 'one-continuous-source-window';
  oldChartReused: false;
  changes: string;
}
interface Candidate {
  start: number;
  meanEnergy: number;
  onsetEvidence: number;
  activeFraction: number;
  score: number;
}
function assertAnalysis(analysis: ArrangementAnalysis, durationMs: number): void {
  if (
    !Number.isFinite(analysis.tempoConfidence) ||
    analysis.tempoConfidence < 0 ||
    analysis.tempoConfidence > 1
  )
    throw new Error('Invalid arrangement tempo confidence');
  if (
    analysis.energy.length > Math.ceil(durationMs / ENERGY_HOP_MS) + 1 ||
    analysis.energy.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
  )
    throw new Error('Invalid arrangement energy envelope');
  let previous = -Infinity;
  for (const onset of analysis.onsets) {
    if (
      !Number.isFinite(onset.t) ||
      onset.t < previous ||
      onset.t < 0 ||
      onset.t > durationMs ||
      !Number.isFinite(onset.strength) ||
      onset.strength < 0 ||
      onset.strength > 1
    )
      throw new Error('Invalid arrangement onset evidence');
    previous = onset.t;
  }
  previous = -Infinity;
  for (const beat of analysis.beats) {
    if (!Number.isFinite(beat) || beat < previous || beat < 0 || beat > durationMs)
      throw new Error('Invalid arrangement beat evidence');
    previous = beat;
  }
}
function lowerBound(values: readonly number[], target: number): number {
  let lo = 0,
    hi = values.length;
  while (lo < hi) {
    const middle = (lo + hi) >>> 1;
    if (values[middle]! < target) lo = middle + 1;
    else hi = middle;
  }
  return lo;
}
/** Candidate objective is declared in the receipt. Earliest time wins exact/epsilon ties. */
export function selectHighlightWindow(durationMs: number, analysis: ArrangementAnalysis): ArrangementWindow {
  if (!Number.isFinite(durationMs) || durationMs < MIN_TRACK_MS || durationMs > MAX_TRACK_MS)
    throw new Error('Arrangement source duration is outside supported limits');
  assertAnalysis(analysis, durationMs);
  const outputDurationMs = Math.min(ARRANGEMENT_TOTAL_MS, durationMs);
  const scale = outputDurationMs / ARRANGEMENT_TOTAL_MS;
  const fadeMs = ARRANGEMENT_FADE_MS * scale;
  const highlightMs = ARRANGEMENT_HIGHLIGHT_MS * scale;
  if (Math.abs(2 * fadeMs + highlightMs - outputDurationMs) > DSP_EPSILON * durationMs)
    throw new Error('Arrangement duration constants disagree');
  const maximumStart = Math.max(0, durationMs - outputDurationMs);
  const starts = new Set<number>();
  const confident = analysis.tempoConfidence >= TEMPO_MIN_CONFIDENCE && analysis.beats.length > 0;
  if (confident) {
    for (const beat of analysis.beats) {
      const start = beat - fadeMs;
      if (start >= 0 && start <= maximumStart) starts.add(start);
    }
  } else {
    starts.add(0);
    starts.add(maximumStart);
    for (let start = 0; start <= maximumStart; start += ARRANGEMENT_SELECTION_HOP_MS) starts.add(start);
  }
  if (!starts.size) {
    starts.add(0);
    starts.add(maximumStart);
  }
  const energyPrefix = new Float64Array(analysis.energy.length + 1);
  const activePrefix = new Float64Array(analysis.energy.length + 1);
  for (let i = 0; i < analysis.energy.length; i++) {
    energyPrefix[i + 1] = energyPrefix[i]! + analysis.energy[i]!;
    activePrefix[i + 1] = activePrefix[i]! + (analysis.energy[i]! >= ARRANGEMENT_SILENCE_ENERGY ? 1 : 0);
  }
  const cumulative = (prefix: Float64Array, atMs: number): number => {
    const position = Math.max(0, Math.min(analysis.energy.length, atMs / ENERGY_HOP_MS));
    const index = Math.floor(position);
    return (
      (prefix[index] ?? prefix.at(-1) ?? 0) +
      (position - index) * ((prefix[index + 1] ?? prefix[index] ?? 0) - (prefix[index] ?? 0))
    );
  };
  const times: number[] = [],
    strengths: number[] = [];
  for (const onset of analysis.onsets) {
    if (times.length && onset.t - times.at(-1)! < CHORD_WINDOW_MS)
      strengths[strengths.length - 1] = Math.max(strengths.at(-1)!, onset.strength);
    else {
      times.push(onset.t);
      strengths.push(onset.strength);
    }
  }
  const onsetPrefix = new Float64Array(strengths.length + 1);
  for (let i = 0; i < strengths.length; i++) onsetPrefix[i + 1] = onsetPrefix[i]! + strengths[i]!;
  const candidates: Candidate[] = [];
  let highestEnergy = 0,
    highestOnsets = 0;
  for (const start of [...starts].sort((a, b) => a - b)) {
    const first = start + fadeMs,
      last = first + highlightMs,
      bins = highlightMs / ENERGY_HOP_MS;
    const meanEnergy = analysis.energy.length
      ? (cumulative(energyPrefix, last) - cumulative(energyPrefix, first)) / bins
      : 0;
    const activeFraction = analysis.energy.length
      ? (cumulative(activePrefix, last) - cumulative(activePrefix, first)) / bins
      : 0;
    const onsetEvidence =
      (onsetPrefix[lowerBound(times, last)]! - onsetPrefix[lowerBound(times, first)]!) / (highlightMs / 1000);
    candidates.push({ start, meanEnergy, activeFraction, onsetEvidence, score: 0 });
    highestEnergy = Math.max(highestEnergy, meanEnergy);
    highestOnsets = Math.max(highestOnsets, onsetEvidence);
  }
  let best = candidates[0]!;
  for (const candidate of candidates) {
    candidate.score =
      (ARRANGEMENT_ENERGY_WEIGHT * candidate.meanEnergy) / Math.max(highestEnergy, DSP_EPSILON) +
      (ARRANGEMENT_ONSET_WEIGHT * candidate.onsetEvidence) / Math.max(highestOnsets, DSP_EPSILON) -
      ARRANGEMENT_SILENCE_PENALTY * (1 - candidate.activeFraction);
    if (candidate.score > best.score + DSP_EPSILON) best = candidate;
  }
  const warnings: string[] = [];
  const beatAligned =
    confident &&
    analysis.beats.some((beat) => Math.abs(beat - best.start - fadeMs) <= DSP_EPSILON * durationMs);
  if (!beatAligned) warnings.push('arrangementNotBeatLocked');
  if (!analysis.onsets.length) warnings.push('arrangementEnergyOnly');
  if (!analysis.energy.length) warnings.push('arrangementMissingEnergyEvidence');
  if (highestEnergy < ARRANGEMENT_SILENCE_ENERGY && highestOnsets <= DSP_EPSILON)
    warnings.push('arrangementLowActivityEvidence');
  if (outputDurationMs < ARRANGEMENT_TOTAL_MS) warnings.push('shortTrackProportionalArrangement');
  return {
    sourceStartMs: best.start,
    sourceEndMs: best.start + outputDurationMs,
    outputDurationMs,
    fadeIn: { startMs: 0, endMs: fadeMs },
    highlight: { startMs: fadeMs, endMs: fadeMs + highlightMs },
    fadeOut: { startMs: fadeMs + highlightMs, endMs: outputDurationMs },
    selectionReason: beatAligned
      ? 'beat-supported-energy-onset-window'
      : analysis.onsets.length
        ? 'energy-onset-window-low-tempo-confidence'
        : 'energy-only-continuous-window',
    tempoConfidence: analysis.tempoConfidence,
    beatAligned,
    shortTrack: outputDurationMs < ARRANGEMENT_TOTAL_MS,
    score: {
      meanEnergy: best.meanEnergy,
      onsetEvidencePerSecond: best.onsetEvidence,
      activeFraction: best.activeFraction,
      combined: best.score,
    },
    warnings,
  };
}
function sourceEnergy(source: AudioBuffer): number[] {
  const hop = (source.sampleRate * ENERGY_HOP_MS) / 1000,
    output = new Float64Array(Math.ceil(source.length / hop));
  const channels = Array.from({ length: source.numberOfChannels }, (_, channel) =>
    source.getChannelData(channel),
  );
  let peak = 0;
  for (let index = 0; index < output.length; index++) {
    const first = Math.floor(index * hop),
      last = Math.min(source.length, Math.floor((index + 1) * hop));
    let sum = 0;
    for (const channel of channels)
      for (let sample = first; sample < last; sample++) sum += channel[sample]! ** 2;
    output[index] = Math.sqrt(sum / Math.max(1, (last - first) * channels.length));
    peak = Math.max(peak, output[index]!);
  }
  return Array.from(output, (value) => value / Math.max(peak, DSP_EPSILON));
}
/** IEEE float32 WAV is a real local derivative file; its SHA is the new chart sourceHash. */
export function encodeFloatWav(buffer: AudioBuffer): ArrayBuffer {
  const sampleBytes = Float32Array.BYTES_PER_ELEMENT,
    frames = buffer.length,
    channels = buffer.numberOfChannels;
  if (
    !Number.isSafeInteger(frames) ||
    frames <= 0 ||
    !Number.isSafeInteger(channels) ||
    channels < 1 ||
    channels > 2 ||
    !Number.isSafeInteger(buffer.sampleRate) ||
    buffer.sampleRate <= 0
  )
    throw new Error('Invalid mono/stereo WAV geometry');
  const dataBytes = frames * channels * sampleBytes,
    headerBytes = 44;
  if (dataBytes + headerBytes > MAX_UPLOAD_BYTES)
    throw new Error('Arranged float WAV exceeds the local file admission limit');
  const bytes = new ArrayBuffer(headerBytes + dataBytes),
    view = new DataView(bytes);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, dataBytes + headerBytes - 8, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * sampleBytes, true);
  view.setUint16(32, channels * sampleBytes, true);
  view.setUint16(34, sampleBytes * 8, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  const samples = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      if (!Number.isFinite(samples[channel]![frame]!)) throw new Error('Cannot encode invalid PCM');
      view.setFloat32(
        headerBytes + (frame * channels + channel) * sampleBytes,
        samples[channel]![frame]!,
        true,
      );
    }
  }
  return bytes;
}
/** Produces new audio and provenance only. Generate a fresh map from returned file bytes. */
export async function arrangeAudio(
  source: AudioBuffer,
  analysis?: ArrangementAnalysis,
  provenance: ArrangementProvenance = {},
): Promise<{ buffer: AudioBuffer; file: File; edit: AudioArrangementEdit }> {
  validateDecodedAudio(source);
  if (source.numberOfChannels > 2) throw new Error('Arrangement currently supports mono or stereo audio');
  if (provenance.sourceAudioSha256 !== undefined && !/^[a-f0-9]{64}$/.test(provenance.sourceAudioSha256))
    throw new Error('Invalid original source-file SHA-256');
  const measured =
    analysis && analysis.energy.length * ENERGY_HOP_MS >= source.duration * 1000
      ? analysis
      : {
          energy: sourceEnergy(source),
          onsets: analysis?.onsets ?? [],
          beats: analysis?.beats ?? [],
          tempoConfidence: analysis?.tempoConfidence ?? 0,
        };
  const selected = selectHighlightWindow(source.duration * 1000, measured);
  const first = Math.round((selected.sourceStartMs / 1000) * source.sampleRate);
  const frames = Math.min(
    source.length - first,
    Math.round((selected.outputDurationMs / 1000) * source.sampleRate),
  );
  const output = new AudioBuffer({
    length: frames,
    sampleRate: source.sampleRate,
    numberOfChannels: source.numberOfChannels,
  });
  const fadeFrames = Math.round((selected.fadeIn.endMs / 1000) * source.sampleRate);
  let lastYield = performance.now();
  const chunk = Math.max(1, Math.ceil((source.sampleRate * GEN_WORK_CHUNK_MS) / 1000));
  for (let channel = 0; channel < source.numberOfChannels; channel++) {
    const input = source.getChannelData(channel),
      target = output.getChannelData(channel);
    for (let start = 0; start < frames; start += chunk) {
      const end = Math.min(frames, start + chunk);
      for (let sample = start; sample < end; sample++) {
        const edge = Math.min(sample, frames - 1 - sample);
        const gain =
          fadeFrames > 0 && edge < fadeFrames ? 0.5 - 0.5 * Math.cos((Math.PI * edge) / fadeFrames) : 1;
        target[sample] = input[first + sample]! * gain;
      }
      provenance.checkCancelled?.();
      if (performance.now() - lastYield >= GEN_WORK_CHUNK_MS) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        lastYield = performance.now();
      }
    }
  }
  provenance.checkCancelled?.();
  const wav = encodeFloatWav(output);
  const outputAudioSha256 = await sha256(wav);
  const mono = await monoForAnalysis(output, provenance.checkCancelled);
  const canonicalBytes = new ArrayBuffer(mono.length * Float32Array.BYTES_PER_ELEMENT),
    canonicalView = new DataView(canonicalBytes);
  for (let sample = 0; sample < mono.length; sample++)
    canonicalView.setFloat32(sample * Float32Array.BYTES_PER_ELEMENT, mono[sample]!, true);
  const outputCanonicalPcmSha256 = await sha256(canonicalBytes);
  const sourceTitle = provenance.title ?? 'Local audio',
    sourceArtist = provenance.artist ?? 'Unknown artist';
  const titleSuffix = ` — ${output.duration.toFixed(1)}s arrangement`;
  const outputTitle = sourceTitle.slice(0, ASSET_TEXT_MAX_CHARS - titleSuffix.length) + titleSuffix;
  const filename =
    (sourceTitle.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'local-audio') +
    '-arrangement.wav';
  const edit: AudioArrangementEdit = {
    ...selected,
    version: ARRANGEMENT_VERSION,
    sourceTitle,
    sourceArtist,
    sourceKind: provenance.source ?? 'unknown',
    sourceAudioSha256: provenance.sourceAudioSha256 ?? null,
    sourceDurationMs: source.duration * 1000,
    sourceStartMs: (first / source.sampleRate) * 1000,
    sourceEndMs: ((first + frames) / source.sampleRate) * 1000,
    outputDurationMs: output.duration * 1000,
    sourceStartSample: first,
    sourceEndSample: first + frames,
    fadeIn: { startMs: 0, endMs: (fadeFrames / source.sampleRate) * 1000 },
    highlight: {
      startMs: (fadeFrames / source.sampleRate) * 1000,
      endMs: ((frames - fadeFrames) / source.sampleRate) * 1000,
    },
    fadeOut: {
      startMs: ((frames - fadeFrames) / source.sampleRate) * 1000,
      endMs: (frames / source.sampleRate) * 1000,
    },
    sampleRate: source.sampleRate,
    channels: source.numberOfChannels,
    outputTitle,
    outputAudioSha256,
    outputCanonicalPcmSha256,
    fadeCurve: 'raised-cosine-amplitude',
    continuity: 'one-continuous-source-window',
    oldChartReused: false,
    changes:
      'Selected one continuous source excerpt, applied raised-cosine amplitude fades to silence, and encoded unchanged-channel float32 WAV. A new map must be generated from these exact derivative file bytes.',
  };
  return { buffer: output, file: new File([wav], filename, { type: 'audio/wav' }), edit };
}
