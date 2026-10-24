/** Retain head, arms and torso through hips; never downstream lower-limb input. */
import type { MaskFrame } from '../core/types';
import {
  TRACK_CONFIDENCE_MIN,
  UPPER_BODY_LAST_LANDMARK,
  UPPER_BODY_MASK_FADE_NORM,
  MASK_W,
} from '../core/constants';
type Coordinates = { landmarks: ArrayLike<number>; worldLandmarks: ArrayLike<number> };
type WritableCoordinates = { landmarks: Float32Array | number[]; worldLandmarks: Float32Array | number[] };
const POSE_STRIDE = 4;
const WORLD_STRIDE = 3;
const LEFT_HIP = 23;
const RIGHT_HIP = 24;
const HIP_JOINTS = [LEFT_HIP, RIGHT_HIP] as const;
const maskCutoffs = new Float32Array(MASK_W);
export function copyUpperBodyPose(source: Coordinates, target: WritableCoordinates): void {
  const count = UPPER_BODY_LAST_LANDMARK + 1;
  for (let i = 0; i < count * POSE_STRIDE; i++) target.landmarks[i] = source.landmarks[i]!;
  for (let i = 0; i < count * WORLD_STRIDE; i++) target.worldLandmarks[i] = source.worldLandmarks[i]!;
  target.landmarks.fill(0, count * POSE_STRIDE);
  target.worldLandmarks.fill(0, count * WORLD_STRIDE);
}
/** Lower visible hip defines the limit. No leg pixels survive below it. */
export function upperBodyHipLine(landmarks: ArrayLike<number>): number | null {
  if (landmarks.length !== 33 * POSE_STRIDE) return null;
  for (const index of HIP_JOINTS) {
    const x = landmarks[index * POSE_STRIDE];
    const y = landmarks[index * POSE_STRIDE + 1];
    const visibility = landmarks[index * POSE_STRIDE + 3];
    if (
      x === undefined ||
      !Number.isFinite(x) ||
      x < 0 ||
      x > 1 ||
      y === undefined ||
      !Number.isFinite(y) ||
      y <= 0 ||
      y > 1 ||
      visibility === undefined ||
      !Number.isFinite(visibility) ||
      visibility < TRACK_CONFIDENCE_MIN
    )
      return null;
  }
  if (Math.abs(landmarks[LEFT_HIP * POSE_STRIDE]! - landmarks[RIGHT_HIP * POSE_STRIDE]!) <= Number.EPSILON)
    return null;
  return Math.max(landmarks[LEFT_HIP * POSE_STRIDE + 1]!, landmarks[RIGHT_HIP * POSE_STRIDE + 1]!);
}
/** Mutates an owned confidence mask. False means hide, never full-body fallback. */
export function maskUpperBody(mask: MaskFrame, poseLandmarks: ArrayLike<number>): boolean {
  const hip = upperBodyHipLine(poseLandmarks);
  if (
    hip === null ||
    !Number.isInteger(mask.width) ||
    !Number.isInteger(mask.height) ||
    mask.width <= 0 ||
    mask.width > MASK_W ||
    mask.height <= 0 ||
    mask.data.length !== mask.width * mask.height
  ) {
    mask.data.fill(0);
    return false;
  }
  const leftX = poseLandmarks[LEFT_HIP * POSE_STRIDE]!;
  const rightX = poseLandmarks[RIGHT_HIP * POSE_STRIDE]!;
  const leftY = poseLandmarks[LEFT_HIP * POSE_STRIDE + 1]!;
  const rightY = poseLandmarks[RIGHT_HIP * POSE_STRIDE + 1]!;
  for (let x = 0; x < mask.width; x++) {
    const u = (x + 0.5) / mask.width;
    const weight = Math.max(0, Math.min(1, (u - leftX) / (rightX - leftX)));
    maskCutoffs[x] = leftY + (rightY - leftY) * weight;
  }
  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      const distance = maskCutoffs[x]! - (y + 0.5) / mask.height;
      const t = Math.min(1, Math.max(0, distance / UPPER_BODY_MASK_FADE_NORM));
      const alpha = t * t * (3 - 2 * t);
      const index = y * mask.width + x;
      mask.data[index] = Math.round(mask.data[index]! * alpha);
    }
  }
  return true;
}
export function upperBodyFixturePose(source: Coordinates): { landmarks: number[]; worldLandmarks: number[] } {
  const target = {
    landmarks: new Array<number>(33 * POSE_STRIDE).fill(0),
    worldLandmarks: new Array<number>(33 * WORLD_STRIDE).fill(0),
  };
  copyUpperBodyPose(source, target);
  return target;
}
