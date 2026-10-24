/**
 * Sign Saber — performer/synthesize.ts
 *
 * Responsibility: turn a PerformerFrame into a mirrored TrackingFrame (upper-body pose + two hands)
 * for logic replay of the synthetic performer, and expose the same joint positions for rendering.
 * Spec: docs/17-testing-and-qa.md §Synthetic performer
 * Inputs: PerformerFrame
 * Outputs: TrackingFrame with owned, reused buffers
 *
 * Synthetic trial input only; it never establishes webcam, recognition or latency behaviour.
 */
import type { HandRaw, PoseRaw, TrackingFrame, Vec2 } from '../core/types';
import { PERFORMER_SHOULDER_WIDTH_NORM, UPPER_BODY_LAST_LANDMARK } from '../core/constants';
import type { PerformerFrame, PerformerHand, PerformerHandState } from './choreography';
import {
  BODY,
  HAND_JOINTS,
  IMAGE_ASPECT,
  IMAGE_PER_METRE,
  handTemplate,
  playToImage,
  shoulderImage,
  templatePalmCentre,
} from './geometry';

const POSE = {
  nose: 0,
  leftEyeInner: 1,
  leftEye: 2,
  leftEyeOuter: 3,
  rightEyeInner: 4,
  rightEye: 5,
  rightEyeOuter: 6,
  leftEar: 7,
  rightEar: 8,
  mouthLeft: 9,
  mouthRight: 10,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftPinky: 17,
  rightPinky: 18,
  leftIndex: 19,
  rightIndex: 20,
  leftThumb: 21,
  rightThumb: 22,
  leftHip: 23,
  rightHip: 24,
} as const;
/** Fraction of the shoulder shift the hips follow during a lean. */
const HIP_LEAN_FOLLOW = 0.3;
const VERTICAL_PER_METRE = IMAGE_PER_METRE / IMAGE_ASPECT;
/** Joint positions in mirrored normalized image coordinates for rendering or landmark synthesis. */
export interface PerformerJoints {
  nose: Vec2;
  leftEye: Vec2;
  rightEye: Vec2;
  leftEar: Vec2;
  rightEar: Vec2;
  mouthLeft: Vec2;
  mouthRight: Vec2;
  leftShoulder: Vec2;
  rightShoulder: Vec2;
  leftElbow: Vec2;
  rightElbow: Vec2;
  leftWrist: Vec2;
  rightWrist: Vec2;
  leftHip: Vec2;
  rightHip: Vec2;
  /** 21 joints per hand in mirrored image coordinates (x, y, relative z). */
  leftHand: Float32Array;
  rightHand: Float32Array;
  /** 21 joints per hand in hand-centred metres (x, y down, z), as MediaPipe world landmarks. */
  leftHandWorld: Float32Array;
  rightHandWorld: Float32Array;
}
const v2 = (): Vec2 => ({ x: 0, y: 0 });
export function createPerformerJoints(): PerformerJoints {
  return {
    nose: v2(),
    leftEye: v2(),
    rightEye: v2(),
    leftEar: v2(),
    rightEar: v2(),
    mouthLeft: v2(),
    mouthRight: v2(),
    leftShoulder: v2(),
    rightShoulder: v2(),
    leftElbow: v2(),
    rightElbow: v2(),
    leftWrist: v2(),
    rightWrist: v2(),
    leftHip: v2(),
    rightHip: v2(),
    leftHand: new Float32Array(HAND_JOINTS * 3),
    rightHand: new Float32Array(HAND_JOINTS * 3),
    leftHandWorld: new Float32Array(HAND_JOINTS * 3),
    rightHandWorld: new Float32Array(HAND_JOINTS * 3),
  };
}
const template = new Float32Array(HAND_JOINTS * 3);
const centre = v2();
const palmImage = v2();
/** Lays a hand template into image space: palm centroid on the target, fingers along `up`. */
function placeHand(
  hand: PerformerHand,
  state: PerformerHandState,
  image: Float32Array,
  world: Float32Array,
  wrist: Vec2,
): void {
  handTemplate(state.shape, hand === 'left' ? 1 : -1, template);
  templatePalmCentre(template, centre);
  playToImage(state.palm, palmImage);
  // Pointing aims the index finger; other shapes keep fingers up, tilted slightly outward.
  let upX = state.shape === 'point' ? state.pointDir.x : hand === 'left' ? -0.25 : 0.25;
  let upY = state.shape === 'point' ? state.pointDir.y : 1;
  const length = Math.hypot(upX, upY) || 1;
  upX /= length;
  upY /= length;
  // Local +y → (upX, upY) on the play plane; local +x → its clockwise perpendicular.
  const rightX = upY,
    rightY = -upX;
  for (let j = 0; j < HAND_JOINTS; j++) {
    const lx = template[j * 3]! - centre.x,
      ly = template[j * 3 + 1]! - centre.y,
      lz = template[j * 3 + 2]!;
    const px = lx * rightX + ly * upX,
      py = lx * rightY + ly * upY;
    image[j * 3] = palmImage.x + px * IMAGE_PER_METRE;
    image[j * 3 + 1] = palmImage.y - py * VERTICAL_PER_METRE;
    image[j * 3 + 2] = lz * IMAGE_PER_METRE;
    world[j * 3] = px;
    world[j * 3 + 1] = -py;
    world[j * 3 + 2] = lz;
  }
  wrist.x = image[0]!;
  wrist.y = image[1]!;
}
/** Two-bone planar IK in isotropic image units; the elbow bends downward and outward. */
function solveElbow(shoulder: Vec2, wrist: Vec2, outward: number, out: Vec2): void {
  const upper = BODY.upperArm * IMAGE_PER_METRE,
    lower = BODY.forearm * IMAGE_PER_METRE;
  const dx = wrist.x - shoulder.x,
    dy = (wrist.y - shoulder.y) * IMAGE_ASPECT;
  const distance = Math.max(1e-6, Math.hypot(dx, dy));
  const reach = Math.min(distance, upper + lower - 1e-6);
  const along = (upper * upper - lower * lower + reach * reach) / (2 * reach);
  const height = Math.sqrt(Math.max(0, upper * upper - along * along));
  const ux = dx / distance,
    uy = dy / distance;
  // Two perpendicular candidates; prefer the one below the shoulder–wrist line and outward.
  let px = -uy,
    py = ux;
  if (py * 1 + px * outward * 0.25 < 0) {
    px = -px;
    py = -py;
  }
  out.x = shoulder.x + ux * along + px * height;
  out.y = shoulder.y + (uy * along + py * height) / IMAGE_ASPECT;
}
export function performerJoints(frame: PerformerFrame, out: PerformerJoints): PerformerJoints {
  const shift = frame.lean * PERFORMER_SHOULDER_WIDTH_NORM;
  shoulderImage('left', frame.lean, out.leftShoulder);
  shoulderImage('right', frame.lean, out.rightShoulder);
  const midX = (out.leftShoulder.x + out.rightShoulder.x) / 2,
    midY = out.leftShoulder.y;
  const hipHalf = (BODY.hipWidth * IMAGE_PER_METRE) / 2;
  const hipY = midY + BODY.torso * VERTICAL_PER_METRE;
  const hipX = 0.5 + shift * HIP_LEAN_FOLLOW;
  out.leftHip.x = hipX - hipHalf;
  out.rightHip.x = hipX + hipHalf;
  out.leftHip.y = out.rightHip.y = hipY;
  out.nose.x = midX;
  out.nose.y = midY - BODY.neckToNose * VERTICAL_PER_METRE;
  const eyeY = out.nose.y - BODY.eyeAboveNose * VERTICAL_PER_METRE;
  const eye = (BODY.eyeSpacing * IMAGE_PER_METRE) / 2,
    ear = (BODY.earSpacing * IMAGE_PER_METRE) / 2;
  out.leftEye.x = midX - eye;
  out.rightEye.x = midX + eye;
  out.leftEye.y = out.rightEye.y = eyeY;
  out.leftEar.x = midX - ear;
  out.rightEar.x = midX + ear;
  out.leftEar.y = out.rightEar.y = eyeY;
  out.mouthLeft.x = midX - eye * 0.7;
  out.mouthRight.x = midX + eye * 0.7;
  out.mouthLeft.y = out.mouthRight.y = out.nose.y + BODY.eyeAboveNose * VERTICAL_PER_METRE;
  placeHand('left', frame.left, out.leftHand, out.leftHandWorld, out.leftWrist);
  placeHand('right', frame.right, out.rightHand, out.rightHandWorld, out.rightWrist);
  solveElbow(out.leftShoulder, out.leftWrist, -1, out.leftElbow);
  solveElbow(out.rightShoulder, out.rightWrist, 1, out.rightElbow);
  return out;
}
/** Owns the reusable TrackingFrame buffers for logic replay of a performance. */
export class PerformerFrameSynthesizer {
  readonly joints = createPerformerJoints();
  private readonly pose: PoseRaw = { landmarks: new Float32Array(132), worldLandmarks: new Float32Array(99) };
  private readonly hands: [HandRaw, HandRaw] = [
    {
      handedness: 'left',
      score: 0.98,
      landmarks: this.joints.leftHand,
      worldLandmarks: this.joints.leftHandWorld,
    },
    {
      handedness: 'right',
      score: 0.98,
      landmarks: this.joints.rightHand,
      worldLandmarks: this.joints.rightHandWorld,
    },
  ];
  readonly frame: TrackingFrame = {
    seq: 0,
    tCapture: 0,
    tInferDone: 0,
    inferenceMs: 0,
    hands: this.hands,
    pose: this.pose,
    mask: null,
  };
  synthesize(performance: PerformerFrame, seq: number, tCapture: number): TrackingFrame {
    const j = performerJoints(performance, this.joints);
    const lm = this.pose.landmarks;
    lm.fill(0);
    const put = (index: number, p: Vec2) => {
      lm[index * 4] = p.x;
      lm[index * 4 + 1] = p.y;
      lm[index * 4 + 2] = 0;
      lm[index * 4 + 3] = 1;
    };
    put(POSE.nose, j.nose);
    put(POSE.leftEyeInner, j.leftEye);
    put(POSE.leftEye, j.leftEye);
    put(POSE.leftEyeOuter, j.leftEye);
    put(POSE.rightEyeInner, j.rightEye);
    put(POSE.rightEye, j.rightEye);
    put(POSE.rightEyeOuter, j.rightEye);
    put(POSE.leftEar, j.leftEar);
    put(POSE.rightEar, j.rightEar);
    put(POSE.mouthLeft, j.mouthLeft);
    put(POSE.mouthRight, j.mouthRight);
    put(POSE.leftShoulder, j.leftShoulder);
    put(POSE.rightShoulder, j.rightShoulder);
    put(POSE.leftElbow, j.leftElbow);
    put(POSE.rightElbow, j.rightElbow);
    put(POSE.leftWrist, j.leftWrist);
    put(POSE.rightWrist, j.rightWrist);
    const hand = (side: Float32Array, joint: number) => ({ x: side[joint * 3]!, y: side[joint * 3 + 1]! });
    put(POSE.leftPinky, hand(j.leftHand, 18));
    put(POSE.rightPinky, hand(j.rightHand, 18));
    put(POSE.leftIndex, hand(j.leftHand, 6));
    put(POSE.rightIndex, hand(j.rightHand, 6));
    put(POSE.leftThumb, hand(j.leftHand, 2));
    put(POSE.rightThumb, hand(j.rightHand, 2));
    put(POSE.leftHip, j.leftHip);
    put(POSE.rightHip, j.rightHip);
    // World landmarks: hip-centred metres in the same mirrored orientation.
    const hipX = (j.leftHip.x + j.rightHip.x) / 2,
      hipY = j.leftHip.y;
    const world = this.pose.worldLandmarks;
    world.fill(0);
    for (let i = 0; i <= UPPER_BODY_LAST_LANDMARK; i++) {
      world[i * 3] = (lm[i * 4]! - hipX) / IMAGE_PER_METRE;
      world[i * 3 + 1] = (lm[i * 4 + 1]! - hipY) / VERTICAL_PER_METRE;
    }
    const frame = this.frame;
    frame.seq = seq;
    frame.tCapture = tCapture;
    frame.tInferDone = tCapture;
    frame.inferenceMs = 0;
    return frame;
  }
}
