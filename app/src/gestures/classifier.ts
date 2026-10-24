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
  FINGER_CURL_ANGLE_DEG,
  FINGER_EXT_ANGLE_DEG,
  GESTURE_CURL_MARGIN_ORIGIN,
  GESTURE_CURL_MARGIN_SPAN,
  GESTURE_CURL_REACH_MAX,
  GESTURE_EDGE_ON_WIDTH,
  GESTURE_PALM_SIZE_MIN,
  GESTURE_POINT_RELAX_DEG,
  GESTURE_THUMB_IN_INDEX_MAX,
  GESTURE_THUMB_IN_MIDDLE_MAX,
  GESTURE_THUMB_OUT_MIN,
  GESTURE_TIP_REACH_MARGIN,
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
const RAD_TO_DEG = 180 / Math.PI;
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
  let e = 0;
  let c = 0;
  let minExtension = 1;
  let minCurl = 1;
  for (let f = 0; f < FINGERS.length; f++) {
    const mcp = FINGERS[f]!;
    const pip = mcp + 1;
    const tip = mcp + 3;
    let dot = 0;
    let aa = 0;
    let bb = 0;
    for (let axis = 0; axis < 3; axis++) {
      const a = world[mcp * 3 + axis]! - world[pip * 3 + axis]!;
      const b = world[tip * 3 + axis]! - world[pip * 3 + axis]!;
      dot += a * b;
      aa += a * a;
      bb += b * b;
    }
    if (aa === 0 || bb === 0) return;
    const angle = Math.acos(Math.min(1, Math.max(-1, dot / Math.sqrt(aa * bb)))) * RAD_TO_DEG;
    const reach = distance(lm, tip, LM.WRIST) / palm;
    const extended =
      angle >= FINGER_EXT_ANGLE_DEG && reach > distance(lm, pip, LM.WRIST) / palm + GESTURE_TIP_REACH_MARGIN;
    const curled = angle <= FINGER_CURL_ANGLE_DEG || reach < GESTURE_CURL_REACH_MAX;
    scratch.angles[f] = angle;
    scratch.reaches[f] = reach;
    scratch.extended[f] = Number(extended);
    scratch.curled[f] = Number(curled);
    e += Number(extended);
    c += Number(curled);
    minExtension = Math.min(
      minExtension,
      clamp01((angle - FINGER_CURL_ANGLE_DEG) / (FINGER_EXT_ANGLE_DEG - FINGER_CURL_ANGLE_DEG)),
    );
    minCurl = Math.min(minCurl, clamp01(1 - (reach - GESTURE_CURL_MARGIN_ORIGIN) / GESTURE_CURL_MARGIN_SPAN));
  }
  const thumbOut = distance(lm, LM.THUMB_TIP, LM.PINKY_MCP) / palm > GESTURE_THUMB_OUT_MIN;
  const thumbIn =
    distance(lm, LM.THUMB_TIP, LM.INDEX_MCP) / palm < GESTURE_THUMB_IN_INDEX_MAX ||
    distance(lm, LM.THUMB_TIP, LM.MIDDLE_PIP) / palm < GESTURE_THUMB_IN_MIDDLE_MAX;
  const middleAmbiguous = !scratch.extended[1] && !scratch.curled[1];
  if (
    scratch.extended[0] &&
    scratch.curled[2] &&
    scratch.curled[3] &&
    (scratch.curled[1] ||
      (middleAmbiguous && scratch.angles[0]! - scratch.angles[1]! >= GESTURE_POINT_RELAX_DEG))
  ) {
    out.gesture = 'point';
    let confidence = clamp01(
      (scratch.angles[0]! - FINGER_CURL_ANGLE_DEG) / (FINGER_EXT_ANGLE_DEG - FINGER_CURL_ANGLE_DEG),
    );
    for (let f = 1; f < 4; f++)
      confidence = Math.min(
        confidence,
        clamp01(1 - (scratch.reaches[f]! - GESTURE_CURL_MARGIN_ORIGIN) / GESTURE_CURL_MARGIN_SPAN),
      );
    out.confidence = confidence;
  } else if (c === 4 || (c === 3 && e === 0 && thumbIn)) {
    out.gesture = 'fist';
    out.confidence = minCurl;
  } else if (e === 4 || (e === 3 && c === 0 && thumbOut)) {
    out.gesture = 'open';
    out.confidence = minExtension;
  }
  out.ambiguous = out.gesture === 'none';
}
