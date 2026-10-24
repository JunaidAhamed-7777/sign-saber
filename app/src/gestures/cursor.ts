/**
 * Sign Saber — gestures/cursor.ts
 *
 * Responsibility: Builds HandCursor: play-plane mapping, velocity (VEL_WINDOW_FRAMES), gesture hysteresis, history for trails.
 * Spec: docs/06-gesture-recognition.md; docs/02-architecture.md §HandCursor
 * Inputs: Filtered HandRaw
 * Outputs: HandCursor
 *
 * Implementation: bounded live/replay input; hardware acceptance remains separate from synthetic assertions.
 */
import type { Gesture, HandCursor, HandRaw, Vec3 } from '../core/types';
import {
  BEAM_CHARGE_MS,
  BEAM_CHARGE_DECAY,
  BEAM_REFIRE_LOCK_MS,
  EXTRAPOLATE_MAX_MS,
  GESTURE_CONFIRM_FRAMES,
  GESTURE_CONFIDENCE_MIN,
  GESTURE_DROP_FRAMES,
  GESTURE_FAST_OPEN_CONFIDENCE,
  INPUT_MAX_AGE_MS,
  PLAY_W,
  PLAY_H,
  PLAY_CENTER_Y,
  POINT_DIR_MIN_M,
  TRAIL_HISTORY,
  VEL_WINDOW_FRAMES,
} from '../core/constants';
import { ClassifierScratch, classify, LM, type GestureResult } from './classifier';
import { updateBlade } from './blade';
const PALM_JOINTS = [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP] as const;
export function mapToPlayPlane(u: number, v: number, out: Vec3): void {
  out.x = (u - 0.5) * PLAY_W;
  out.y = PLAY_CENTER_Y + (0.5 - v) * PLAY_H;
  out.z = 0;
}
export class CursorProcessor {
  readonly cursor: HandCursor;
  readonly palm = { x: 0, y: 0 };
  readonly evidence: GestureResult = { gesture: 'none', confidence: 0, ambiguous: true };
  private scratch = new ClassifierScratch();
  private candidate: Gesture = 'none';
  private candidateFrames = 0;
  private ambiguousFrames = 0;
  private stableSince = 0;
  private times = new Float64Array(VEL_WINDOW_FRAMES + 1);
  private positions = new Float64Array((VEL_WINDOW_FRAMES + 1) * 2);
  private count = 0;
  private index = 0;
  private historyStorage = Array.from({ length: TRAIL_HISTORY }, () => ({ x: 0, y: 0, z: 0 }));
  private lastCapture = Number.NaN;
  private fireLockUntil = -Infinity;
  constructor(hand: 'left' | 'right') {
    this.cursor = {
      hand,
      present: false,
      tCapture: 0,
      gesture: 'none',
      gestureConfidence: 0,
      gestureHeldMs: 0,
      pos: { x: 0, y: 0, z: 0 },
      vel: { x: 0, y: 0, z: 0 },
      speed: 0,
      tip: { x: 0, y: 0, z: 0 },
      pointDir: { x: 0, y: 1 },
      bladeActive: false,
      bladeLength: 0,
      charge: 0,
      history: [],
    };
  }
  reset(): void {
    this.count = this.index = this.candidateFrames = this.ambiguousFrames = 0;
    this.lastCapture = Number.NaN;
    this.candidate = 'none';
    this.fireLockUntil = -Infinity;
    const c = this.cursor;
    c.present = false;
    c.gesture = 'none';
    c.gestureConfidence = c.gestureHeldMs = c.speed = c.bladeLength = c.charge = 0;
    c.bladeActive = false;
    c.vel.x = c.vel.y = c.vel.z = 0;
    c.history.length = 0;
  }
  beamFired(tCapture: number): void {
    this.cursor.charge = 0;
    this.fireLockUntil = tCapture + BEAM_REFIRE_LOCK_MS;
  }
  update(hand: HandRaw | null, tCapture: number): HandCursor {
    const c = this.cursor;
    if (!hand) {
      this.reset();
      c.tCapture = tCapture;
      return c;
    }
    if (!Number.isFinite(tCapture) || (Number.isFinite(this.lastCapture) && tCapture <= this.lastCapture))
      return c;
    if (Number.isFinite(this.lastCapture) && tCapture - this.lastCapture > INPUT_MAX_AGE_MS) this.reset();
    const dt = Number.isFinite(this.lastCapture) ? tCapture - this.lastCapture : 0;
    this.lastCapture = tCapture;
    c.present = true;
    c.tCapture = tCapture;
    classify(hand, c.gesture, this.evidence, this.scratch);
    const r = this.evidence;
    if (r.ambiguous || r.confidence < GESTURE_CONFIDENCE_MIN) {
      this.candidateFrames = 0;
      this.ambiguousFrames++;
      if (this.ambiguousFrames >= GESTURE_DROP_FRAMES && c.gesture !== 'none') {
        c.gesture = 'none';
        this.stableSince = tCapture;
      }
    } else if (r.gesture === c.gesture) {
      this.candidateFrames = this.ambiguousFrames = 0;
      this.candidate = 'none';
    } else {
      this.ambiguousFrames = 0;
      this.candidateFrames = this.candidate === r.gesture ? this.candidateFrames + 1 : 1;
      this.candidate = r.gesture;
      if (
        this.candidateFrames >= GESTURE_CONFIRM_FRAMES ||
        (c.gesture === 'none' && r.gesture === 'open' && r.confidence >= GESTURE_FAST_OPEN_CONFIDENCE)
      ) {
        c.gesture = r.gesture;
        this.stableSince = tCapture;
        this.candidateFrames = 0;
      }
    }
    c.gestureConfidence = r.confidence;
    c.gestureHeldMs = tCapture - this.stableSince;
    let u = 0;
    let v = 0;
    for (const lm of PALM_JOINTS) {
      u += hand.landmarks[lm * 3]!;
      v += hand.landmarks[lm * 3 + 1]!;
    }
    this.palm.x = u / PALM_JOINTS.length;
    this.palm.y = v / PALM_JOINTS.length;
    mapToPlayPlane(this.palm.x, this.palm.y, c.pos);
    mapToPlayPlane(hand.landmarks[LM.INDEX_TIP * 3]!, hand.landmarks[LM.INDEX_TIP * 3 + 1]!, c.tip);
    const dx = (hand.landmarks[LM.INDEX_TIP * 3]! - hand.landmarks[LM.INDEX_MCP * 3]!) * PLAY_W;
    const dy = (hand.landmarks[LM.INDEX_MCP * 3 + 1]! - hand.landmarks[LM.INDEX_TIP * 3 + 1]!) * PLAY_H;
    const length = Math.hypot(dx, dy);
    if (length >= POINT_DIR_MIN_M) {
      c.pointDir.x = dx / length;
      c.pointDir.y = dy / length;
    }
    this.positions[this.index * 2] = c.pos.x;
    this.positions[this.index * 2 + 1] = c.pos.y;
    this.times[this.index] = tCapture;
    this.count = Math.min(this.count + 1, VEL_WINDOW_FRAMES + 1);
    const oldest = (this.index - this.count + 1 + VEL_WINDOW_FRAMES + 1) % (VEL_WINDOW_FRAMES + 1);
    const spanSec = (tCapture - this.times[oldest]!) / 1000;
    c.vel.x = spanSec > 0 ? (c.pos.x - this.positions[oldest * 2]!) / spanSec : 0;
    c.vel.y = spanSec > 0 ? (c.pos.y - this.positions[oldest * 2 + 1]!) / spanSec : 0;
    c.vel.z = 0;
    c.speed = Math.hypot(c.vel.x, c.vel.y);
    this.index = (this.index + 1) % (VEL_WINDOW_FRAMES + 1);
    if (c.history.length < TRAIL_HISTORY) c.history.push(this.historyStorage[c.history.length]!);
    for (let i = 1; i < c.history.length; i++) Object.assign(c.history[i - 1]!, c.history[i]!);
    Object.assign(c.history[c.history.length - 1]!, c.pos);
    updateBlade(c);
    const confidentPoint =
      c.gesture === 'point' &&
      r.gesture === 'point' &&
      r.confidence >= GESTURE_CONFIDENCE_MIN &&
      !r.ambiguous;
    if (tCapture >= this.fireLockUntil)
      c.charge = Math.max(
        0,
        Math.min(1, c.charge + (confidentPoint ? dt : -BEAM_CHARGE_DECAY * dt) / BEAM_CHARGE_MS),
      );
    return c;
  }
}
/** Copies a visual prediction; never mutates scored sample/history. */
export function predictCursor(cursor: HandCursor, now: number, out: Vec3): void {
  const dt = Math.max(0, Math.min(EXTRAPOLATE_MAX_MS, now - cursor.tCapture)) / 1000;
  out.x = cursor.pos.x + cursor.vel.x * dt;
  out.y = cursor.pos.y + cursor.vel.y * dt;
  out.z = cursor.pos.z;
}
