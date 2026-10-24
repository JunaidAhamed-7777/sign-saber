import {
  BEAM_CHARGE_MS,
  BEAM_ISOLATION_MS,
  BEAM_MIN_SPACING_MS,
  BEAM_SUSTAIN_DB,
  BEAM_SUSTAIN_MS,
  CENTROID_ROW_HZ,
  CHORD_WINDOW_MS,
  DENSITY_WINDOW_MS,
  DSP_EPSILON,
  EASY_LOW_ROW_MIN_GAP_MS,
  EASY_OBSTACLE_MIN_GAP_MS,
  EASY_SMASH_TO_SLASH_EVERY,
  FLOW_FULL_ROW_JUMP_MIN_GAP_MS,
  FLOW_GESTURE_SWITCH_MIN_MS,
  FLOW_HAND_MIN_GAP_MS,
  FLOW_OUTER_ACCENT_EVERY,
  FLOW_OUTER_ACCENT_MIN_STRENGTH,
  FLOW_RESTART_GAP_MS,
  FLOW_RESTART_SIDE,
  MAX_DENSITY_PER_S,
  MAX_OBSTACLE_MS,
  MIN_NOTE_GAP_MS,
  MIN_OBSTACLE_GAP_MS,
  MIN_OBSTACLE_MS,
  MIN_SAME_CELL_GAP_MS,
  OBSTACLE_DURATION_BEATS,
  OBSTACLE_EMPTY_WINDOW_MS,
  OBSTACLE_INTRO_MS,
  OBSTACLE_LOOKAHEAD_BEATS,
  OBSTACLE_LOOKAHEAD_MAX_NOTES,
  OBSTACLE_PERIOD_BEATS,
  WALL_NOTE_MARGIN_MS,
} from '../core/constants';
import type { Difficulty, Note, NoteType, Obstacle, Onset } from './types';
import type { Band } from './dsp/stft';
import { HOP_MS } from './dsp/stft';

export interface AssignmentInput {
  onsets: Onset[];
  beats: number[];
  centroid: Float32Array;
  power: Record<Band, Float32Array>;
  difficulty: Difficulty;
  durationMs: number;
  bpm: number;
}
interface Candidate extends Onset {
  type: NoteType;
  index: number;
}
type Side = 'left' | 'right';
const opposite = (side: Side): Side => (side === 'left' ? 'right' : 'left');

/** Sustain uses linear STFT power; log magnitudes cannot establish a dB ratio. */
function sustains(input: AssignmentInput, onset: Onset): boolean {
  if (onset.band !== 'mid') return false;
  const first = Math.round(onset.t / HOP_MS),
    end = Math.ceil((onset.t + BEAM_SUSTAIN_MS) / HOP_MS);
  if (end >= input.power.mid.length || onset.t + BEAM_SUSTAIN_MS > input.durationMs) return false;
  let min = Infinity,
    max = 0;
  for (let n = first; n <= end; n++) {
    min = Math.min(min, input.power.mid[n]!);
    max = Math.max(max, input.power.mid[n]!);
  }
  return min > DSP_EPSILON && 10 * Math.log10(max / min) <= BEAM_SUSTAIN_DB;
}

/** Stable evidence ordering; weaker ties prefer retaining low then mid band. */
function strengthOrder(a: Candidate, b: Candidate): number {
  const priority = { low: 0, mid: 1, high: 2 };
  return (
    Number(b.type === 'beam') - Number(a.type === 'beam') ||
    b.strength - a.strength ||
    priority[a.band] - priority[b.band] ||
    a.index - b.index
  );
}

export function assignNotes(input: AssignmentInput): Note[] {
  const { difficulty, onsets, durationMs } = input;
  let smashIndex = 0,
    lastBeam = -Infinity;
  const candidates: Candidate[] = [];
  // Identical sample instants are one broadband transient. Normal/hard may retain
  // a second different-band onset at a distinct measured time in the anchored chord.
  for (let i = 0; i < onsets.length;) {
    const anchor = onsets[i]!.t;
    const group: Candidate[] = [];
    while (i < onsets.length && onsets[i]!.t - anchor < CHORD_WINDOW_MS) {
      const onset = onsets[i]!;
      group.push({ ...onset, type: onset.band === 'low' ? 'smash' : 'slash', index: i });
      i++;
    }
    group.sort(strengthOrder);
    const sustained = group.find(
      (o) => o.band === 'mid' && o.t - lastBeam >= BEAM_MIN_SPACING_MS[difficulty] && sustains(input, o),
    );
    const best = sustained ?? group[0]!;
    if (best.type === 'smash' && difficulty === 'easy' && ++smashIndex % EASY_SMASH_TO_SLASH_EVERY === 0)
      best.type = 'slash';
    // Reserve a measured sustained-mid onset. Other musical evidence is retained in
    // diagnostics, but conflicting playable candidates are removed below so a player
    // can acquire, charge and release the beam. The timestamp itself is never moved.
    if (sustained) {
      best.type = 'beam';
      lastBeam = best.t;
    }
    if (best.t >= 0 && best.t <= durationMs) candidates.push(best);
    if (!sustained && difficulty !== 'easy') {
      const independent = group.find((o) => o !== best && o.band !== best.band && o.t !== best.t);
      if (independent && independent.t >= 0 && independent.t <= durationMs) candidates.push(independent);
    }
  }
  candidates.sort((a, b) => a.t - b.t || a.index - b.index);
  // Stronger nearby evidence wins before density caps. Removals never invent onsets.
  const spacedGroups: Candidate[][] = [];
  const reserved = candidates.filter((c) => c.type === 'beam');
  const beamSpace = Math.max(BEAM_ISOLATION_MS, BEAM_CHARGE_MS + FLOW_GESTURE_SWITCH_MIN_MS);
  const usable = candidates.filter(
    (candidate) =>
      candidate.type === 'beam' || !reserved.some((beam) => Math.abs(candidate.t - beam.t) <= beamSpace),
  );
  for (let i = 0; i < usable.length;) {
    const candidate = usable[i]!,
      group = [candidate];
    i++;
    if (
      difficulty !== 'easy' &&
      candidate.type !== 'beam' &&
      usable[i] &&
      usable[i]!.type !== 'beam' &&
      usable[i]!.band !== candidate.band &&
      usable[i]!.t - candidate.t < CHORD_WINDOW_MS
    )
      group.push(usable[i++]!);
    const previous = spacedGroups.at(-1);
    const minGap =
      candidate.type === 'beam' || previous?.[0]?.type === 'beam'
        ? Math.max(
            MIN_NOTE_GAP_MS[difficulty],
            BEAM_ISOLATION_MS,
            BEAM_CHARGE_MS + FLOW_GESTURE_SWITCH_MIN_MS,
          )
        : MIN_NOTE_GAP_MS[difficulty];
    if (previous && candidate.t - previous[0]!.t < minGap) {
      const currentBest = [...group].sort(strengthOrder)[0]!,
        previousBest = [...previous].sort(strengthOrder)[0]!;
      if (strengthOrder(currentBest, previousBest) < 0) {
        spacedGroups.pop();
        const earlier = spacedGroups.at(-1);
        if (!earlier || candidate.t - earlier[0]!.t >= minGap) spacedGroups.push(group);
      }
    } else spacedGroups.push(group);
  }
  const spaced = spacedGroups.flat();
  const removed = new Set<Candidate>();
  const cap = Math.floor((MAX_DENSITY_PER_S[difficulty] * DENSITY_WINDOW_MS) / 1000);
  for (let i = 0; i < spaced.length; i++) {
    if (removed.has(spaced[i]!)) continue;
    const window: Candidate[] = [];
    for (let j = i; j < spaced.length && spaced[j]!.t < spaced[i]!.t + DENSITY_WINDOW_MS; j++)
      if (!removed.has(spaced[j]!)) window.push(spaced[j]!);
    window.sort(strengthOrder);
    for (let j = cap; j < window.length; j++) removed.add(window[j]!);
  }
  const notes: Note[] = [];
  let lastSide: Side = opposite(FLOW_RESTART_SIDE),
    lastLow = -Infinity;
  const lastBySide: Partial<Record<Side, Note>> = {};
  const accents = { left: 0, right: 0 };
  const cellTimes = new Map<string, number>();
  for (const candidate of spaced) {
    if (removed.has(candidate)) continue;
    const previous = notes.at(-1);
    let side: Side =
      !previous || candidate.t - previous.t > FLOW_RESTART_GAP_MS ? FLOW_RESTART_SIDE : opposite(lastSide);
    const compatible = (hand: Side): boolean => {
      const prior = lastBySide[hand];
      return (
        !prior ||
        (candidate.t - prior.t >= FLOW_HAND_MIN_GAP_MS &&
          (prior.type === candidate.type || candidate.t - prior.t >= FLOW_GESTURE_SWITCH_MIN_MS))
      );
    };
    if (!compatible(side)) side = opposite(side);
    if (!compatible(side)) continue;
    let col: Note['col'] = side === 'left' ? 1 : 2;
    accents[side]++;
    if (
      candidate.type === 'beam' ||
      (candidate.type !== 'smash' &&
        accents[side] % FLOW_OUTER_ACCENT_EVERY === 0 &&
        candidate.strength >= FLOW_OUTER_ACCENT_MIN_STRENGTH)
    )
      col = side === 'left' ? 0 : 3;
    const centroid =
      input.centroid[Math.min(input.centroid.length - 1, Math.round(candidate.t / HOP_MS))] ?? 0;
    let row: Note['row'] =
      candidate.type === 'beam'
        ? 2
        : centroid < CENTROID_ROW_HZ[0]
          ? 0
          : centroid < CENTROID_ROW_HZ[1]
            ? 1
            : 2;
    if (
      previous &&
      Math.abs(previous.row - row) === 2 &&
      candidate.t - previous.t < FLOW_FULL_ROW_JUMP_MIN_GAP_MS
    )
      row = 1;
    if (difficulty === 'easy' && row === 0 && candidate.t - lastLow < EASY_LOW_ROW_MIN_GAP_MS) row = 1;
    if (candidate.t - (cellTimes.get(`${col}:${row}`) ?? -Infinity) < MIN_SAME_CELL_GAP_MS)
      col = side === 'left' ? (col === 0 ? 1 : 0) : col === 2 ? 3 : 2;
    if (candidate.t - (cellTimes.get(`${col}:${row}`) ?? -Infinity) < MIN_SAME_CELL_GAP_MS) row = 1;
    if (candidate.t - (cellTimes.get(`${col}:${row}`) ?? -Infinity) < MIN_SAME_CELL_GAP_MS) continue;
    const note: Note = {
      id: notes.length,
      t: candidate.t,
      type: candidate.type,
      col,
      row,
      dir: 'any',
      strength: candidate.strength,
    };
    notes.push(note);
    lastBySide[side] = note;
    lastSide = side;
    cellTimes.set(`${col}:${row}`, note.t);
    if (row === 0) lastLow = note.t;
  }
  // A density removal can remove a chord's first member and shift its anchor.
  // Recompute anchored groups after all removals; conflicts are removed, never retimed.
  const final: Note[] = [];
  let lastAnchor = -Infinity;
  for (let i = 0; i < notes.length;) {
    const first = notes[i]!,
      group = [first];
    i++;
    while (i < notes.length && notes[i]!.t - first.t < CHORD_WINDOW_MS) group.push(notes[i++]!);
    const previous = final.at(-1);
    if (first.t - lastAnchor < MIN_NOTE_GAP_MS[difficulty]) continue;
    if (
      previous &&
      Math.abs(first.row - previous.row) === 2 &&
      first.t - previous.t < FLOW_FULL_ROW_JUMP_MIN_GAP_MS
    )
      continue;
    for (const note of group) final.push({ ...note, id: final.length });
    lastAnchor = first.t;
  }
  return final;
}

export function assignObstacles(input: AssignmentInput, notes: Note[]): Obstacle[] {
  const { difficulty, durationMs, beats, bpm } = input;
  const periodMs = 60000 / bpm,
    candidates = new Set<number>();
  // Quiet spans are real gaps between accepted note evidence.
  let previous = 0;
  for (const note of [...notes, { t: durationMs }]) {
    if (note.t - previous >= OBSTACLE_EMPTY_WINDOW_MS) candidates.add(previous + WALL_NOTE_MARGIN_MS);
    previous = note.t;
  }
  if (difficulty !== 'easy')
    for (let i = OBSTACLE_PERIOD_BEATS; i < beats.length; i += OBSTACLE_PERIOD_BEATS)
      candidates.add(beats[i]!);
  const result: Obstacle[] = [];
  let lastKind: Obstacle['kind'] = FLOW_RESTART_SIDE === 'right' ? 'wallRight' : 'wallLeft';
  const occupancy = Math.max(
    MIN_OBSTACLE_MS,
    Math.min(MAX_OBSTACLE_MS, OBSTACLE_DURATION_BEATS[difficulty] * periodMs),
  );
  const gap =
    difficulty === 'easy' ? Math.max(MIN_OBSTACLE_GAP_MS, EASY_OBSTACLE_MIN_GAP_MS) : MIN_OBSTACLE_GAP_MS;
  for (const t of [...candidates].sort((a, b) => a - b)) {
    if (t < OBSTACLE_INTRO_MS || t + occupancy > durationMs || t - (result.at(-1)?.t ?? -Infinity) < gap)
      continue;
    const upcoming = notes.filter((n) => n.t >= t && n.t <= t + OBSTACLE_LOOKAHEAD_BEATS * periodMs);
    if (difficulty === 'normal' && upcoming.length > OBSTACLE_LOOKAHEAD_MAX_NOTES) continue;
    const right = upcoming.filter((n) => n.col >= 2).length,
      left = upcoming.length - right;
    const kind: Obstacle['kind'] =
      right === left
        ? lastKind === 'wallLeft'
          ? 'wallRight'
          : 'wallLeft'
        : right > left
          ? 'wallLeft'
          : 'wallRight';
    if (
      notes.some(
        (n) =>
          n.t >= t - WALL_NOTE_MARGIN_MS &&
          n.t <= t + occupancy + WALL_NOTE_MARGIN_MS &&
          (kind === 'wallLeft' ? n.col < 2 : n.col >= 2),
      )
    )
      continue;
    result.push({ id: result.length, t, durationMs: occupancy, kind });
    lastKind = kind;
  }
  return result;
}
