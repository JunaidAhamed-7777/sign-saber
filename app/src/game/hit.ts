/**
 * Sign Saber — game/hit.ts
 *
 * Responsibility: Contact tests: palm sphere / swept blade segment vs block OBB; obstacle vs BodyState; beam resolution.
 * Spec: docs/07-hit-detection-and-scoring.md §Contact tests
 * Inputs: HandCursor[], BodyState, live objects
 * Outputs: Contacts
 *
 * Implemented for the first playable spine. Replay/unit evidence is separate from live-camera acceptance.
 */
import type { Plane, Vec2, Vec3 } from '../core/types';
import {
  BLOCK_SIZE,
  HAND_HIT_RADIUS,
  CAM_POS,
  BEAM_HOVER_Z,
  BEAM_HOVER_Y_OFFSET,
  LANE_X,
  LANE_Y,
  BEAM_AIM_RADIUS,
  GEOMETRY_EPSILON,
} from '../core/constants';
import type { Note, Obstacle } from '../beatmap/types';
import type { BodyState } from '../core/types';
import { clamp, cross3, normalize3 } from '../utils/math';
import { LANE_DIRECTION } from './liveObjects';

export interface Box2 {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Liang–Barsky slab clip. Returns the earliest segment fraction, or null. */
export function segmentAABB(a: Vec2, b: Vec2, box: Box2): number | null {
  return segmentAABBBounds(a, b, box.minX, box.maxX, box.minY, box.maxY);
}
function segmentAABBBounds(
  a: Vec2,
  b: Vec2,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): number | null {
  let enter = 0,
    exit = 1;
  const dx = b.x - a.x,
    dy = b.y - a.y;
  for (let axis = 0; axis < 2; axis++) {
    const origin = axis === 0 ? a.x : a.y;
    const direction = axis === 0 ? dx : dy;
    const min = axis === 0 ? minX : minY;
    const max = axis === 0 ? maxX : maxY;
    if (Math.abs(direction) <= GEOMETRY_EPSILON) {
      if (origin < min || origin > max) return null;
    } else {
      let near = (min - origin) / direction,
        far = (max - origin) / direction;
      if (near > far) [near, far] = [far, near];
      enter = Math.max(enter, near);
      exit = Math.min(exit, far);
      if (enter > exit) return null;
    }
  }
  return enter >= 0 && enter <= 1 ? enter : null;
}
export function pointBoxDistanceSq(point: Vec2, box: Box2): number {
  return (
    (point.x - clamp(point.x, box.minX, box.maxX)) ** 2 + (point.y - clamp(point.y, box.minY, box.maxY)) ** 2
  );
}
export function palmContact(point: Vec2, target: Vec2, radius = HAND_HIT_RADIUS): boolean {
  const half = BLOCK_SIZE / 2;
  const dx = Math.max(0, Math.abs(point.x - target.x) - half);
  const dy = Math.max(0, Math.abs(point.y - target.y) - half);
  return dx * dx + dy * dy <= radius * radius;
}
/** Exact segment versus rounded rectangle (Minkowski sum of the footprint and palm circle).
 * Testing an expanded square alone would produce false positives around its corners. */
export function sweptPalmContact(a: Vec2, b: Vec2, target: Vec2, radius = HAND_HIT_RADIUS): number | null {
  const half = BLOCK_SIZE / 2;
  const minX = target.x - half,
    maxX = target.x + half,
    minY = target.y - half,
    maxY = target.y + half;
  if (palmContact(a, target, radius)) return 0;
  let earliest = Infinity;
  const horizontal = segmentAABBBounds(a, b, minX - radius, maxX + radius, minY, maxY);
  const vertical = segmentAABBBounds(a, b, minX, maxX, minY - radius, maxY + radius);
  if (horizontal !== null) earliest = horizontal;
  if (vertical !== null) earliest = Math.min(earliest, vertical);
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq > GEOMETRY_EPSILON) {
    for (let index = 0; index < 4; index++) {
      const cx = index < 2 ? minX : maxX,
        cy = index % 2 === 0 ? minY : maxY;
      const ox = a.x - cx,
        oy = a.y - cy;
      const projection = ox * dx + oy * dy;
      const discriminant = projection * projection - lengthSq * (ox * ox + oy * oy - radius * radius);
      if (discriminant >= 0) {
        const t = (-projection - Math.sqrt(discriminant)) / lengthSq;
        if (t >= 0 && t <= 1) earliest = Math.min(earliest, t);
      }
    }
  }
  return Number.isFinite(earliest) ? earliest : null;
}

function cornerAt(
  t: number,
  x: number,
  y: number,
  a0: Vec2,
  ax: number,
  ay: number,
  ux: number,
  uy: number,
  vx: number,
  vy: number,
): boolean {
  if (!Number.isFinite(t) || t < 0 || t > 1) return false;
  const baseX = a0.x + ax * t,
    baseY = a0.y + ay * t;
  return (
    (x - baseX) * (x - baseX - ux - vx * t) + (y - baseY) * (y - baseY - uy - vy * t) <= GEOMETRY_EPSILON
  );
}
/** Exact first contact for a blade whose base and tip interpolate linearly between captures.
 * Contact begins when an endpoint enters the square or the segment crosses a square corner.
 * The corner condition is a quadratic in capture fraction, including footprint containment. */
export function sweptBladeContact(a0: Vec2, b0: Vec2, a1: Vec2, b1: Vec2, target: Vec2): number | null {
  const half = BLOCK_SIZE / 2;
  const minX = target.x - half,
    maxX = target.x + half,
    minY = target.y - half,
    maxY = target.y + half;
  if (segmentAABBBounds(a0, b0, minX, maxX, minY, maxY) !== null) return 0;
  let earliest = Infinity;
  const baseCrossing = segmentAABBBounds(a0, a1, minX, maxX, minY, maxY),
    tipCrossing = segmentAABBBounds(b0, b1, minX, maxX, minY, maxY);
  if (baseCrossing !== null) earliest = baseCrossing;
  if (tipCrossing !== null) earliest = Math.min(earliest, tipCrossing);
  const ax = a1.x - a0.x,
    ay = a1.y - a0.y;
  const ux = b0.x - a0.x,
    uy = b0.y - a0.y;
  const vx = b1.x - a1.x - ux,
    vy = b1.y - a1.y - uy;
  for (let index = 0; index < 4; index++) {
    const x = index < 2 ? minX : maxX,
      y = index % 2 === 0 ? minY : maxY;
    const wx = x - a0.x,
      wy = y - a0.y;
    const quadratic = ax * vy - ay * vx;
    const linear = vx * wy - vy * wx - ux * ay + uy * ax;
    const constant = ux * wy - uy * wx;
    const discriminant = linear * linear - 4 * quadratic * constant;
    if (Math.abs(quadratic) <= GEOMETRY_EPSILON) {
      if (Math.abs(linear) > GEOMETRY_EPSILON) {
        const t = -constant / linear;
        if (t < earliest && cornerAt(t, x, y, a0, ax, ay, ux, uy, vx, vy)) earliest = t;
      }
    } else if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      const first = (-linear - root) / (2 * quadratic),
        second = (-linear + root) / (2 * quadratic);
      if (first < earliest && cornerAt(first, x, y, a0, ax, ay, ux, uy, vx, vy)) earliest = first;
      if (second < earliest && cornerAt(second, x, y, a0, ax, ay, ux, uy, vx, vy)) earliest = second;
    }
  }
  return Number.isFinite(earliest) ? earliest : null;
}
export function makeCutPlane(velocity: Vec3, impactPos: Vec3): Plane {
  const normal = cross3(velocity, LANE_DIRECTION);
  if (Math.hypot(normal.x, normal.y, normal.z) < GEOMETRY_EPSILON) {
    normal.x = 0;
    normal.y = 1;
    normal.z = 0;
  }
  normalize3(normal, normal);
  return { normal, point: { ...impactPos } };
}
export function beamAimTarget(note: Note, out: Vec3 = { x: 0, y: 0, z: 0 }): Vec3 {
  const scale = (0 - CAM_POS.z) / (BEAM_HOVER_Z - CAM_POS.z);
  out.x = CAM_POS.x + (LANE_X[note.col] - CAM_POS.x) * scale;
  out.y = CAM_POS.y + (LANE_Y[note.row] + BEAM_HOVER_Y_OFFSET - CAM_POS.y) * scale;
  out.z = 0;
  return out;
}
export function beamAimed(tip: Vec2, projectedTarget: Vec2): boolean {
  return Math.hypot(tip.x - projectedTarget.x, tip.y - projectedTarget.y) <= BEAM_AIM_RADIUS;
}
export function obstacleSafe(obstacle: Obstacle, body: BodyState): boolean {
  return obstacle.kind === 'wallLeft'
    ? body.lean === 'right'
    : obstacle.kind === 'wallRight'
      ? body.lean === 'left'
      : body.duck;
}
