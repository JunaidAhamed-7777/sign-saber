/**
 * Note and wall assignment (generator v3). docs/08-beatmap-generation.md §9–§10
 *
 * The chart follows the strongest measured accents rather than every onset: musical events are
 * picked by salience under hard readability caps (minimum gaps, sliding density, simultaneous
 * on-screen notes, a two-hand recovery budget and deliberate phrase rests). Gestures are then mixed
 * per phrase, hands alternate on their own side of the grid and walls reserve a one-hand passage.
 * Every note keeps the timestamp of a real onset; removals never invent or move evidence.
 */
import {
  APPROACH_MS,
  BEAM_ISOLATION_MS,
  BEAM_MIN_SPACING_MS,
  BEAM_SUSTAIN_DB,
  BEAM_SUSTAIN_MAX_DB,
  BEAM_SUSTAIN_MS,
  BEAM_SUSTAIN_PERCENTILE,
  CENTROID_ROW_HZ,
  CHORD_MIN_SPACING_MS,
  CHORD_MIN_STRENGTH,
  CHORD_WINDOW_MS,
  DENSITY_ENERGY_FLOOR,
  DENSITY_ENERGY_SMOOTH_MS,
  DENSITY_WINDOW_MS,
  DSP_EPSILON,
  EASY_LOW_ROW_MIN_GAP_MS,
  EASY_OBSTACLE_MIN_GAP_MS,
  ENERGY_HOP_MS,
  FLOW_FULL_ROW_JUMP_MIN_GAP_MS,
  FLOW_GESTURE_CHANGE_MS,
  FLOW_HAND_FOLLOW_MS,
  FLOW_HAND_LEAD_MS,
  FLOW_OUTER_ACCENT_EVERY,
  FLOW_OUTER_ACCENT_MIN_STRENGTH,
  FLOW_RESTART_SIDE,
  GESTURE_MIX_WINDOW_MS,
  MAX_DENSITY_PER_S,
  MAX_OBSTACLE_MS,
  MAX_VISIBLE_NOTES,
  MIN_NOTE_GAP_MS,
  MIN_OBSTACLE_GAP_MS,
  MIN_OBSTACLE_MS,
  OBSTACLE_DURATION_BEATS,
  OBSTACLE_INTRO_MS,
  OBSTACLE_PERIOD_BEATS,
  OBSTACLE_SPACING_MS,
  PHRASE_MAX_MS,
  PHRASE_REST_MS,
  SMASH_MAX_SHARE,
  SMASH_MIN_LOW_STRENGTH,
  WALL_NOTE_MARGIN_MS,
} from '../core/constants';
import type { Difficulty, Note, NoteType, Obstacle, Onset } from './types';
import type { Band } from './dsp/stft';
import { HOP_MS } from './dsp/stft';
import { movingAverage, percentile } from './dsp/numeric';

export interface AssignmentInput {
  onsets: Onset[];
  beats: number[];
  centroid: Float32Array;
  power: Record<Band, Float32Array>;
  /** Normalized RMS envelope at ENERGY_HOP_MS; quiet passages thin out. Absent = uniform energy. */
  energy?: ArrayLike<number>;
  difficulty: Difficulty;
  durationMs: number;
  bpm: number;
}
type Side = 'left' | 'right';
const opposite = (side: Side): Side => (side === 'left' ? 'right' : 'left');
const BAND_ORDER: Record<Band, number> = { low: 0, mid: 1, high: 2 };
/** Hand-recovery class of a gesture. */
const motion = (type: NoteType): keyof typeof FLOW_HAND_LEAD_MS => (type === 'beam' ? 'beam' : 'strike');

/** Minimum same-hand spacing between two consecutive contacts of the given gestures. */
export function handGapMs(previous: NoteType, next: NoteType): number {
  return (
    FLOW_HAND_FOLLOW_MS[motion(previous)] +
    FLOW_HAND_LEAD_MS[motion(next)] +
    (previous === next ? 0 : FLOW_GESTURE_CHANGE_MS)
  );
}
/** Worst case before gestures are known: the slowest recovery into any following contact. */
const worstHandGap = (previousBeam: boolean, nextBeam: boolean): number =>
  (previousBeam ? FLOW_HAND_FOLLOW_MS.beam : FLOW_HAND_FOLLOW_MS.strike) +
  (nextBeam ? FLOW_HAND_LEAD_MS.beam : FLOW_HAND_LEAD_MS.strike) +
  FLOW_GESTURE_CHANGE_MS;

interface MusicalEvent {
  index: number;
  primary: Onset;
  /** Strongest different-band member at a distinct instant: independent evidence for a chord. */
  partner: Onset | null;
  salience: number;
  low: number;
  upper: number;
  /** Most sustained mid/high member within the beam limit; a beam keeps this onset's time. */
  sustained: Onset | null;
}
interface Pick {
  event: MusicalEvent;
  start: number;
  beam: boolean;
  chord: boolean;
  type: NoteType;
}

/**
 * Level variation (dB) of a mid/high onset's own band over BEAM_SUSTAIN_MS, from linear STFT power;
 * log magnitudes cannot establish a dB ratio. Infinity when the span is unavailable or silent.
 */
function sustainDb(input: AssignmentInput, onset: Onset): number {
  if (onset.band === 'low') return Infinity;
  const power = input.power[onset.band];
  const first = Math.round(onset.t / HOP_MS),
    end = Math.ceil((onset.t + BEAM_SUSTAIN_MS) / HOP_MS);
  if (end >= power.length || onset.t + BEAM_SUSTAIN_MS > input.durationMs) return Infinity;
  let min = Infinity,
    max = 0;
  for (let n = first; n <= end; n++) {
    min = Math.min(min, power[n]!);
    max = Math.max(max, power[n]!);
  }
  return min > DSP_EPSILON ? 10 * Math.log10(max / min) : Infinity;
}

/** Anchored CHORD_WINDOW_MS groups: one broadband transient is one musical event. */
function musicalEvents(input: AssignmentInput): MusicalEvent[] {
  const { onsets, durationMs } = input;
  const sustain = new Map(onsets.map((o) => [o, sustainDb(input, o)]));
  // Flat sustains qualify outright; otherwise the song's most sustained onsets, under a ceiling.
  const relative = percentile(
    [...sustain.values()].filter((db) => Number.isFinite(db)),
    BEAM_SUSTAIN_PERCENTILE,
  );
  const sustainLimit = Math.max(BEAM_SUSTAIN_DB, Math.min(BEAM_SUSTAIN_MAX_DB, relative));
  const events: MusicalEvent[] = [];
  for (let i = 0; i < onsets.length;) {
    const anchor = onsets[i]!.t;
    const members: Onset[] = [];
    while (i < onsets.length && onsets[i]!.t - anchor < CHORD_WINDOW_MS) members.push(onsets[i++]!);
    const inSong = members.filter((o) => o.t >= 0 && o.t <= durationMs);
    if (!inSong.length) continue;
    inSong.sort((a, b) => b.strength - a.strength || BAND_ORDER[a.band] - BAND_ORDER[b.band] || a.t - b.t);
    const primary = inSong[0]!;
    const partner = inSong.find((o) => o.band !== primary.band && o.t !== primary.t) ?? null;
    const second = inSong.find((o) => o.band !== primary.band);
    const strongest = (band: Band): number =>
      inSong.reduce((max, o) => (o.band === band ? Math.max(max, o.strength) : max), 0);
    events.push({
      index: events.length,
      primary,
      partner,
      // Multi-band transients read as accents; a lone band keeps its own strength.
      salience: primary.strength + 0.25 * (second?.strength ?? 0),
      low: strongest('low'),
      upper: Math.max(strongest('mid'), strongest('high')),
      sustained:
        inSong
          .filter((o) => sustain.get(o)! <= sustainLimit)
          .sort((a, b) => sustain.get(a)! - sustain.get(b)! || a.t - b.t)[0] ?? null,
    });
  }
  return events;
}

/** Walls are planned on the tracked beat cadence before notes, so notes can make room for them. */
function wallPlan(input: AssignmentInput): Obstacle[] {
  const { difficulty, durationMs, beats, bpm } = input;
  const periodMs = 60000 / bpm;
  const occupancy = Math.max(
    MIN_OBSTACLE_MS,
    Math.min(MAX_OBSTACLE_MS, OBSTACLE_DURATION_BEATS[difficulty] * periodMs),
  );
  const gap = Math.max(
    OBSTACLE_SPACING_MS[difficulty],
    difficulty === 'easy' ? Math.max(MIN_OBSTACLE_GAP_MS, EASY_OBSTACLE_MIN_GAP_MS) : MIN_OBSTACLE_GAP_MS,
  );
  // Lean toward the restart side first; walls then alternate so the body returns to centre.
  let kind: Obstacle['kind'] = FLOW_RESTART_SIDE === 'right' ? 'wallLeft' : 'wallRight';
  const walls: Obstacle[] = [];
  const every = OBSTACLE_PERIOD_BEATS[difficulty];
  for (let i = every; i < beats.length; i += every) {
    const t = beats[i]!;
    if (t < OBSTACLE_INTRO_MS || t + occupancy > durationMs) continue;
    if (t - (walls.at(-1)?.t ?? -Infinity) < gap) continue;
    walls.push({ id: walls.length, t, durationMs: occupancy, kind });
    kind = kind === 'wallLeft' ? 'wallRight' : 'wallLeft';
  }
  return walls;
}
/** The wall whose covered-column safety span contains `t`, if any. */
function wallAt(walls: Obstacle[], t: number): Obstacle | undefined {
  return walls.find(
    (w) => t >= w.t - WALL_NOTE_MARGIN_MS - CHORD_WINDOW_MS && t <= w.t + w.durationMs + WALL_NOTE_MARGIN_MS,
  );
}
const openSide = (wall: Obstacle): Side => (wall.kind === 'wallLeft' ? 'right' : 'left');

/** Selects musical events by salience under every timing cap; returns picks sorted by time. */
function selectPicks(input: AssignmentInput, events: MusicalEvent[], walls: Obstacle[]): Pick[] {
  const { difficulty } = input;
  const smoothed = input.energy?.length
    ? movingAverage(input.energy, Math.max(1, Math.ceil(DENSITY_ENERGY_SMOOTH_MS / ENERGY_HOP_MS)))
    : null;
  const energyAt = (t: number): number =>
    smoothed
      ? Math.max(0, Math.min(1, smoothed[Math.min(smoothed.length - 1, Math.floor(t / ENERGY_HOP_MS))]!))
      : 1;
  const localGap = (t: number): number =>
    MIN_NOTE_GAP_MS[difficulty] / (DENSITY_ENERGY_FLOOR + (1 - DENSITY_ENERGY_FLOOR) * energyAt(t));
  const densityCap = Math.floor((MAX_DENSITY_PER_S[difficulty] * DENSITY_WINDOW_MS) / 1000);
  const accepted: Pick[] = [];
  const insertAt = (start: number): number => {
    let lo = 0,
      hi = accepted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (accepted[mid]!.start <= start) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const weight = (p: Pick): number => (p.chord ? 2 : 1);
  /** Largest note count of any half-open window of `span` ms that contains the candidate. */
  const windowLoad = (list: Pick[], at: number, span: number): number => {
    let worst = 0;
    for (let s = at; s >= 0 && list[s]!.start > list[at]!.start - span; s--) {
      let count = 0;
      for (let e = s; e < list.length && list[e]!.start < list[s]!.start + span; e++)
        count += weight(list[e]!);
      worst = Math.max(worst, count);
    }
    return worst;
  };
  /** Two-hand budget: the third-latest contact must leave the reused hand enough recovery. */
  const handsFit = (list: Pick[], at: number): boolean => {
    const slots: Pick[] = [];
    for (let i = Math.max(0, at - 3); i < Math.min(list.length, at + 4); i++) {
      slots.push(list[i]!);
      if (list[i]!.chord) slots.push(list[i]!);
    }
    for (let k = 2; k < slots.length; k++) {
      const a = slots[k - 2]!,
        b = slots[k]!;
      if (a === b) continue;
      if (b.start - a.start < worstHandGap(a.beam, b.beam)) return false;
    }
    // Inside a wall's span only the open hand plays: consecutive contacts share it.
    for (let k = 1; k < slots.length; k++) {
      const a = slots[k - 1]!,
        b = slots[k]!;
      if (a === b) continue;
      const wall = wallAt(walls, b.start);
      if (wall && wall === wallAt(walls, a.start) && b.start - a.start < worstHandGap(a.beam, b.beam))
        return false;
    }
    return true;
  };
  const fits = (candidate: Pick): boolean => {
    const wall = wallAt(walls, candidate.start);
    if (wall && (difficulty === 'easy' || candidate.chord)) return false;
    const at = insertAt(candidate.start);
    for (const neighbour of [accepted[at - 1], accepted[at]]) {
      if (!neighbour) continue;
      let need = Math.max(localGap(candidate.start), localGap(neighbour.start));
      if (candidate.beam || neighbour.beam) need = Math.max(need, BEAM_ISOLATION_MS + CHORD_WINDOW_MS + 1);
      if (Math.abs(neighbour.start - candidate.start) < need) return false;
    }
    if (candidate.chord) {
      for (const other of accepted)
        if (other.chord && Math.abs(other.start - candidate.start) < CHORD_MIN_SPACING_MS[difficulty])
          return false;
    }
    accepted.splice(at, 0, candidate);
    const ok =
      windowLoad(accepted, at, DENSITY_WINDOW_MS) <= densityCap &&
      windowLoad(accepted, at, APPROACH_MS[difficulty]) <= MAX_VISIBLE_NOTES[difficulty] &&
      handsFit(accepted, at);
    if (!ok) accepted.splice(at, 1);
    return ok;
  };
  const pick = (event: MusicalEvent, beam: boolean, chord: boolean): Pick => {
    const start =
      beam && event.sustained
        ? event.sustained.t
        : chord && event.partner
          ? Math.min(event.primary.t, event.partner.t)
          : event.primary.t;
    return { event, start, beam, chord, type: beam ? 'beam' : 'slash' };
  };
  // Beams first: occasional sustained accents in sparse surroundings, at most one per spacing.
  const crowding = (event: MusicalEvent): number =>
    events.filter((o) => o !== event && Math.abs(o.primary.t - event.primary.t) <= BEAM_ISOLATION_MS).length;
  const beamCandidates = events
    .filter((e) => e.sustained)
    .map((e) => ({ e, crowd: crowding(e) }))
    .sort((a, b) => a.crowd - b.crowd || b.e.salience - a.e.salience || a.e.index - b.e.index);
  const beams: number[] = [];
  for (const { e } of beamCandidates) {
    if (beams.some((t) => Math.abs(t - e.primary.t) < BEAM_MIN_SPACING_MS[difficulty])) continue;
    if (fits(pick(e, true, false))) beams.push(e.primary.t);
  }
  // Then the strongest accents; weaker onsets only fill room the caps leave.
  const ordered = [...events].sort((a, b) => b.salience - a.salience || a.index - b.index);
  const taken = new Set(accepted.map((p) => p.event));
  for (const event of ordered) {
    if (taken.has(event)) continue;
    const chordable =
      event.partner !== null &&
      CHORD_MIN_SPACING_MS[difficulty] !== Infinity &&
      event.salience >= CHORD_MIN_STRENGTH;
    if ((chordable && fits(pick(event, false, true))) || fits(pick(event, false, false))) taken.add(event);
  }
  return accepted;
}

/** Long uninterrupted phrases receive a rest where removing notes costs the least salience. */
function insertRests(picks: Pick[], difficulty: Difficulty): Pick[] {
  const list = [...picks];
  const rest = PHRASE_REST_MS[difficulty],
    phrase = PHRASE_MAX_MS[difficulty];
  // A chord partner may trail its anchor slightly; rests and phrases are measured note to note.
  const end = (p: Pick): number =>
    p.chord && p.event.partner ? Math.max(p.event.primary.t, p.event.partner.t) : p.start;
  let runStart = 0;
  for (let i = 1; i < list.length;) {
    if (list[i]!.start - end(list[i - 1]!) >= rest) {
      runStart = i++;
      continue;
    }
    if (end(list[i]!) - list[runStart]!.start <= phrase) {
      i++;
      continue;
    }
    let best = i - 1,
      bestCost = Infinity;
    for (let j = runStart; j < i; j++) {
      if (list[j]!.start < list[runStart]!.start + phrase / 2) continue;
      let cost = 0;
      for (let k = j + 1; k < list.length && list[k]!.start < end(list[j]!) + rest; k++)
        cost += list[k]!.event.salience * (list[k]!.chord ? 2 : 1);
      if (cost < bestCost) {
        best = j;
        bestCost = cost;
      }
    }
    let remove = 0;
    while (best + 1 + remove < list.length && list[best + 1 + remove]!.start < end(list[best]!) + rest)
      remove++;
    list.splice(best + 1, remove);
    i = best + 1;
    runStart = i;
    if (i < list.length) i++;
  }
  return list;
}

/** Phrase-local gesture mix: the strongest low-band hits smash, the rest of the phrase slashes. */
function assignGestures(picks: Pick[], difficulty: Difficulty): void {
  const lowScore = (p: Pick): number =>
    p.event.low >= SMASH_MIN_LOW_STRENGTH ? p.event.low - 0.5 * p.event.upper : -Infinity;
  const strikes = picks.filter((p) => !p.beam);
  for (const p of strikes) {
    const score = lowScore(p);
    if (score === -Infinity) continue;
    const window = strikes.filter((o) => Math.abs(o.start - p.start) <= GESTURE_MIX_WINDOW_MS / 2);
    const quota = Math.max(1, Math.round(SMASH_MAX_SHARE[difficulty] * window.length));
    const stronger = window.filter((o) => {
      const other = lowScore(o);
      return other > score || (other === score && o.event.index < p.event.index);
    }).length;
    if (stronger < quota) p.type = 'smash';
  }
}

interface Placement {
  notes: Note[];
  walls: Obstacle[];
}
function place(input: AssignmentInput): Placement {
  const { difficulty } = input;
  const walls = wallPlan(input);
  const picks = insertRests(selectPicks(input, musicalEvents(input), walls), difficulty);
  assignGestures(picks, difficulty);
  const lastBySide: Partial<Record<Side, { t: number; type: NoteType }>> = {};
  const accents = { left: 0, right: 0 };
  const free = (side: Side, t: number, type: NoteType): boolean => {
    const prior = lastBySide[side];
    return !prior || t - prior.t >= handGapMs(prior.type, type);
  };
  const notes: Omit<Note, 'id'>[] = [];
  let lastLow = -Infinity;
  const rowFor = (onset: Onset, type: NoteType): Note['row'] => {
    if (type === 'beam') return 2;
    const centroid = input.centroid[Math.min(input.centroid.length - 1, Math.round(onset.t / HOP_MS))] ?? 0;
    // Punches sit at belly/chest height; slashes rise with brighter, higher-band evidence.
    if (type === 'smash') return centroid < CENTROID_ROW_HZ[0] ? 0 : 1;
    return onset.band === 'high' || centroid >= CENTROID_ROW_HZ[1] ? 2 : 1;
  };
  const emit = (onset: Onset, type: NoteType, side: Side): void => {
    accents[side]++;
    const outer =
      type === 'beam' ||
      (type === 'slash' &&
        accents[side] % FLOW_OUTER_ACCENT_EVERY === 0 &&
        onset.strength >= FLOW_OUTER_ACCENT_MIN_STRENGTH);
    const col: Note['col'] = side === 'left' ? (outer ? 0 : 1) : outer ? 3 : 2;
    let row = rowFor(onset, type);
    const previous = notes.at(-1);
    if (
      previous &&
      Math.abs(previous.row - row) === 2 &&
      onset.t - previous.t < FLOW_FULL_ROW_JUMP_MIN_GAP_MS
    )
      row = 1;
    if (difficulty === 'easy' && row === 0 && onset.t - lastLow < EASY_LOW_ROW_MIN_GAP_MS) row = 1;
    if (row === 0) lastLow = onset.t;
    notes.push({ t: onset.t, type, col, row, dir: 'any', strength: onset.strength });
    lastBySide[side] = { t: onset.t, type };
  };
  for (const p of picks) {
    const wall = wallAt(walls, p.start);
    if (p.chord && p.event.partner && !wall) {
      const [first, second] = [p.event.primary, p.event.partner].sort((a, b) => a.t - b.t);
      // The lower band sits on the left so the pair reads consistently.
      const firstSide: Side = BAND_ORDER[first!.band] < BAND_ORDER[second!.band] ? 'left' : 'right';
      if (free(firstSide, first!.t, p.type) && free(opposite(firstSide), second!.t, p.type)) {
        emit(first!, p.type, firstSide);
        emit(second!, p.type, opposite(firstSide));
        continue;
      }
    }
    const onset = p.beam && p.event.sustained ? p.event.sustained : p.event.primary;
    const left = lastBySide.left?.t ?? -Infinity,
      right = lastBySide.right?.t ?? -Infinity;
    // Alternate by giving the contact to the hand that has rested longer.
    const preferred: Side = wall
      ? openSide(wall)
      : left === right
        ? FLOW_RESTART_SIDE
        : left < right
          ? 'left'
          : 'right';
    const options: Side[] = wall ? [preferred] : [preferred, opposite(preferred)];
    const side = options.find((s) => free(s, onset.t, p.type));
    if (side) emit(onset, p.type, side);
  }
  return { notes: notes.map((n, id) => ({ ...n, id })), walls };
}

export function assignNotes(input: AssignmentInput): Note[] {
  return place(input).notes;
}

/** Keeps planned walls whose covered columns stay clear of every note's safety margin. */
export function assignObstacles(input: AssignmentInput, notes: Note[]): Obstacle[] {
  const result: Obstacle[] = [];
  for (const wall of wallPlan(input)) {
    const blocked = notes.some(
      (n) =>
        n.t >= wall.t - WALL_NOTE_MARGIN_MS &&
        n.t <= wall.t + wall.durationMs + WALL_NOTE_MARGIN_MS &&
        (wall.kind === 'wallLeft' ? n.col < 2 : n.col >= 2),
    );
    if (!blocked) result.push({ ...wall, id: result.length });
  }
  return result;
}
