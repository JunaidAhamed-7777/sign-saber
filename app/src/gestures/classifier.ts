/**
 * Sign Saber — gestures/classifier.ts
 *
 * Responsibility: Geometric Open/Fist/Point/None classifier from 21 landmarks with confidence margin.
 * Spec: docs/06-gesture-recognition.md
 * Inputs: HandRaw
 * Outputs: { gesture, confidence }
 *
 * Implementation: bounded live/replay input; hardware acceptance remains separate from synthetic assertions.
 */
import type { Gesture, HandRaw } from '../core/types';
import {
  GESTURE_CURL_RATIO,
  GESTURE_EDGE_ON_WIDTH,
  GESTURE_EXT_RATIO,
  GESTURE_PALM_SIZE_MIN,
} from '../core/constants';

export const enum LM {
  WRIST,
  THUMB_CMC,
  THUMB_MCP,
  THUMB_IP,
  THUMB_TIP,
  INDEX_MCP,
  INDEX_PIP,
  INDEX_DIP,
  INDEX_TIP,
  MIDDLE_MCP,
  MIDDLE_PIP,
  MIDDLE_DIP,
  MIDDLE_TIP,
  RING_MCP,
  RING_PIP,
  RING_DIP,
  RING_TIP,
  PINKY_MCP,
  PINKY_PIP,
  PINKY_DIP,
  PINKY_TIP,
}
const FINGERS = [LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP] as const;
const IMAGE_ASPECT = 9 / 16;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export interface GestureResult {
  gesture: Gesture;
  confidence: number;
  ambiguous: boolean;
}
export class ClassifierScratch {
  angles = new Float32Array(4);
  reaches = new Float32Array(4);
  extended = new Uint8Array(4);
  curled = new Uint8Array(4);
}
function distance(lm: Float32Array, a: number, b: number): number {
  return Math.hypot(lm[a * 3]! - lm[b * 3]!, (lm[a * 3 + 1]! - lm[b * 3 + 1]!) * IMAGE_ASPECT);
}
export function classify(hand: HandRaw, prev: Gesture, out: GestureResult, scratch: ClassifierScratch): void {
  out.gesture = 'none';
  out.confidence = 0;
  out.ambiguous = true;
  const lm = hand.landmarks;
  const world = hand.worldLandmarks;
  if (lm.length !== 63 || world.length !== 63) return;
  for (let i = 0; i < lm.length; i++) if (!Number.isFinite(lm[i]) || !Number.isFinite(world[i])) return;
  const palm = distance(lm, LM.WRIST, LM.MIDDLE_MCP);
  if (palm < GESTURE_PALM_SIZE_MIN) return;
  if (distance(lm, LM.INDEX_MCP, LM.PINKY_MCP) / palm < GESTURE_EDGE_ON_WIDTH) {
    out.gesture = prev;
    return;
  }
  // Orientation-independent finger state: 3D wrist→tip versus wrist→MCP distance in world metres.
  // Image-space reach collapses when the palm faces the camera, so it is not used here.
  let e = 0;
  let c = 0;
  let minExtension = 1;
  let minCurl = 1;
  const wx = world[LM.WRIST * 3]!,
    wy = world[LM.WRIST * 3 + 1]!,
    wz = world[LM.WRIST * 3 + 2]!;
  const fromWrist = (j: number) =>
    Math.hypot(world[j * 3]! - wx, world[j * 3 + 1]! - wy, world[j * 3 + 2]! - wz);
  for (let f = 0; f < FINGERS.length; f++) {
    const mcp = FINGERS[f]!;
    const base = fromWrist(mcp);
    if (base <= 0) return;
    const ratio = fromWrist(mcp + 3) / base;
    const extended = ratio >= GESTURE_EXT_RATIO;
    const curled = ratio <= GESTURE_CURL_RATIO;
    scratch.angles[f] = ratio;
    scratch.reaches[f] = ratio;
    scratch.extended[f] = Number(extended);
    scratch.curled[f] = Number(curled);
    e += Number(extended);
    c += Number(curled);
    const span = GESTURE_EXT_RATIO - GESTURE_CURL_RATIO;
    minExtension = Math.min(minExtension, clamp01((ratio - GESTURE_CURL_RATIO) / span));
    minCurl = Math.min(minCurl, clamp01((GESTURE_EXT_RATIO - ratio) / span));
  }
  const span = GESTURE_EXT_RATIO - GESTURE_CURL_RATIO;
  const indexOut = scratch.extended[0] === 1;
  const othersIn = Number(scratch.curled[1]) + Number(scratch.curled[2]) + Number(scratch.curled[3]);
  if (indexOut && othersIn >= 2 && !scratch.extended[1]) {
    // Point (👆): index straight, the rest folded. Confidence is the weaker of the two margins.
    out.gesture = 'point';
    let folded = 1;
    for (let f = 1; f < 4; f++)
      if (scratch.curled[f])
        folded = Math.min(folded, clamp01((GESTURE_EXT_RATIO - scratch.reaches[f]!) / span));
    out.confidence = Math.min(clamp01((scratch.reaches[0]! - GESTURE_CURL_RATIO) / span), folded);
  } else if (c >= 3 && !indexOut) {
    out.gesture = 'fist';
    out.confidence = minCurl;
  } else if (e >= 3 && c === 0) {
    out.gesture = 'open';
    out.confidence = Math.max(minExtension, e === 4 ? 0.8 : 0.5);
  }
  out.ambiguous = out.gesture === 'none';
}
