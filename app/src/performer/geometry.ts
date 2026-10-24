/**
 * Sign Saber — performer/geometry.ts
 *
 * Responsibility: body and hand proportions for the synthetic performer, and the conversion between
 * real metres, mirrored normalized image coordinates and play-plane metres.
 * Spec: docs/17-testing-and-qa.md §Synthetic performer; coordinates in docs/02
 * Inputs: none (registered constants)
 * Outputs: shared dimensions for choreography, frame synthesis and the rendered performer
 */
import type { Vec2 } from '../core/types';
import {
  CALIB_ASSUMED_SHOULDER_M,
  PLAY_CENTER_Y,
  PLAY_H,
  PLAY_W,
  PERFORMER_SHOULDER_V,
  PERFORMER_SHOULDER_WIDTH_NORM,
} from '../core/constants';
import type { HandShape } from './choreography';

/** Image widths per real metre. Vertical image units per metre are this × 16/9. */
export const IMAGE_PER_METRE = PERFORMER_SHOULDER_WIDTH_NORM / CALIB_ASSUMED_SHOULDER_M;
export const IMAGE_ASPECT = 9 / 16;
/** Real proportions (metres) of an adult upper body; the hips are the lowest retained joints. */
export const BODY = {
  shoulderWidth: CALIB_ASSUMED_SHOULDER_M,
  hipWidth: 0.3,
  torso: 0.5,
  upperArm: 0.29,
  forearm: 0.26,
  neckToNose: 0.21,
  eyeAboveNose: 0.035,
  eyeSpacing: 0.065,
  earSpacing: 0.15,
} as const;
export const HAND_JOINTS = 21;
/** Hand-local template frame: x toward the thumb, y along the fingers, z toward the camera is negative. */
const MCP: readonly Vec2[] = [
  { x: 0.032, y: 0.085 },
  { x: 0.01, y: 0.09 },
  { x: -0.012, y: 0.085 },
  { x: -0.032, y: 0.075 },
];
const PHALANGES: readonly (readonly [number, number, number])[] = [
  [0.04, 0.024, 0.02],
  [0.045, 0.028, 0.022],
  [0.042, 0.026, 0.021],
  [0.033, 0.02, 0.019],
];
/** Flexion (degrees) at MCP, PIP and DIP for extended, curled and deliberately ambiguous fingers. */
const FLEX = {
  extended: [5, 5, 3],
  curled: [85, 105, 60],
  relaxed: [35, 45, 25],
} as const;
type ThumbPose = readonly (readonly [number, number, number])[];
const THUMB_OUT: ThumbPose = [
  [0.022, 0.02, -0.005],
  [0.045, 0.04, -0.01],
  [0.068, 0.058, -0.012],
  [0.09, 0.07, -0.012],
];
const THUMB_TUCKED: ThumbPose = [
  [0.022, 0.015, -0.005],
  [0.035, 0.035, -0.015],
  [0.02, 0.055, -0.03],
  [0.0, 0.07, -0.035],
];
const DEG = Math.PI / 180;
/** Writes 21 hand-local joints (metres) for a shape; thumbSide +1 puts the thumb toward +x. */
export function handTemplate(shape: HandShape, thumbSide: 1 | -1, out: Float32Array): Float32Array {
  out.fill(0, 0, 3);
  const thumb = shape === 'open' ? THUMB_OUT : shape === 'relaxed' ? THUMB_OUT : THUMB_TUCKED;
  for (let j = 0; j < 4; j++) {
    out[(1 + j) * 3] = thumb[j]![0] * thumbSide;
    out[(1 + j) * 3 + 1] = thumb[j]![1];
    out[(1 + j) * 3 + 2] = thumb[j]![2];
  }
  for (let f = 0; f < 4; f++) {
    const flex =
      shape === 'open' || (shape === 'point' && f === 0)
        ? FLEX.extended
        : shape === 'relaxed'
          ? FLEX.relaxed
          : FLEX.curled;
    const base = 5 + f * 4;
    const x = MCP[f]!.x * thumbSide;
    let y = MCP[f]!.y,
      z = 0,
      angle = 0;
    out[base * 3] = x;
    out[base * 3 + 1] = y;
    out[base * 3 + 2] = z;
    for (let p = 0; p < 3; p++) {
      angle += flex[p]! * DEG;
      const length = PHALANGES[f]![p]!;
      y += Math.cos(angle) * length;
      z -= Math.sin(angle) * length;
      out[(base + 1 + p) * 3] = x;
      out[(base + 1 + p) * 3 + 1] = y;
      out[(base + 1 + p) * 3 + 2] = z;
    }
  }
  return out;
}
const PALM_JOINTS = [0, 5, 9, 13, 17] as const;
/** Mean of wrist and finger MCPs, matching the cursor's palm centre. */
export function templatePalmCentre(template: Float32Array, out: Vec2): Vec2 {
  out.x = out.y = 0;
  for (const j of PALM_JOINTS) {
    out.x += template[j * 3]!;
    out.y += template[j * 3 + 1]!;
  }
  out.x /= PALM_JOINTS.length;
  out.y /= PALM_JOINTS.length;
  return out;
}
const scratchTemplate = new Float32Array(HAND_JOINTS * 3);
const scratchCentre = { x: 0, y: 0 };
/** Play-plane distance from palm centre to index fingertip for a pointing hand. */
export function tipReachPlay(): number {
  const t = handTemplate('point', 1, scratchTemplate);
  const c = templatePalmCentre(t, scratchCentre);
  return Math.hypot(t[8 * 3]! - c.x, t[8 * 3 + 1]! - c.y) * IMAGE_PER_METRE * PLAY_W;
}
/** Play-plane metres → mirrored normalized image coordinates (inverse of mapToPlayPlane). */
export function playToImage(p: Vec2, out: Vec2): Vec2 {
  out.x = p.x / PLAY_W + 0.5;
  out.y = 0.5 - (p.y - PLAY_CENTER_Y) / PLAY_H;
  return out;
}
/** Rest-pose shoulder positions (mirrored image) for a torso shift in shoulder widths. */
export function shoulderImage(hand: 'left' | 'right', lean: number, out: Vec2): Vec2 {
  const half = PERFORMER_SHOULDER_WIDTH_NORM / 2;
  out.x = 0.5 + lean * PERFORMER_SHOULDER_WIDTH_NORM + (hand === 'left' ? -half : half);
  out.y = PERFORMER_SHOULDER_V;
  return out;
}
