/**
 * Sign Saber — performer/choreography.ts
 *
 * Responsibility: plan a human-plausible upper-body performance that satisfies a BeatmapV1 under the
 * game's own contact rules: per-hand palm paths on the play plane, hand shapes and torso lean.
 * Spec: docs/17-testing-and-qa.md §Synthetic performer; contact rules in docs/07
 * Inputs: BeatmapV1
 * Outputs: PerformerFrame samples by song time
 *
 * Synthetic trial input only. A planned performance is never live-camera, recognition or latency evidence.
 */
import type { BeatmapV1, Note, Obstacle } from '../beatmap/types';
import type { Vec2 } from '../core/types';
import {
  BEAM_CHARGE_MS,
  LANE_X,
  LANE_Y,
  OBSTACLE_GRACE_MS,
  PERFORMER_BEAM_CONFIRM_LEAD_MS,
  PERFORMER_LEAN_EASE_MS,
  PERFORMER_LEAN_SHOULDERS,
  PERFORMER_RECOVER_MS,
  PERFORMER_REST,
  PERFORMER_SETTLE_MARGIN_MS,
  PERFORMER_SLASH_CONTACT_MS,
  PERFORMER_SLASH_FOLLOW_M,
  PERFORMER_SLASH_SPEED,
  PERFORMER_SLASH_WINDUP_M,
  PERFORMER_SMASH_CONTACT_MS,
  PERFORMER_SMASH_DRAW_M,
  PERFORMER_SMASH_FOLLOW_M,
  PERFORMER_SMASH_SPEED,
  PERFORMER_TRAVEL_MIN_MS,
  TRACK_TARGET_HZ,
  WINDOW_GOOD_MS,
} from '../core/constants';
import { beamAimTarget } from '../game/hit';
import { tipReachPlay } from './geometry';

export type PerformerHand = 'left' | 'right';
/** `relaxed` is a deliberately unclassifiable resting hand (neither extended nor curled). */
export type HandShape = 'open' | 'fist' | 'point' | 'relaxed';
export interface PerformerHandState {
  /** Palm centre on the play plane (metres; x right in the mirrored view, y up). */
  palm: Vec2;
  shape: HandShape;
  /** Unit direction from palm to index tip on the play plane; meaningful for `point`. */
  pointDir: Vec2;
}
export interface PerformerFrame {
  songTimeMs: number;
  left: PerformerHandState;
  right: PerformerHandState;
  /** Torso shift in shoulder widths; positive = toward the player's right (mirrored screen right). */
  lean: number;
}
type ActionKind = 'slash' | 'smash' | 'beam';
export interface PerformerAction {
  kind: ActionKind;
  hand: PerformerHand;
  noteId: number;
  t: number;
  /** Motion interval; the hand is at `from` at `start` and `to` at `end`. */
  start: number;
  end: number;
  from: Vec2;
  to: Vec2;
  shape: Exclude<HandShape, 'relaxed'>;
  pointDir: Vec2;
}
export interface ChoreographyPlan {
  actions: Record<PerformerHand, PerformerAction[]>;
  /** Notes the two hands could not reach in time; they are reported, never silently counted. */
  unplayable: number[];
  leanSegments: { start: number; end: number; lean: number }[];
}
const HANDS: readonly PerformerHand[] = ['left', 'right'];
const FRAME_MS = 1000 / TRACK_TARGET_HZ;
const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp2 = (a: Vec2, b: Vec2, t: number, out: Vec2): Vec2 => {
  out.x = a.x + (b.x - a.x) * t;
  out.y = a.y + (b.y - a.y) * t;
  return out;
};
function rest(hand: PerformerHand): Vec2 {
  return { x: hand === 'left' ? -PERFORMER_REST.x : PERFORMER_REST.x, y: PERFORMER_REST.y };
}
function preferredHand(note: Note): PerformerHand {
  return note.col <= 1 ? 'left' : 'right';
}
/** Inward-down diagonal swing; the outer lanes swing inward and the bottom row swings flatter. */
function slashAction(note: Note, hand: PerformerHand): PerformerAction {
  const centre = { x: LANE_X[note.col], y: LANE_Y[note.row] };
  const inward = note.col <= 1 ? 1 : -1;
  const dx = note.row === 0 ? inward : inward * 0.55,
    dy = note.row === 0 ? -0.35 : -1;
  const length = Math.hypot(dx, dy);
  const dir = { x: dx / length, y: dy / length };
  // Wind up outside the contact zone, then move at constant speed so the first eligible contact
  // (velocity window filled above SLASH_MIN_SPEED) lands at the note time.
  const start = note.t - PERFORMER_SLASH_CONTACT_MS;
  const duration = ((PERFORMER_SLASH_WINDUP_M + PERFORMER_SLASH_FOLLOW_M) / PERFORMER_SLASH_SPEED) * 1000;
  return {
    kind: 'slash',
    hand,
    noteId: note.id,
    t: note.t,
    start,
    end: start + duration,
    from: { x: centre.x - dir.x * PERFORMER_SLASH_WINDUP_M, y: centre.y - dir.y * PERFORMER_SLASH_WINDUP_M },
    to: { x: centre.x + dir.x * PERFORMER_SLASH_FOLLOW_M, y: centre.y + dir.y * PERFORMER_SLASH_FOLLOW_M },
    shape: 'open',
    pointDir: { x: dir.x, y: dir.y },
  };
}
/** Fist drawn back below/outside the block, then driven through its centre. */
function smashAction(note: Note, hand: PerformerHand): PerformerAction {
  const centre = { x: LANE_X[note.col], y: LANE_Y[note.row] };
  const outward = note.col <= 1 ? -1 : 1;
  const length = Math.hypot(outward * 0.5, 1);
  const back = { x: (outward * 0.5) / length, y: -1 / length };
  const start = note.t - PERFORMER_SMASH_CONTACT_MS;
  const duration = ((PERFORMER_SMASH_DRAW_M + PERFORMER_SMASH_FOLLOW_M) / PERFORMER_SMASH_SPEED) * 1000;
  return {
    kind: 'smash',
    hand,
    noteId: note.id,
    t: note.t,
    start,
    end: start + duration,
    from: { x: centre.x + back.x * PERFORMER_SMASH_DRAW_M, y: centre.y + back.y * PERFORMER_SMASH_DRAW_M },
    to: { x: centre.x - back.x * PERFORMER_SMASH_FOLLOW_M, y: centre.y - back.y * PERFORMER_SMASH_FOLLOW_M },
    shape: 'fist',
    pointDir: { x: -back.x, y: -back.y },
  };
}
/** Steady point whose fingertip rests on the projected beam aim target until the charge completes. */
function beamAction(note: Note, hand: PerformerHand): PerformerAction {
  const aim = beamAimTarget(note);
  const shoulder = rest(hand);
  const dx = aim.x - shoulder.x,
    dy = aim.y - shoulder.y;
  const length = Math.hypot(dx, dy) || 1;
  const dir = { x: dx / length, y: dy / length };
  const reach = tipReachPlay();
  const palm = { x: aim.x - dir.x * reach, y: aim.y - dir.y * reach };
  // Charge accrues only after the point is confirmed; point early enough that it completes at note.t.
  const lead = BEAM_CHARGE_MS + PERFORMER_BEAM_CONFIRM_LEAD_MS;
  return {
    kind: 'beam',
    hand,
    noteId: note.id,
    t: note.t,
    start: note.t - lead,
    end: note.t + FRAME_MS * 2,
    from: palm,
    to: { ...palm },
    shape: 'point',
    pointDir: dir,
  };
}
function busyUntil(actions: PerformerAction[]): number {
  return actions.length ? actions[actions.length - 1]!.end : -Infinity;
}
function makeAction(note: Note, hand: PerformerHand): PerformerAction {
  return note.type === 'slash'
    ? slashAction(note, hand)
    : note.type === 'smash'
      ? smashAction(note, hand)
      : beamAction(note, hand);
}
/**
 * When the hand must be settled at the stroke's start pose with its stroke shape. Slash and smash
 * settle before the judgement window opens so travel can never register an early contact; a beam
 * adopts its point exactly at `start`, which is timed for the charge to complete at the note.
 */
function arriveAt(action: PerformerAction): number {
  return action.kind === 'beam'
    ? action.start - PERFORMER_SETTLE_MARGIN_MS
    : Math.min(action.start, action.t - WINDOW_GOOD_MS - PERFORMER_SETTLE_MARGIN_MS);
}
function shapeAt(action: PerformerAction): number {
  return action.kind === 'beam' ? action.start : arriveAt(action);
}
/** The latest time a hand may leave its previous pose and still travel to this stroke. */
function setupStart(action: PerformerAction): number {
  return arriveAt(action) - PERFORMER_TRAVEL_MIN_MS;
}
export function planPerformance(map: BeatmapV1): ChoreographyPlan {
  const actions: Record<PerformerHand, PerformerAction[]> = { left: [], right: [] };
  const unplayable: number[] = [];
  for (const note of map.notes) {
    const preferred = preferredHand(note);
    const order: PerformerHand[] = preferred === 'left' ? ['left', 'right'] : ['right', 'left'];
    let placed = false;
    for (const hand of order) {
      const action = makeAction(note, hand);
      if (busyUntil(actions[hand]) + PERFORMER_RECOVER_MS <= setupStart(action)) {
        actions[hand].push(action);
        placed = true;
        break;
      }
    }
    if (!placed) unplayable.push(note.id);
  }
  return { actions, unplayable, leanSegments: map.obstacles.map(leanSegment) };
}
function leanSegment(obstacle: Obstacle): { start: number; end: number; lean: number } {
  // wallLeft covers the left lanes: the player must lean right, and vice versa.
  const lean =
    obstacle.kind === 'wallLeft'
      ? PERFORMER_LEAN_SHOULDERS
      : obstacle.kind === 'wallRight'
        ? -PERFORMER_LEAN_SHOULDERS
        : 0;
  return {
    start: obstacle.t + OBSTACLE_GRACE_MS - PERFORMER_LEAN_EASE_MS,
    end: obstacle.t + obstacle.durationMs,
    lean,
  };
}
/** Samples the plan at a song time. Allocation-free when `out` is reused. */
export class Choreography {
  readonly plan: ChoreographyPlan;
  private readonly cursor: Record<PerformerHand, number> = { left: 0, right: 0 };
  private lastTime = -Infinity;
  private readonly scratch = { a: { x: 0, y: 0 } };
  constructor(map: BeatmapV1) {
    this.plan = planPerformance(map);
  }
  static frame(): PerformerFrame {
    const hand = (h: PerformerHand): PerformerHandState => ({
      palm: rest(h),
      shape: 'relaxed',
      pointDir: { x: 0, y: 1 },
    });
    return { songTimeMs: 0, left: hand('left'), right: hand('right'), lean: 0 };
  }
  sample(songTimeMs: number, out: PerformerFrame): PerformerFrame {
    if (songTimeMs < this.lastTime) this.cursor.left = this.cursor.right = 0;
    this.lastTime = songTimeMs;
    out.songTimeMs = songTimeMs;
    for (const hand of HANDS) this.sampleHand(hand, songTimeMs, out[hand]);
    out.lean = this.lean(songTimeMs);
    return out;
  }
  private sampleHand(hand: PerformerHand, t: number, out: PerformerHandState): void {
    const list = this.plan.actions[hand];
    let index = this.cursor[hand];
    while (index < list.length && list[index]!.end < t) index++;
    this.cursor[hand] = index;
    const current = list[index];
    const previous = index > 0 ? list[index - 1]! : null;
    if (current && t >= current.start) {
      // Inside the stroke: constant velocity so the measured speed is steady through contact.
      const alpha = Math.min(1, (t - current.start) / Math.max(1, current.end - current.start));
      lerp2(current.from, current.to, alpha, out.palm);
      out.shape = current.shape;
      out.pointDir.x = current.pointDir.x;
      out.pointDir.y = current.pointDir.y;
      return;
    }
    // Between strokes: recover toward rest, travel relaxed, then settle at the stroke's start pose.
    const fromPos = previous ? previous.to : rest(hand);
    const fromTime = previous ? previous.end : -Infinity;
    const restPos = rest(hand);
    const recovered = (time: number, target: Vec2) =>
      lerp2(
        fromPos,
        restPos,
        Number.isFinite(fromTime)
          ? smooth(Math.min(1, Math.max(0, (time - fromTime) / PERFORMER_RECOVER_MS)))
          : 1,
        target,
      );
    if (!current) {
      recovered(t, out.palm);
      out.shape = 'relaxed';
      return;
    }
    const arrive = arriveAt(current);
    const leaveAt = Math.max(
      Number.isFinite(fromTime) ? fromTime : -Infinity,
      setupStart(current) - PERFORMER_RECOVER_MS,
    );
    if (t <= leaveAt) recovered(t, out.palm);
    else if (t >= arrive) {
      out.palm.x = current.from.x;
      out.palm.y = current.from.y;
    } else {
      const departure = recovered(leaveAt, this.scratch.a);
      lerp2(departure, current.from, smooth((t - leaveAt) / Math.max(1, arrive - leaveAt)), out.palm);
    }
    out.shape = t >= shapeAt(current) ? current.shape : 'relaxed';
    out.pointDir.x = current.pointDir.x;
    out.pointDir.y = current.pointDir.y;
  }
  private lean(t: number): number {
    let lean = 0;
    for (const segment of this.plan.leanSegments) {
      if (t < segment.start - PERFORMER_LEAN_EASE_MS || t > segment.end + PERFORMER_LEAN_EASE_MS) continue;
      const rise = smooth(
        Math.min(1, Math.max(0, (t - (segment.start - PERFORMER_LEAN_EASE_MS)) / PERFORMER_LEAN_EASE_MS)),
      );
      const fall = smooth(
        Math.min(1, Math.max(0, (segment.end + PERFORMER_LEAN_EASE_MS - t) / PERFORMER_LEAN_EASE_MS)),
      );
      const weight = Math.min(rise, fall);
      if (Math.abs(segment.lean * weight) > Math.abs(lean)) lean = segment.lean * weight;
    }
    return lean;
  }
}
