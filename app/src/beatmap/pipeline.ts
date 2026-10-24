import {
  ANALYSIS_PEAK_TARGET,
  ANALYSIS_SR,
  APPROACH_MS,
  FREE_RHYTHM_MIN_STRENGTH,
  GENERATOR_VERSION,
  GEN_PROGRESS_WEIGHTS,
  MAX_TRACK_MS,
  MIN_TRACK_MS,
  SILENCE_PEAK_MAX,
  TEMPO_MIN_CONFIDENCE,
  TEMPO_MIN_SUPPORT_ONSETS,
} from '../core/constants';
import type { BeatmapV1, Difficulty, MusicEvent, Onset } from './types';
import { assignNotes, assignObstacles } from './assign';
import type { AssignmentInput } from './assign';
import { stft } from './dsp/stft';
import type { Band } from './dsp/stft';
import { spectralFlux } from './dsp/flux';
import { pickOnsets } from './dsp/peaks';
import { distinctOnsets, estimateTempo } from './dsp/tempo';
import { snapOnsets, trackBeats } from './dsp/beats';
import { musicEvents, normalizedEnergy, rmsEnvelope } from './dsp/energy';
import { validateBeatmap } from './validate';

export type GeneratorStage = keyof typeof GEN_PROGRESS_WEIGHTS;
export interface GeneratorProgress {
  stage: GeneratorStage | 'read' | 'decode' | 'resample' | 'cache';
  fraction: number;
}
export type SongMeta = Pick<BeatmapV1['song'], 'title' | 'artist' | 'source' | 'sourceHash'> & {
  audioUrl?: string;
};
export interface AnalysisResult {
  durationMs: number;
  bpm: number;
  beatOffsetMs: number;
  tempoConfidence: number;
  onsets: Onset[];
  beats: number[];
  energy: number[];
  events: MusicEvent[];
  centroid: Float32Array;
  power: Record<Band, Float32Array>;
  warnings: string[];
  detectedOnsetCount: number;
}
export class GeneratorError extends Error {
  constructor(
    readonly code: 'silent' | 'tooShort' | 'tooLarge' | 'unsuitable' | 'decode' | 'invalid' | 'cancelled',
    message: string,
  ) {
    super(message);
    this.name = 'GeneratorError';
  }
}
export function analyzeMono(
  mono: Float32Array,
  sr: number,
  durationMs: number,
  progress?: (value: GeneratorProgress) => void,
): AnalysisResult {
  if (sr !== ANALYSIS_SR)
    throw new GeneratorError('invalid', `Analysis requires canonical mono at ${ANALYSIS_SR} Hz`);
  if (!Number.isFinite(durationMs) || durationMs < MIN_TRACK_MS)
    throw new GeneratorError('tooShort', `Audio must be at least ${MIN_TRACK_MS / 1000} seconds`);
  if (durationMs > MAX_TRACK_MS || mono.length > Math.ceil((MAX_TRACK_MS / 1000) * ANALYSIS_SR))
    throw new GeneratorError('tooLarge', `Audio must be at most ${MAX_TRACK_MS / 60000} minutes`);
  if (Math.abs((mono.length / sr) * 1000 - durationMs) > 1000 / sr)
    throw new GeneratorError('invalid', 'PCM length does not match the declared duration');
  let peak = 0;
  for (const sample of mono) {
    if (!Number.isFinite(sample)) throw new GeneratorError('invalid', 'Audio contains invalid PCM');
    peak = Math.max(peak, Math.abs(sample));
  }
  if (peak < SILENCE_PEAK_MAX)
    throw new GeneratorError('silent', 'This audio is silent; choose a rhythmic song');
  const rawEnergy = rmsEnvelope(mono);
  const normalized = Float32Array.from(mono, (v) => (v * ANALYSIS_PEAK_TARGET) / peak);
  let fraction = 0;
  const finish = (stage: GeneratorStage): void => {
    fraction += GEN_PROGRESS_WEIGHTS[stage];
    progress?.({ stage, fraction });
  };
  const spectrum = stft(normalized);
  finish('stft');
  const flux = spectralFlux(spectrum);
  finish('flux');
  const detected = pickOnsets(flux, rawEnergy, mono);
  finish('onsets');
  const tempo = estimateTempo(flux.sum, detected);
  finish('tempo');
  const confident = tempo.confidence >= TEMPO_MIN_CONFIDENCE;
  const beats = trackBeats(tempo, detected, durationMs);
  const onsets = confident
    ? snapOnsets(detected, beats)
    : detected.filter((o) => o.strength >= FREE_RHYTHM_MIN_STRENGTH);
  finish('beats');
  if (distinctOnsets(onsets).length < TEMPO_MIN_SUPPORT_ONSETS)
    throw new GeneratorError('unsuitable', 'Too few supported musical events; choose another song');
  const energy = normalizedEnergy(rawEnergy);
  const events = musicEvents(energy, onsets, beats, tempo.bpm, confident);
  finish('energy');
  const periodMs = 60000 / tempo.bpm;
  const beatOffsetMs = ((tempo.phaseMs % periodMs) + periodMs) % periodMs;
  return {
    durationMs,
    bpm: tempo.bpm,
    beatOffsetMs,
    tempoConfidence: tempo.confidence,
    onsets,
    beats,
    energy,
    events,
    centroid: spectrum.centroid,
    power: spectrum.power,
    warnings: confident ? [] : ['lowTempoConfidence'],
    detectedOnsetCount: detected.length,
  };
}
export function mapFromAnalysis(
  analysis: AnalysisResult,
  meta: SongMeta,
  difficulty: Difficulty,
): { map: BeatmapV1; warnings: string[] } {
  const input: AssignmentInput = { ...analysis, difficulty };
  const notes = assignNotes(input),
    obstacles = assignObstacles(input, notes);
  const map: BeatmapV1 = {
    version: 1,
    generatorVersion: GENERATOR_VERSION,
    song: {
      ...meta,
      durationMs: analysis.durationMs,
      bpm: analysis.bpm,
      beatOffsetMs: analysis.beatOffsetMs,
    },
    difficulty,
    approachMs: APPROACH_MS[difficulty],
    notes,
    obstacles,
    events: analysis.events,
    analysis: { beats: analysis.beats, onsets: analysis.onsets, energy: analysis.energy },
  };
  const result = validateBeatmap(map);
  if (!result.valid)
    throw new GeneratorError('invalid', result.errors.map((e) => `${e.path}: ${e.message}`).join('; '));
  return { map, warnings: [...analysis.warnings] };
}
