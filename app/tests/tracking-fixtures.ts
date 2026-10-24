/** Synthetic geometry only; never live-camera evidence. */
import type { Gesture, HandRaw, PoseRaw, TrackingFrame } from '../src/core/types';
export function syntheticHand(
  gesture: Gesture = 'open',
  handedness: 'left' | 'right' = 'right',
  offsetX = 0,
): HandRaw {
  const lm = new Float32Array(63);
  const world = new Float32Array(63);
  const put = (i: number, x: number, y: number, wy: number) => {
    lm[i * 3] = x + offsetX;
    lm[i * 3 + 1] = y;
    world[i * 3] = (x - 0.5) * 0.2;
    world[i * 3 + 1] = wy;
  };
  put(0, 0.5, 0.7, 0);
  for (let f = 0; f < 4; f++) {
    const i = 5 + f * 4;
    const x = 0.44 + f * 0.04;
    const extended = gesture === 'open' || (gesture === 'point' && f === 0);
    put(i, x, 0.55, 0.03);
    put(i + 1, x, 0.43, 0.05);
    put(i + 2, x, extended ? 0.36 : 0.57, extended ? 0.07 : 0.04);
    put(i + 3, x, extended ? 0.3 : 0.64, extended ? 0.09 : 0.02);
  }
  for (let i = 1; i <= 4; i++) put(i, gesture === 'open' ? 0.3 : 0.45, 0.55, 0.03);
  return { handedness, score: 0.99, landmarks: lm, worldLandmarks: world };
}
export function syntheticPose(offset = 0): PoseRaw {
  const lm = new Float32Array(132);
  for (let i = 0; i < 33; i++) {
    lm[i * 4] = 0.5 + offset;
    lm[i * 4 + 1] = 0.4;
    lm[i * 4 + 3] = 1;
  }
  lm[1] = 0.2;
  lm[44] = 0.4 + offset;
  lm[48] = 0.6 + offset;
  lm[23 * 4] = 0.42 + offset;
  lm[24 * 4] = 0.58 + offset;
  lm[23 * 4 + 1] = lm[24 * 4 + 1] = 0.75;
  return { landmarks: lm, worldLandmarks: new Float32Array(99) };
}
export function syntheticFrame(
  seq: number,
  tCapture: number,
  hands = [syntheticHand('open', 'left', -0.15), syntheticHand('open', 'right', 0.15)],
  pose: PoseRaw | null = syntheticPose(),
): TrackingFrame {
  return { seq, tCapture, tInferDone: tCapture + 20, inferenceMs: 20, hands, pose, mask: null };
}
