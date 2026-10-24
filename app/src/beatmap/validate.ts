import {
  APPROACH_MS,
  ASSET_TEXT_MAX_CHARS,
  BEAM_ESCAPE_MS,
  BEAM_ISOLATION_MS,
  BEAM_LEAD_MS,
  CHORD_WINDOW_MS,
  DENSITY_WINDOW_MS,
  EASY_LOW_ROW_MIN_GAP_MS,
  EASY_OBSTACLE_MIN_GAP_MS,
  ENERGY_HOP_MS,
  FLOW_FULL_ROW_JUMP_MIN_GAP_MS,
  GENERATOR_VERSION,
  INPUT_MAX_AGE_MS,
  MAX_DENSITY_PER_S,
  MAX_LIVE_NOTES,
  MAX_OBSTACLE_MS,
  MAX_TRACK_MS,
  MAX_VISIBLE_NOTES,
  MIN_NOTE_GAP_MS,
  MIN_OBSTACLE_GAP_MS,
  MIN_OBSTACLE_MS,
  MIN_SAME_CELL_GAP_MS,
  MIN_TRACK_MS,
  OBSTACLE_INTRO_MS,
  VALIDATION_MAX_ERRORS,
  WALL_NOTE_MARGIN_MS,
  WINDOW_GOOD_MS,
} from '../core/constants';
import type { BeatmapV1, Difficulty, Note, Obstacle, Onset } from './types';
import { HOP_MS } from './dsp/stft';
import { handGapMs } from './assign';

export interface ValidationError {
  path: string;
  message: string;
}
export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  map?: BeatmapV1;
}
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
export const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
export const isHash = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const isBoundedText = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= ASSET_TEXT_MAX_CHARS;
export function isLocalTrackAsset(value: unknown, slug?: string, file?: string): value is string {
  if (typeof value !== 'string') return false;
  const match =
    /^\/assets\/tracks\/([a-z0-9]+(?:-[a-z0-9]+)*)\/(audio\.mp3|easy\.json|normal\.json|hard\.json|cover\.webp)$/.exec(
      value,
    );
  return !!match && (!slug || match[1] === slug) && (!file || match[2] === file);
}
const includes = (values: readonly string[], value: unknown): value is string =>
  typeof value === 'string' && values.includes(value);

/** Bounded structural validation precedes all timing/ergonomic work. */
export function validateBeatmap(value: unknown): ValidationResult {
  const errors: ValidationError[] = [];
  const fail = (path: string, message: string): void => {
    if (errors.length < VALIDATION_MAX_ERRORS) errors.push({ path, message });
  };
  const done = (): ValidationResult =>
    errors.length ? { valid: false, errors } : { valid: true, errors, map: value as BeatmapV1 };
  if (!isRecord(value)) {
    fail('$', 'Expected a beatmap object');
    return done();
  }
  if (value.version !== 1) fail('version', 'Only schema version 1 is supported');
  if (!Number.isInteger(value.generatorVersion) || value.generatorVersion !== GENERATOR_VERSION)
    fail('generatorVersion', 'Unsupported generator version; regenerate with this build');
  if (!includes(['easy', 'normal', 'hard'], value.difficulty))
    fail('difficulty', 'Expected easy, normal or hard');
  const difficulty: Difficulty = includes(['easy', 'normal', 'hard'], value.difficulty)
    ? (value.difficulty as Difficulty)
    : 'normal';
  if (value.approachMs !== APPROACH_MS[difficulty])
    fail('approachMs', 'Must match the registered difficulty preset');
  if (!isRecord(value.song)) {
    fail('song', 'Expected song metadata');
    return done();
  }
  const song = value.song;
  if (!isBoundedText(song.title)) fail('song.title', 'Expected a bounded non-empty title');
  if (!isBoundedText(song.artist)) fail('song.artist', 'Expected a bounded non-empty artist');
  if (!isFiniteNumber(song.durationMs) || song.durationMs < MIN_TRACK_MS || song.durationMs > MAX_TRACK_MS)
    fail('song.durationMs', 'Duration is outside supported admission limits');
  if (!isFiniteNumber(song.bpm) || song.bpm < 40 || song.bpm > 240)
    fail('song.bpm', 'BPM must be between 40 and 240');
  if (
    !isFiniteNumber(song.beatOffsetMs) ||
    song.beatOffsetMs < 0 ||
    !isFiniteNumber(song.bpm) ||
    song.beatOffsetMs >= 60000 / song.bpm
  )
    fail('song.beatOffsetMs', 'Expected a phase in one beat period');
  if (!isHash(song.sourceHash)) fail('song.sourceHash', 'Expected lowercase SHA-256');
  if (!includes(['bundled', 'upload', 'youtube'], song.source)) fail('song.source', 'Unsupported source');
  if (
    song.source === 'bundled'
      ? !isLocalTrackAsset(song.audioUrl, undefined, 'audio.mp3')
      : song.audioUrl !== undefined
  )
    fail('song.audioUrl', 'Only bundled sources may reference their local audio.mp3');
  const duration = isFiniteNumber(song.durationMs) ? Math.min(MAX_TRACK_MS, Math.max(0, song.durationMs)) : 0;
  const noteLimit = Math.ceil(MAX_TRACK_MS / MIN_NOTE_GAP_MS.hard) * 2;
  const obstacleLimit = Math.ceil(MAX_TRACK_MS / MIN_OBSTACLE_GAP_MS);
  const eventLimit = Math.ceil(MAX_TRACK_MS / HOP_MS) * 4;
  for (const [key, max] of [
    ['notes', noteLimit],
    ['obstacles', obstacleLimit],
    ['events', eventLimit],
  ] as const) {
    if (!Array.isArray(value[key]) || value[key].length > max) fail(key, 'Missing or oversized array');
  }
  if (!isRecord(value.analysis)) fail('analysis', 'Expected analysis object');
  if (errors.length) return done();
  const rawNotes = value.notes as unknown[],
    rawObstacles = value.obstacles as unknown[],
    rawEvents = value.events as unknown[];
  const time = (n: unknown): boolean => isFiniteNumber(n) && n >= 0 && n <= duration;
  const strength = (n: unknown): boolean => isFiniteNumber(n) && n >= 0 && n <= 1;
  let lastTime = -Infinity,
    lastId = -1;
  rawNotes.forEach((note, i) => {
    const path = `notes[${i}]`;
    if (!isRecord(note)) {
      fail(path, 'Expected note object');
      return;
    }
    if (!Number.isInteger(note.id) || (note.id as number) < 0 || (note.id as number) <= lastId)
      fail(`${path}.id`, 'IDs must be non-negative ascending integers');
    if (!time(note.t) || (note.t as number) < lastTime)
      fail(`${path}.t`, 'Times must be finite, in song bounds and sorted');
    if (!includes(['slash', 'smash', 'beam'], note.type)) fail(`${path}.type`, 'Unsupported note type');
    if (!Number.isInteger(note.col) || (note.col as number) < 0 || (note.col as number) > 3)
      fail(`${path}.col`, 'Column must be 0..3');
    if (!Number.isInteger(note.row) || (note.row as number) < 0 || (note.row as number) > 2)
      fail(`${path}.row`, 'Row must be 0..2');
    if (note.dir !== 'any') fail(`${path}.dir`, 'Directional maps are unsupported in v1');
    if (!strength(note.strength)) fail(`${path}.strength`, 'Strength must be 0..1');
    lastTime = note.t as number;
    lastId = note.id as number;
  });
  if (!rawNotes.length) fail('notes', 'A playable map requires at least one real note');
  lastTime = -Infinity;
  lastId = -1;
  rawObstacles.forEach((obstacle, i) => {
    const path = `obstacles[${i}]`;
    if (!isRecord(obstacle)) {
      fail(path, 'Expected obstacle object');
      return;
    }
    if (!Number.isInteger(obstacle.id) || (obstacle.id as number) < 0 || (obstacle.id as number) <= lastId)
      fail(`${path}.id`, 'IDs must be non-negative ascending integers');
    if (!time(obstacle.t) || (obstacle.t as number) < lastTime)
      fail(`${path}.t`, 'Obstacle times must be in song bounds and sorted');
    if (
      !isFiniteNumber(obstacle.durationMs) ||
      obstacle.durationMs < MIN_OBSTACLE_MS ||
      obstacle.durationMs > MAX_OBSTACLE_MS ||
      (obstacle.t as number) + obstacle.durationMs > duration
    )
      fail(`${path}.durationMs`, 'Wall occupancy must fit duration and song bounds');
    if (!includes(['wallLeft', 'wallRight'], obstacle.kind))
      fail(`${path}.kind`, 'Only left and right walls are supported');
    lastTime = obstacle.t as number;
    lastId = obstacle.id as number;
  });
  lastTime = -Infinity;
  rawEvents.forEach((event, i) => {
    if (
      !isRecord(event) ||
      !time(event.t) ||
      (event.t as number) < lastTime ||
      !strength(event.intensity) ||
      !includes(['kick', 'drop', 'build', 'calm'], event.kind)
    ) {
      fail(`events[${i}]`, 'Invalid or unsorted music event');
      return;
    }
    lastTime = event.t as number;
  });
  const analysis = value.analysis as Record<string, unknown>;
  if (!Array.isArray(analysis.beats) || analysis.beats.length > Math.ceil(duration / HOP_MS) + 1)
    fail('analysis.beats', 'Missing or oversized beats');
  else {
    lastTime = -Infinity;
    analysis.beats.forEach((beat, i) => {
      if (!time(beat) || (beat as number) < lastTime)
        fail(`analysis.beats[${i}]`, 'Invalid or unsorted beat');
      lastTime = beat as number;
    });
  }
  if (!Array.isArray(analysis.onsets) || analysis.onsets.length > eventLimit)
    fail('analysis.onsets', 'Missing or oversized onsets');
  else {
    lastTime = -Infinity;
    analysis.onsets.forEach((onset, i) => {
      if (
        !isRecord(onset) ||
        !time(onset.t) ||
        (onset.t as number) < lastTime ||
        !strength(onset.strength) ||
        !includes(['low', 'mid', 'high'], onset.band)
      ) {
        fail(`analysis.onsets[${i}]`, 'Invalid or unsorted onset');
        return;
      }
      lastTime = onset.t as number;
    });
  }
  if (
    !Array.isArray(analysis.energy) ||
    analysis.energy.length > Math.ceil(duration / ENERGY_HOP_MS) + 1 ||
    !analysis.energy.every(strength)
  )
    fail('analysis.energy', 'Invalid or oversized energy envelope');
  if (errors.length) return done();

  const notes = rawNotes as Note[],
    obstacles = rawObstacles as Obstacle[];
  const knownOnsets = analysis.onsets as Onset[];
  const cells = new Map<string, number>();
  const lastSide: (Note | undefined)[] = [];
  let group: Note[] = [],
    previousGroupTime = -Infinity,
    lowRow = -Infinity;
  let densityEnd = 0,
    visibleEnd = 0,
    onsetStart = 0;
  const densityCap = Math.floor((MAX_DENSITY_PER_S[difficulty] * DENSITY_WINDOW_MS) / 1000);
  for (let i = 0; i < notes.length; i++) {
    const note = notes[i]!,
      prior = notes[i - 1];
    const key = `${note.col}:${note.row}`;
    if (note.t - (cells.get(key) ?? -Infinity) < MIN_SAME_CELL_GAP_MS)
      fail(`notes[${i}]`, 'Same-cell notes are too close');
    cells.set(key, note.t);
    if (!group.length || note.t - group[0]!.t >= CHORD_WINDOW_MS) {
      if (note.t - previousGroupTime < MIN_NOTE_GAP_MS[difficulty])
        fail(`notes[${i}]`, 'Anchored note groups are too close');
      previousGroupTime = note.t;
      group = [note];
    } else {
      group.push(note);
      if (difficulty === 'easy' || group.length > 2 || group[0]!.col < 2 === note.col < 2)
        fail(`notes[${i}]`, 'Invalid chord size, difficulty or side');
      if (knownOnsets.length && group.length === 2) {
        while (onsetStart < knownOnsets.length && knownOnsets[onsetStart]!.t < group[0]!.t - CHORD_WINDOW_MS)
          onsetStart++;
        const bands = new Set<Onset['band']>();
        for (
          let onset = onsetStart;
          onset < knownOnsets.length && knownOnsets[onset]!.t <= note.t + CHORD_WINDOW_MS;
          onset++
        )
          bands.add(knownOnsets[onset]!.band);
        if (bands.size < 2) fail(`notes[${i}]`, 'Chord lacks different-band supporting evidence');
      }
    }
    while (densityEnd < notes.length && notes[densityEnd]!.t < note.t + DENSITY_WINDOW_MS) densityEnd++;
    if (densityEnd - i > densityCap) fail(`notes[${i}]`, 'Sliding-window density exceeds preset');
    while (visibleEnd < notes.length && notes[visibleEnd]!.t < note.t + APPROACH_MS[difficulty]) visibleEnd++;
    if (visibleEnd - i > MAX_VISIBLE_NOTES[difficulty])
      fail(`notes[${i}]`, 'Too many notes share the screen within one approach span');
    if (note.type === 'beam') {
      if (
        (prior && note.t - prior.t <= BEAM_ISOLATION_MS) ||
        (notes[i + 1] && notes[i + 1]!.t - note.t <= BEAM_ISOLATION_MS)
      )
        fail(`notes[${i}]`, 'Beam lacks isolation');
    }
    const side = note.col < 2 ? 0 : 1,
      priorHand = lastSide[side];
    if (priorHand && note.t - priorHand.t < handGapMs(priorHand.type, note.type))
      fail(`notes[${i}]`, 'Expected hand lacks recovery/gesture transition space');
    lastSide[side] = note;
    if (prior && Math.abs(note.row - prior.row) === 2 && note.t - prior.t < FLOW_FULL_ROW_JUMP_MIN_GAP_MS)
      fail(`notes[${i}]`, 'Full-height row jump is too quick');
    if (difficulty === 'easy' && note.row === 0) {
      if (note.t - lowRow < EASY_LOW_ROW_MIN_GAP_MS)
        fail(`notes[${i}]`, 'Easy low-row recovery is too short');
      lowRow = note.t;
    }
  }
  let noteStart = 0;
  for (let i = 0; i < obstacles.length; i++) {
    const obstacle = obstacles[i]!,
      prior = obstacles[i - 1];
    const gap =
      difficulty === 'easy' ? Math.max(EASY_OBSTACLE_MIN_GAP_MS, MIN_OBSTACLE_GAP_MS) : MIN_OBSTACLE_GAP_MS;
    if (prior && obstacle.t - prior.t < gap) fail(`obstacles[${i}]`, 'Walls are too close');
    if (obstacle.t < OBSTACLE_INTRO_MS)
      fail(`obstacles[${i}]`, 'Wall occurs during the wall-free introduction');
    while (noteStart < notes.length && notes[noteStart]!.t < obstacle.t - WALL_NOTE_MARGIN_MS) noteStart++;
    for (
      let n = noteStart;
      n < notes.length && notes[n]!.t <= obstacle.t + obstacle.durationMs + WALL_NOTE_MARGIN_MS;
      n++
    ) {
      if (obstacle.kind === 'wallLeft' ? notes[n]!.col < 2 : notes[n]!.col >= 2)
        fail(`obstacles[${i}]`, 'Wall overlaps a covered-column note safety margin');
    }
  }
  const starts = notes
    .map((n) => n.t - (n.type === 'beam' ? BEAM_LEAD_MS : APPROACH_MS[difficulty]))
    .sort((a, b) => a - b);
  const ends = notes
    .map((n) => n.t + (n.type === 'beam' ? BEAM_ESCAPE_MS : WINDOW_GOOD_MS) + INPUT_MAX_AGE_MS)
    .sort((a, b) => a - b);
  let ended = 0;
  for (let i = 0; i < starts.length; i++) {
    while (ended < ends.length && ends[ended]! < starts[i]!) ended++;
    if (i + 1 - ended > MAX_LIVE_NOTES) {
      fail('notes', 'Map exceeds logical note capacity');
      break;
    }
  }
  return done();
}
