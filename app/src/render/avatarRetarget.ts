/**
 * Sign Saber — render/avatarRetarget.ts
 *
 * Responsibility: pure retargeting of tracked upper-body landmarks onto the authored avatar rig.
 * Spec: docs/10-rendering-silhouette.md §Avatar
 * Inputs: rest rig data, PoseRaw/HandRaw (live, 2D-only dataset or synthetic) or explicit joint targets
 * Outputs: smoothed bone-local quaternions, arm stretch and the model-space root offset
 *
 * Presentation only: nothing here feeds hit detection, scoring or tracking evidence. No leg data is read.
 * Model space is the avatar's glTF space: X avatar-left, Y up, Z toward the viewer, metres, hips at origin.
 * Mirror mode (the game) maps the player's left landmarks to the avatar's right side so it reads as a reflection.
 */
/* eslint-disable no-restricted-syntax -- rig setup, test helpers and module scratch allocate once; per-frame
   solving reuses the pooled scratch in AvatarSolver (`a`, `q`) and the module-level q1/q2/q3/m1/f* instances. */
import { Matrix4, Quaternion, Vector3 } from 'three';
import type { HandRaw, PoseRaw } from '../core/types';
import {
  AVATAR_DEPTH_GAIN,
  AVATAR_DEPTH_MAX_M,
  AVATAR_HOLD_MS,
  AVATAR_IDLE,
  AVATAR_LIMITS_DEG,
  AVATAR_MISSING_SMOOTH_MS,
  AVATAR_RELAXED_CURL,
  AVATAR_SMOOTH_MS,
  AVATAR_STRETCH_MAX,
  CAM_POS,
  PLAY_CENTER_Y,
  PLAY_H,
  PLAY_W,
  TRACK_CONFIDENCE_MIN,
} from '../core/constants';

export type Side = 'L' | 'R';
export const SIDES: readonly Side[] = ['L', 'R'];
export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;
export type Finger = (typeof FINGERS)[number];
/** Authored bone names (Blender `.L/.R` convention). three.js strips the dot when loading. */
export const AVATAR_BONE_NAMES: readonly string[] = [
  'hips',
  'spine',
  'chest',
  'neck',
  'head',
  ...SIDES.flatMap((s) => [
    `shoulder.${s}`,
    `upper_arm.${s}`,
    `forearm.${s}`,
    `hand.${s}`,
    ...FINGERS.flatMap((f) => [1, 2, 3].map((i) => `${f}_0${i}.${s}`)),
  ]),
];
/** Tracked joint targets in avatar sides. */
export const J = {
  HIP_L: 0,
  HIP_R: 1,
  SHOULDER_L: 2,
  SHOULDER_R: 3,
  ELBOW_L: 4,
  ELBOW_R: 5,
  WRIST_L: 6,
  WRIST_R: 7,
  NOSE: 8,
  EAR_L: 9,
  EAR_R: 10,
  EYE_L: 11,
  EYE_R: 12,
  INDEX_L: 13,
  INDEX_R: 14,
  PINKY_L: 15,
  PINKY_R: 16,
  THUMB_L: 17,
  THUMB_R: 18,
} as const;
export const JOINT_COUNT = 19;
/** Anchor names stored in the GLB armature extras, in J order. */
export const ANCHOR_NAMES = [
  'hip.L',
  'hip.R',
  'shoulder.L',
  'shoulder.R',
  'elbow.L',
  'elbow.R',
  'wrist.L',
  'wrist.R',
  'nose',
  'ear.L',
  'ear.R',
  'eye.L',
  'eye.R',
  'index.L',
  'index.R',
  'pinky.L',
  'pinky.R',
  'thumb.L',
  'thumb.R',
] as const;
/** MediaPipe pose indices for each J entry: [anatomical-left index, anatomical-right index] or single. */
const POSE_SOURCE: readonly (readonly [number, number] | number)[] = [
  [23, 24],
  [23, 24],
  [11, 12],
  [11, 12],
  [13, 14],
  [13, 14],
  [15, 16],
  [15, 16],
  0,
  [7, 8],
  [7, 8],
  [2, 5],
  [2, 5],
  [19, 20],
  [19, 20],
  [17, 18],
  [17, 18],
  [21, 22],
  [21, 22],
];
/** MediaPipe hand chains (21-point topology) for each finger, base → tip. */
const HAND_CHAINS: Record<Finger, readonly [number, number, number, number]> = {
  thumb: [1, 2, 3, 4],
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20],
};

export interface RigBoneRest {
  readonly name: string;
  readonly parent: number;
  readonly localPos: Vector3;
  readonly localQuat: Quaternion;
  readonly worldPos: Vector3;
  readonly worldQuat: Quaternion;
}
export interface AvatarRig {
  readonly bones: readonly RigBoneRest[];
  readonly index: Readonly<Record<string, number>>;
  /** Rest landmark anchors in model space, J order. */
  readonly anchors: readonly Vector3[];
}
/** Raw rest data, e.g. from a loaded skeleton. Positions/quaternions are bone-local. */
export interface RigBoneInput {
  name: string;
  parent: string | null;
  position: readonly [number, number, number];
  quaternion: readonly [number, number, number, number];
}

export function createRig(
  bones: readonly RigBoneInput[],
  anchors: Readonly<Record<string, readonly number[]>>,
): AvatarRig {
  const index: Record<string, number> = {};
  bones.forEach((bone, i) => (index[bone.name] = i));
  for (const name of AVATAR_BONE_NAMES)
    if (index[name] === undefined) throw new Error(`Avatar rig is missing bone ${name}.`);
  const rest: RigBoneRest[] = [];
  for (const bone of bones) {
    const parent = bone.parent === null ? -1 : (index[bone.parent] ?? -1);
    if (parent >= rest.length) throw new Error('Avatar bones must be ordered parent-first.');
    const localPos = new Vector3(...bone.position);
    const localQuat = new Quaternion(...bone.quaternion).normalize();
    const worldQuat = parent < 0 ? localQuat.clone() : rest[parent]!.worldQuat.clone().multiply(localQuat);
    const worldPos =
      parent < 0
        ? localPos.clone()
        : localPos.clone().applyQuaternion(rest[parent]!.worldQuat).add(rest[parent]!.worldPos);
    rest.push({ name: bone.name, parent, localPos, localQuat, worldPos, worldQuat });
  }
  const points = ANCHOR_NAMES.map((name) => {
    const value = anchors[name];
    if (!value || value.length !== 3 || !value.every(Number.isFinite))
      throw new Error(`Avatar rig is missing landmark anchor ${name}.`);
    return new Vector3(value[0], value[1], value[2]);
  });
  return { bones: rest, index, anchors: points };
}

/** Joint targets in avatar sides, metres (model scale), any translation. */
export interface AvatarTargets {
  readonly joints: Float32Array; // JOINT_COUNT × 3
  readonly valid: Uint8Array; // JOINT_COUNT
  /** 21 × 3 hand landmark positions (metres, game orientation) per avatar side, or null. */
  readonly hands: [Float32Array | null, Float32Array | null];
  /** Finger curl used when a hand has no landmarks (0 straight … 1 fist). */
  readonly curl: [number, number];
}
export function createTargets(): AvatarTargets {
  return {
    joints: new Float32Array(JOINT_COUNT * 3),
    valid: new Uint8Array(JOINT_COUNT),
    hands: [null, null],
    curl: [AVATAR_RELAXED_CURL, AVATAR_RELAXED_CURL],
  };
}

// ---------------------------------------------------------------------------------------------
// Input adapters: tracked landmarks → play-space targets (game world metres).
const sideIndex = (side: Side) => (side === 'L' ? 0 : 1);
/** Which MediaPipe anatomical side drives an avatar side. Mirror: player left → avatar right. */
function anatomical(side: Side, mirror: boolean): 0 | 1 {
  return (side === 'L') === mirror ? 1 : 0;
}
export interface TrackingAdapterOptions {
  /** true for the game's reflection; false when a subject faces the viewer unmirrored. */
  readonly mirror: boolean;
}
const ownHands: [Float32Array, Float32Array] = [new Float32Array(63), new Float32Array(63)];
const handWrist = [new Vector3(), new Vector3()];
const scratchA = new Vector3();
/**
 * Map MediaPipe upper-body pose + hands to play-space targets. Image x/y land on the play plane exactly as cursors
 * do; depth comes from world landmarks when present, otherwise from limb-length foreshortening (2D-only sources).
 * Each joint is then placed on the camera ray through its play-plane point so the screen projection is unchanged.
 */
export function targetsFromTracking(
  pose: PoseRaw,
  hands: readonly HandRaw[],
  out: AvatarTargets,
  rig: AvatarRig,
  options: TrackingAdapterOptions = { mirror: true },
): boolean {
  const lm = pose.landmarks,
    world = pose.worldLandmarks;
  if (lm.length < 25 * 4) return false;
  const visible = (i: number) => {
    const v = lm[i * 4 + 3]!;
    return (
      Number.isFinite(v) &&
      v >= TRACK_CONFIDENCE_MIN &&
      Number.isFinite(lm[i * 4]!) &&
      Number.isFinite(lm[i * 4 + 1]!)
    );
  };
  const source = (j: number): number => {
    const entry = POSE_SOURCE[j]!;
    if (typeof entry === 'number') return entry;
    const side: Side = j % 2 === 0 ? 'L' : 'R';
    return entry[anatomical(side, options.mirror)];
  };
  // Play-plane x/y.
  for (let j = 0; j < JOINT_COUNT; j++) {
    const i = source(j);
    out.valid[j] = visible(i) ? 1 : 0;
    out.joints[j * 3] = (lm[i * 4]! - 0.5) * PLAY_W;
    out.joints[j * 3 + 1] = PLAY_CENTER_Y + (0.5 - lm[i * 4 + 1]!) * PLAY_H;
    out.joints[j * 3 + 2] = 0;
  }
  if (!out.valid[J.SHOULDER_L] || !out.valid[J.SHOULDER_R]) return false;
  const shoulderPlay = Math.hypot(
    out.joints[J.SHOULDER_L * 3]! - out.joints[J.SHOULDER_R * 3]!,
    out.joints[J.SHOULDER_L * 3 + 1]! - out.joints[J.SHOULDER_R * 3 + 1]!,
  );
  if (!(shoulderPlay > 1e-4)) return false;
  // Depth: measured world z when present.
  const wsL = source(J.SHOULDER_L),
    wsR = source(J.SHOULDER_R);
  let measured = false;
  for (const j of [J.SHOULDER_L, J.SHOULDER_R, J.ELBOW_L, J.ELBOW_R, J.WRIST_L, J.WRIST_R, J.NOSE])
    if (Math.abs(world[source(j) * 3 + 2] ?? 0) > 1e-4) measured = true;
  const worldShoulder = Math.hypot(
    (world[wsL * 3] ?? 0) - (world[wsR * 3] ?? 0),
    (world[wsL * 3 + 1] ?? 0) - (world[wsR * 3 + 1] ?? 0),
  );
  if (measured && worldShoulder > 1e-3) {
    const s = shoulderPlay / worldShoulder,
      zHip = ((world[23 * 3 + 2] ?? 0) + (world[24 * 3 + 2] ?? 0)) / 2;
    for (let j = 0; j < JOINT_COUNT; j++) {
      const z = -((world[source(j) * 3 + 2] ?? 0) - zHip) * s * AVATAR_DEPTH_GAIN;
      out.joints[j * 3 + 2] = clamp(z, -AVATAR_DEPTH_MAX_M, AVATAR_DEPTH_MAX_M);
    }
  } else heuristicDepth(out, rig, shoulderPlay);
  // Hands: player handedness → avatar side; world landmarks in game orientation.
  out.hands[0] = out.hands[1] = null;
  for (const hand of hands) {
    if (hand.landmarks.length < 63 || hand.worldLandmarks.length < 63) continue;
    const anatomicalIndex = hand.handedness === 'left' ? 0 : 1;
    const side: Side = (anatomicalIndex === 0) === options.mirror ? 'R' : 'L';
    const k = sideIndex(side),
      dst = ownHands[k];
    let finite = true;
    for (let i = 0; i < 21; i++) {
      const x = hand.worldLandmarks[i * 3]!,
        y = hand.worldLandmarks[i * 3 + 1]!,
        z = hand.worldLandmarks[i * 3 + 2]!;
      finite &&= Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
      dst[i * 3] = x;
      dst[i * 3 + 1] = -y;
      dst[i * 3 + 2] = -z;
    }
    if (!finite) continue;
    out.hands[k] = dst;
    // Hand wrist image position is more precise than the pose wrist; keep the pose depth.
    const wrist = k === 0 ? J.WRIST_L : J.WRIST_R;
    const u = hand.landmarks[0]!,
      v = hand.landmarks[1]!;
    if (Number.isFinite(u) && Number.isFinite(v)) {
      handWrist[k]!.set((u - 0.5) * PLAY_W, PLAY_CENTER_Y + (0.5 - v) * PLAY_H, out.joints[wrist * 3 + 2]!);
      out.joints[wrist * 3] = handWrist[k]!.x;
      out.joints[wrist * 3 + 1] = handWrist[k]!.y;
      if (!out.valid[wrist]) {
        out.valid[wrist] = 1;
        out.joints[wrist * 3 + 2] = out.valid[k === 0 ? J.ELBOW_L : J.ELBOW_R]
          ? out.joints[(k === 0 ? J.ELBOW_L : J.ELBOW_R) * 3 + 2]!
          : 0;
      }
    }
  }
  // Camera rays: keep each joint's screen projection while moving it to its depth.
  for (let j = 0; j < JOINT_COUNT; j++) {
    const z = out.joints[j * 3 + 2]!,
      k = (CAM_POS.z - z) / CAM_POS.z;
    out.joints[j * 3] = CAM_POS.x + (out.joints[j * 3]! - CAM_POS.x) * k;
    out.joints[j * 3 + 1] = CAM_POS.y + (out.joints[j * 3 + 1]! - CAM_POS.y) * k;
  }
  out.curl[0] = out.curl[1] = AVATAR_RELAXED_CURL;
  return true;
}

/** 2D-only sources: forward depth from limb foreshortening against the rig's proportions. */
function heuristicDepth(out: AvatarTargets, rig: AvatarRig, shoulderPlay: number): void {
  const a = rig.anchors,
    restShoulder = a[J.SHOULDER_L]!.distanceTo(a[J.SHOULDER_R]!),
    unit = shoulderPlay / restShoulder;
  const p = out.joints;
  for (let j = 0; j < JOINT_COUNT; j++) p[j * 3 + 2] = 0;
  // Face points sit in front of the ears by the rig's own proportion.
  const earZ = (a[J.EAR_L]!.z + a[J.EAR_R]!.z) / 2;
  for (const j of [J.NOSE, J.EYE_L, J.EYE_R]) p[j * 3 + 2] = (a[j]!.z - earZ) * unit;
  for (const side of SIDES) {
    const k = sideIndex(side),
      s = J.SHOULDER_L + k,
      e = J.ELBOW_L + k,
      w = J.WRIST_L + k;
    const upper = a[s]!.distanceTo(a[e]!) * unit,
      fore = a[e]!.distanceTo(a[w]!) * unit;
    if (out.valid[e]) {
      const d = Math.hypot(p[e * 3]! - p[s * 3]!, p[e * 3 + 1]! - p[s * 3 + 1]!);
      p[e * 3 + 2] = Math.sqrt(Math.max(0, upper * upper - d * d));
      if (out.valid[w]) {
        const d2 = Math.hypot(p[w * 3]! - p[e * 3]!, p[w * 3 + 1]! - p[e * 3 + 1]!);
        p[w * 3 + 2] = p[e * 3 + 2]! + Math.sqrt(Math.max(0, fore * fore - d2 * d2));
      }
    }
    for (const j of [J.INDEX_L + k, J.PINKY_L + k, J.THUMB_L + k]) p[j * 3 + 2] = p[w * 3 + 2]!;
  }
  for (let j = 0; j < JOINT_COUNT; j++)
    p[j * 3 + 2] = clamp(p[j * 3 + 2]!, -AVATAR_DEPTH_MAX_M, AVATAR_DEPTH_MAX_M);
}

/** Explicit joints for synthesized subjects (e.g. a performer rendered into a virtual camera). */
export interface AvatarJointInput {
  /** MediaPipe upper-body indices 0..24 × (x, y, z): metres, Y up, +Z toward the viewer. NaN marks a missing joint. */
  readonly pose: ArrayLike<number>;
  /** Optional 21-point hands by the subject's anatomical side, same axes (metres). */
  readonly hands?: { readonly left?: ArrayLike<number> | null; readonly right?: ArrayLike<number> | null };
  /** false (default): landmark 11, the subject's left shoulder, drives the avatar's left side. */
  readonly mirror?: boolean;
  /** Finger curl used for a hand without landmarks (0 straight … 1 fist). */
  readonly curl?: readonly [number, number];
}
const ownJointHands: [Float32Array, Float32Array] = [new Float32Array(63), new Float32Array(63)];
export function targetsFromJoints(input: AvatarJointInput, out: AvatarTargets): AvatarTargets {
  const mirror = input.mirror ?? false;
  if (input.pose.length < 25 * 3) throw new RangeError('Avatar joint input needs 25 upper-body joints.');
  for (let j = 0; j < JOINT_COUNT; j++) {
    const entry = POSE_SOURCE[j]!;
    const i = typeof entry === 'number' ? entry : entry[anatomical(j % 2 === 0 ? 'L' : 'R', mirror)];
    const x = input.pose[i * 3]!,
      y = input.pose[i * 3 + 1]!,
      z = input.pose[i * 3 + 2]!;
    const ok = Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
    out.valid[j] = ok ? 1 : 0;
    out.joints[j * 3] = ok ? x : 0;
    out.joints[j * 3 + 1] = ok ? y : 0;
    out.joints[j * 3 + 2] = ok ? z : 0;
  }
  out.hands[0] = out.hands[1] = null;
  for (const [anat, hand] of [
    [0, input.hands?.left],
    [1, input.hands?.right],
  ] as const) {
    if (!hand || hand.length < 63) continue;
    const k = sideIndex((anat === 0) === mirror ? 'R' : 'L'),
      dst = ownJointHands[k];
    let ok = true;
    for (let i = 0; i < 63; i++) {
      dst[i] = hand[i]!;
      ok &&= Number.isFinite(dst[i]!);
    }
    if (ok) out.hands[k] = dst;
  }
  out.curl[0] = input.curl?.[0] ?? AVATAR_RELAXED_CURL;
  out.curl[1] = input.curl?.[1] ?? AVATAR_RELAXED_CURL;
  return out;
}

/** Write the rig's rest anchors (optionally scaled/translated) as fully valid targets. */
export function restTargets(rig: AvatarRig, out: AvatarTargets, scale = 1, offset?: Vector3): AvatarTargets {
  for (let j = 0; j < JOINT_COUNT; j++) {
    scratchA.copy(rig.anchors[j]!).multiplyScalar(scale);
    if (offset) scratchA.add(offset);
    out.joints[j * 3] = scratchA.x;
    out.joints[j * 3 + 1] = scratchA.y;
    out.joints[j * 3 + 2] = scratchA.z;
    out.valid[j] = 1;
  }
  out.hands[0] = out.hands[1] = null;
  out.curl[0] = out.curl[1] = 0;
  return out;
}

const NEUTRAL_OFFSETS = {
  // Relaxed arms hanging slightly forward/outward from the shoulders (model metres, torso frame).
  elbow: new Vector3(0.045, -0.27, -0.035),
  wrist: new Vector3(0.07, -0.51, 0.045),
};
/** Neutral standing pose in model space (arms relaxed at the sides). */
export function neutralTargets(rig: AvatarRig, out: AvatarTargets): AvatarTargets {
  restTargets(rig, out);
  for (const side of SIDES) {
    const k = sideIndex(side),
      sign = side === 'L' ? 1 : -1,
      shoulder = rig.anchors[J.SHOULDER_L + k]!;
    const put = (j: number, offset: Vector3) => {
      out.joints[j * 3] = shoulder.x + offset.x * sign;
      out.joints[j * 3 + 1] = shoulder.y + offset.y;
      out.joints[j * 3 + 2] = shoulder.z + offset.z;
    };
    put(J.ELBOW_L + k, NEUTRAL_OFFSETS.elbow);
    put(J.WRIST_L + k, NEUTRAL_OFFSETS.wrist);
    // Hand points continue down the forearm line; the relaxed palm faces the thigh.
    for (const [j, dz, dx] of [
      [J.INDEX_L + k, 0.03, -0.01],
      [J.PINKY_L + k, -0.03, 0.0],
      [J.THUMB_L + k, 0.045, -0.02],
    ] as const) {
      out.joints[j * 3] = shoulder.x + (NEUTRAL_OFFSETS.wrist.x + dx) * sign;
      out.joints[j * 3 + 1] = shoulder.y + NEUTRAL_OFFSETS.wrist.y - 0.085;
      out.joints[j * 3 + 2] = shoulder.z + NEUTRAL_OFFSETS.wrist.z + dz;
    }
  }
  out.curl[0] = out.curl[1] = AVATAR_RELAXED_CURL;
  return out;
}

/**
 * Procedural illustrative idle (breathing, weight shift, small head/hand motion) in model space.
 * Calm callers pass t = 0 for a static pose. This is decoration, never tracking evidence.
 */
export function idleTargets(rig: AvatarRig, out: AvatarTargets, tSec: number): AvatarTargets {
  neutralTargets(rig, out);
  const i = AVATAR_IDLE,
    breath = Math.sin((2 * Math.PI * tSec) / i.breathPeriodS),
    sway = Math.sin((2 * Math.PI * tSec) / i.swayPeriodS),
    look = Math.sin((2 * Math.PI * tSec) / i.lookPeriodS),
    nod = Math.sin((2 * Math.PI * tSec) / (i.lookPeriodS * 0.71) + 1.3);
  const p = out.joints;
  const bump = (index: number, value: number) => (p[index] = p[index]! + value);
  for (let j = 0; j < JOINT_COUNT; j++) {
    const isHip = j === J.HIP_L || j === J.HIP_R;
    // Weight shift: hips slide, shoulders counter-tilt; breathing lifts everything above the hips.
    bump(j * 3, isHip ? sway * i.swayM : -sway * i.swayM * 0.35);
    if (!isHip) bump(j * 3 + 1, (breath * 0.5 + 0.5) * i.breathM);
  }
  bump(J.HIP_L * 3 + 1, sway * i.swayM * 0.5);
  bump(J.HIP_R * 3 + 1, -sway * i.swayM * 0.5);
  bump(J.SHOULDER_L * 3 + 1, -sway * i.swayM * 0.25);
  bump(J.SHOULDER_R * 3 + 1, sway * i.swayM * 0.25);
  // Head: rotate the face points about the ear midpoint.
  const yaw = (look * i.lookDeg * Math.PI) / 180,
    pitch = (nod * i.lookDeg * 0.35 * Math.PI) / 180;
  const cx = (p[J.EAR_L * 3]! + p[J.EAR_R * 3]!) / 2,
    cy = (p[J.EAR_L * 3 + 1]! + p[J.EAR_R * 3 + 1]!) / 2,
    cz = (p[J.EAR_L * 3 + 2]! + p[J.EAR_R * 3 + 2]!) / 2;
  q1.setFromAxisAngle(AXIS_Y, yaw).multiply(q2.setFromAxisAngle(AXIS_X, pitch));
  for (const j of [J.NOSE, J.EAR_L, J.EAR_R, J.EYE_L, J.EYE_R]) {
    scratchA.set(p[j * 3]! - cx, p[j * 3 + 1]! - cy, p[j * 3 + 2]! - cz).applyQuaternion(q1);
    p[j * 3] = cx + scratchA.x;
    p[j * 3 + 1] = cy + scratchA.y;
    p[j * 3 + 2] = cz + scratchA.z;
  }
  // Arms swing gently out of phase; fingers breathe a little.
  for (const side of SIDES) {
    const k = sideIndex(side),
      phase = Math.sin((2 * Math.PI * tSec) / (i.swayPeriodS * 0.83) + k * 2.1);
    for (const j of [J.ELBOW_L + k, J.WRIST_L + k, J.INDEX_L + k, J.PINKY_L + k, J.THUMB_L + k]) {
      const reach = j === J.ELBOW_L + k ? 0.5 : 1;
      bump(j * 3 + 2, phase * i.armSwingM * reach);
    }
    out.curl[k] = AVATAR_RELAXED_CURL + i.curlRange * (0.5 + 0.5 * Math.sin(tSec * 0.9 + k * 1.7));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Solver.
const AXIS_X = new Vector3(1, 0, 0),
  AXIS_Y = new Vector3(0, 1, 0),
  AXIS_Z = new Vector3(0, 0, 1);
const DEG = Math.PI / 180;
const IDENTITY = new Quaternion();
const q1 = new Quaternion(),
  q2 = new Quaternion(),
  q3 = new Quaternion(),
  m1 = new Matrix4();
const fx = new Vector3(),
  fy = new Vector3(),
  fz = new Vector3();
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
/** Orthonormal frame quaternion with Y along `up` and X along `across` (orthogonalised). */
function frame(out: Quaternion, across: Vector3, up: Vector3): boolean {
  fy.copy(up);
  if (fy.lengthSq() < 1e-12) return false;
  fy.normalize();
  fx.copy(across).addScaledVector(fy, -across.dot(fy));
  if (fx.lengthSq() < 1e-10) return false;
  fx.normalize();
  fz.crossVectors(fx, fy);
  m1.makeBasis(fx, fy, fz);
  out.setFromRotationMatrix(m1);
  return true;
}
/** Rotation angle of a unit quaternion, radians in [0, pi]. */
export function quatAngle(q: Quaternion): number {
  return 2 * Math.acos(clamp(Math.abs(q.w), 0, 1));
}
/** Limit the rotation angle of q to maxRad (in place). */
function limitAngle(q: Quaternion, maxRad: number): Quaternion {
  if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
  const angle = quatAngle(q);
  if (angle <= maxRad || angle < 1e-6) return q;
  return q.slerp(IDENTITY, 1 - maxRad / angle);
}
/** Signed twist angle of q about a unit axis (swing-twist decomposition). */
export function swingTwistAngle(q: Quaternion, axis: Vector3): number {
  const p = q.x * axis.x + q.y * axis.y + q.z * axis.z;
  let angle = 2 * Math.atan2(p, q.w);
  if (angle > Math.PI) angle -= 2 * Math.PI;
  if (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

interface ArmRest {
  readonly clavicle: number;
  readonly upper: number;
  readonly fore: number;
  readonly hand: number;
  readonly upperLen: number;
  readonly foreLen: number;
  readonly restUpperDir: Vector3;
  readonly restForeDir: Vector3;
  readonly restBend: Vector3;
  readonly restBendBasis: Quaternion;
  readonly restHandBasis: Quaternion;
  readonly restPoseHandBasis: Quaternion;
  readonly fingers: Record<Finger, readonly [number, number, number]>;
}
interface FingerRest {
  readonly dir: Vector3;
  readonly flexAxis: Vector3;
  readonly palmar: Vector3;
}

export interface SolverState {
  /** Smoothed bone-local quaternions (x, y, z, w) in rig bone order. */
  readonly local: Float32Array;
  /** Smoothed length factor applied to each bone's rest local position (arm stretch). */
  readonly stretch: Float32Array;
  /**
   * Model-space point that corresponds to the targets' shoulder midpoint: place the avatar root at
   * `targetShoulderMid - scale * anchor` so tracked shoulders and the avatar's shoulders coincide.
   */
  readonly anchor: Vector3;
  /** Whether the last update had a torso (false = holding/easing toward neutral). */
  tracked: boolean;
}

const FINGER_CURL_DEG: Record<'finger' | 'thumb', readonly [number, number, number]> = {
  finger: [70, 95, 60],
  thumb: [10, 25, 30],
};

export class AvatarSolver {
  readonly state: SolverState;
  private readonly n: number;
  private readonly targetLocal: Float32Array;
  private readonly targetStretch: Float32Array;
  private readonly neutralLocal: Float32Array;
  private readonly tau: Float32Array;
  private readonly worldQ: Quaternion[];
  private readonly worldP: Vector3[];
  private readonly arms: Readonly<Record<Side, ArmRest>>;
  private readonly fingerRest: (FingerRest | null)[];
  private readonly restShoulderBasis = new Quaternion();
  private readonly restHipBasis = new Quaternion();
  private readonly restHeadBasis = new Quaternion();
  private readonly restUp = new Vector3();
  private readonly lastSeen = new Float64Array(JOINT_COUNT).fill(-Infinity);
  private readonly lastJoint = new Float32Array(JOINT_COUNT * 3);
  private readonly work: AvatarTargets = createTargets();
  private readonly neutral: AvatarTargets = createTargets();
  private readonly ids: Record<'hips' | 'spine' | 'chest' | 'neck' | 'head', number>;
  private initialized = false;
  // Pooled scratch (no per-frame allocation).
  private readonly a = Array.from({ length: 16 }, () => new Vector3());
  private readonly q = Array.from({ length: 10 }, () => new Quaternion());

  constructor(readonly rig: AvatarRig) {
    const n = (this.n = rig.bones.length);
    this.state = {
      local: new Float32Array(n * 4),
      stretch: new Float32Array(n).fill(1),
      anchor: new Vector3(),
      tracked: false,
    };
    this.targetLocal = new Float32Array(n * 4);
    this.targetStretch = new Float32Array(n).fill(1);
    this.neutralLocal = new Float32Array(n * 4);
    this.tau = new Float32Array(n).fill(AVATAR_SMOOTH_MS);
    this.worldQ = rig.bones.map(() => new Quaternion());
    this.worldP = rig.bones.map(() => new Vector3());
    this.ids = {
      hips: this.bone('hips'),
      spine: this.bone('spine'),
      chest: this.bone('chest'),
      neck: this.bone('neck'),
      head: this.bone('head'),
    };
    rig.bones.forEach((bone, i) => bone.localQuat.toArray(this.state.local, i * 4));
    const an = rig.anchors,
      across = new Vector3();
    this.restUp
      .addVectors(an[J.SHOULDER_L]!, an[J.SHOULDER_R]!)
      .sub(new Vector3().addVectors(an[J.HIP_L]!, an[J.HIP_R]!))
      .multiplyScalar(0.5);
    frame(this.restShoulderBasis, across.subVectors(an[J.SHOULDER_L]!, an[J.SHOULDER_R]!), this.restUp);
    frame(this.restHipBasis, across.subVectors(an[J.HIP_L]!, an[J.HIP_R]!), this.restUp);
    if (!this.headBasis(an[J.NOSE]!, an[J.EAR_L]!, an[J.EAR_R]!, this.restHeadBasis))
      throw new Error('Avatar head anchors are degenerate.');
    this.fingerRest = rig.bones.map(() => null);
    this.arms = { L: this.armRest('L'), R: this.armRest('R') };
    neutralTargets(rig, this.neutral);
    this.solve(this.neutral);
    this.neutralLocal.set(this.targetLocal);
  }

  private bone(name: string): number {
    const i = this.rig.index[name];
    if (i === undefined) throw new Error(`Missing avatar bone ${name}.`);
    return i;
  }
  private headBasis(nose: Vector3, earL: Vector3, earR: Vector3, out: Quaternion): boolean {
    const across = this.a[13]!.subVectors(earL, earR);
    const forward = this.a[14]!.addVectors(earL, earR).multiplyScalar(-0.5).add(nose);
    const up = this.a[15]!.crossVectors(forward, across);
    return frame(out, across, up);
  }
  private armRest(side: Side): ArmRest {
    const id = (name: string) => this.bone(`${name}.${side}`);
    const bones = this.rig.bones;
    const clavicle = id('shoulder'),
      upper = id('upper_arm'),
      fore = id('forearm'),
      hand = id('hand');
    const restUpperDir = bones[fore]!.worldPos.clone().sub(bones[upper]!.worldPos).normalize();
    const restForeDir = bones[hand]!.worldPos.clone().sub(bones[fore]!.worldPos).normalize();
    const restBend = new Vector3().crossVectors(restUpperDir, AXIS_Z).normalize();
    const restBendBasis = new Quaternion();
    frame(restBendBasis, restBend, restUpperDir);
    const fingers = {} as Record<Finger, readonly [number, number, number]>;
    for (const f of FINGERS) fingers[f] = [id(`${f}_01`), id(`${f}_02`), id(`${f}_03`)];
    const wrist = bones[hand]!.worldPos,
      index = bones[fingers.index[0]]!.worldPos,
      pinky = bones[fingers.pinky[0]]!.worldPos,
      middle = bones[fingers.middle[0]]!.worldPos;
    const across = new Vector3().subVectors(index, pinky),
      forward = new Vector3().subVectors(middle, wrist);
    const restHandBasis = new Quaternion();
    frame(restHandBasis, across, forward);
    const k = sideIndex(side),
      an = this.rig.anchors;
    const restPoseHandBasis = new Quaternion();
    frame(
      restPoseHandBasis,
      new Vector3().subVectors(an[J.INDEX_L + k]!, an[J.PINKY_L + k]!),
      new Vector3()
        .addVectors(an[J.INDEX_L + k]!, an[J.PINKY_L + k]!)
        .multiplyScalar(0.5)
        .sub(an[J.WRIST_L + k]!),
    );
    // Palmar normal (out of the palm) in model space; flexion bends a finger toward it.
    const palm = new Vector3()
      .crossVectors(forward.normalize(), across.normalize())
      .multiplyScalar(side === 'L' ? 1 : -1)
      .normalize();
    for (const f of FINGERS)
      for (const i of fingers[f]) {
        const bone = bones[i]!,
          parent = bones[bone.parent]!;
        const toParent = parent.worldQuat.clone().invert();
        const dir = AXIS_Y.clone().applyQuaternion(bone.localQuat).normalize();
        const n = palm.clone().applyQuaternion(toParent);
        const flexAxis = new Vector3().crossVectors(dir, n).normalize();
        const palmar = new Vector3().crossVectors(flexAxis, dir).normalize();
        this.fingerRest[i] = { dir, flexAxis, palmar };
      }
    return {
      clavicle,
      upper,
      fore,
      hand,
      upperLen: bones[upper]!.worldPos.distanceTo(bones[fore]!.worldPos),
      foreLen: bones[fore]!.worldPos.distanceTo(bones[hand]!.worldPos),
      restUpperDir,
      restForeDir,
      restBend,
      restBendBasis,
      restHandBasis,
      restPoseHandBasis,
      fingers,
    };
  }

  /** Reset smoothing/hold so the next tracked update snaps (e.g. after a source change). */
  reset(): void {
    this.initialized = false;
    this.lastSeen.fill(-Infinity);
    this.state.tracked = false;
  }

  /** Neutral (arms relaxed) local rotations, for callers that want a static pose. */
  get neutralPose(): Float32Array {
    return this.neutralLocal;
  }

  /**
   * Solve one frame. Targets are metres at model scale (any translation). `nowMs` drives hold timing;
   * `dtMs` drives smoothing (<= 0 snaps). Without both shoulders the pose holds, then eases to neutral.
   */
  update(targets: AvatarTargets, nowMs: number, dtMs: number): boolean {
    const t = this.work;
    for (let j = 0; j < JOINT_COUNT; j++) {
      const valid = !!targets.valid[j];
      if (valid) {
        this.lastSeen[j] = nowMs;
        for (let c = 0; c < 3; c++) this.lastJoint[j * 3 + c] = targets.joints[j * 3 + c]!;
      }
      const held = !valid && nowMs - this.lastSeen[j]! <= AVATAR_HOLD_MS;
      t.valid[j] = valid || held ? 1 : 0;
      for (let c = 0; c < 3; c++)
        t.joints[j * 3 + c] = valid || held ? this.lastJoint[j * 3 + c]! : targets.joints[j * 3 + c]!;
    }
    t.hands[0] = targets.hands[0];
    t.hands[1] = targets.hands[1];
    t.curl[0] = targets.curl[0];
    t.curl[1] = targets.curl[1];
    const torso = !!(t.valid[J.SHOULDER_L] && t.valid[J.SHOULDER_R]);
    if (torso) {
      this.solve(t);
      this.smooth(this.initialized ? dtMs : 0);
      this.initialized = true;
    } else if (this.initialized) {
      this.targetLocal.set(this.neutralLocal);
      this.targetStretch.fill(1);
      this.tau.fill(AVATAR_MISSING_SMOOTH_MS);
      this.smooth(dtMs);
    }
    this.state.tracked = torso;
    return torso;
  }

  private target(t: AvatarTargets, j: number, out: Vector3): Vector3 {
    return out.set(t.joints[j * 3]!, t.joints[j * 3 + 1]!, t.joints[j * 3 + 2]!);
  }
  private setWorld(i: number, delta: Quaternion): void {
    this.worldQ[i]!.copy(delta).multiply(this.rig.bones[i]!.worldQuat);
  }
  private commitLocal(i: number): void {
    const parent = this.rig.bones[i]!.parent,
      local = q3;
    if (parent < 0) local.copy(this.worldQ[i]!);
    else local.copy(this.worldQ[parent]!).invert().multiply(this.worldQ[i]!);
    local.normalize().toArray(this.targetLocal, i * 4);
  }
  private fk(i: number): Vector3 {
    const bone = this.rig.bones[i]!,
      out = this.worldP[i]!;
    if (bone.parent < 0) return out.copy(bone.localPos);
    return out
      .copy(bone.localPos)
      .multiplyScalar(this.targetStretch[i]!)
      .applyQuaternion(this.worldQ[bone.parent]!)
      .add(this.worldP[bone.parent]!);
  }

  private solve(t: AvatarTargets): void {
    const lim = AVATAR_LIMITS_DEG,
      { hips, spine, chest, neck, head } = this.ids,
      v = this.a,
      Q = this.q;
    this.tau.fill(AVATAR_SMOOTH_MS);
    this.targetStretch.fill(1);
    const sL = this.target(t, J.SHOULDER_L, v[0]!),
      sR = this.target(t, J.SHOULDER_R, v[1]!);
    const shoulderMid = v[2]!.addVectors(sL, sR).multiplyScalar(0.5);
    const hipsValid = !!(t.valid[J.HIP_L] && t.valid[J.HIP_R]);
    const up = v[3]!;
    if (hipsValid)
      up.copy(shoulderMid).sub(
        v[4]!.addVectors(this.target(t, J.HIP_L, v[5]!), this.target(t, J.HIP_R, v[6]!)).multiplyScalar(0.5),
      );
    else up.copy(this.restUp);
    // Torso: shoulder line + up -> chest; hip line + up -> hips; spine halfway.
    const chestDelta = Q[0]!,
      hipDelta = Q[1]!;
    if (frame(chestDelta, v[4]!.subVectors(sL, sR), up))
      chestDelta.multiply(q1.copy(this.restShoulderBasis).invert());
    else chestDelta.identity();
    limitAngle(chestDelta, lim.torsoLean * DEG);
    if (
      hipsValid &&
      frame(hipDelta, v[4]!.subVectors(this.target(t, J.HIP_L, v[5]!), this.target(t, J.HIP_R, v[6]!)), up)
    )
      hipDelta.multiply(q1.copy(this.restHipBasis).invert());
    else hipDelta.copy(chestDelta);
    const twist = q2.copy(hipDelta).invert().multiply(chestDelta);
    limitAngle(twist, lim.torsoTwist * DEG);
    hipDelta.copy(chestDelta).multiply(twist.invert());
    if (!hipsValid) this.tau[hips] = this.tau[spine] = AVATAR_MISSING_SMOOTH_MS;
    this.setWorld(hips, hipDelta);
    this.setWorld(spine, q1.copy(hipDelta).slerp(chestDelta, 0.5));
    this.setWorld(chest, chestDelta);
    for (const i of [hips, spine, chest]) {
      this.commitLocal(i);
      this.fk(i);
    }
    // Head from ears + nose; the neck takes part of the turn.
    const headDelta = Q[2]!.copy(chestDelta);
    let headTracked = false;
    if (t.valid[J.NOSE] && t.valid[J.EAR_L] && t.valid[J.EAR_R]) {
      headTracked = this.headBasis(
        this.target(t, J.NOSE, v[4]!),
        this.target(t, J.EAR_L, v[5]!),
        this.target(t, J.EAR_R, v[6]!),
        headDelta,
      );
      if (headTracked) headDelta.multiply(q1.copy(this.restHeadBasis).invert());
      else headDelta.copy(chestDelta);
    }
    const relHead = limitAngle(q1.copy(chestDelta).invert().multiply(headDelta), lim.head * DEG);
    headDelta.copy(chestDelta).multiply(relHead);
    this.setWorld(neck, q1.copy(chestDelta).slerp(headDelta, 0.45));
    this.setWorld(head, headDelta);
    for (const i of [neck, head]) {
      this.commitLocal(i);
      this.fk(i);
    }
    if (!headTracked) this.tau[neck] = this.tau[head] = AVATAR_MISSING_SMOOTH_MS;
    // Shoulder midpoint in model space (clavicles following the chest) defines the target->model offset.
    for (const side of SIDES) {
      const arm = this.arms[side];
      this.setWorld(arm.clavicle, chestDelta);
      this.fk(arm.clavicle);
      this.fk(arm.upper);
    }
    const anchor = this.state.anchor
      .addVectors(this.worldP[this.arms.L.upper]!, this.worldP[this.arms.R.upper]!)
      .multiplyScalar(0.5);
    const offset = v[7]!.subVectors(anchor, shoulderMid);
    for (const side of SIDES) this.solveArm(side, t, chestDelta, offset);
  }

  private solveArm(side: Side, t: AvatarTargets, chestDelta: Quaternion, offset: Vector3): void {
    const lim = AVATAR_LIMITS_DEG,
      arm = this.arms[side],
      k = sideIndex(side),
      v = this.a,
      Q = this.q;
    const sJ = J.SHOULDER_L + k,
      eJ = J.ELBOW_L + k,
      wJ = J.WRIST_L + k;
    const { clavicle, upper, fore, hand } = arm;
    const neutralPoint = (j: number, out: Vector3) =>
      this.target(this.neutral, j, out).sub(this.rig.anchors[sJ]!).applyQuaternion(chestDelta);
    // Clavicle aims at the tracked shoulder (shrug/reach), clamped.
    const clavDir = v[8]!
      .copy(this.rig.bones[upper]!.localPos)
      .normalize()
      .applyQuaternion(this.worldQ[clavicle]!);
    const want = this.target(t, sJ, v[9]!).add(offset).sub(this.worldP[clavicle]!).normalize();
    const clavDelta = limitAngle(Q[3]!.setFromUnitVectors(clavDir, want), lim.clavicle * DEG);
    this.setWorld(clavicle, q1.copy(clavDelta).multiply(chestDelta));
    this.commitLocal(clavicle);
    const a = v[10]!.copy(this.fk(upper));
    // Elbow/wrist targets: tracked, held, or neutral in the current torso frame.
    const elbowValid = !!t.valid[eJ],
      wristValid = !!t.valid[wJ];
    const elbow = elbowValid ? this.target(t, eJ, v[11]!).add(offset) : neutralPoint(eJ, v[11]!).add(a);
    const wrist = v[12]!;
    if (wristValid) this.target(t, wJ, wrist).add(offset);
    else if (elbowValid) {
      // Forearm continues the upper arm with a relaxed forward bend.
      wrist
        .subVectors(elbow, a)
        .normalize()
        .addScaledVector(v[9]!.copy(AXIS_Z).applyQuaternion(chestDelta), 0.45)
        .normalize()
        .multiplyScalar(arm.foreLen)
        .add(elbow);
    } else neutralPoint(wJ, wrist).add(a);
    if (!elbowValid || !wristValid) this.tau[upper] = this.tau[fore] = AVATAR_MISSING_SMOOTH_MS;
    // Two-bone IK with bounded stretch; the elbow bends toward its tracked/neutral pole.
    const toWrist = v[13]!.subVectors(wrist, a);
    const stretch = clamp(toWrist.length() / (arm.upperLen + arm.foreLen), 1, AVATAR_STRETCH_MAX);
    const l1 = arm.upperLen * stretch,
      l2 = arm.foreLen * stretch;
    const distance = clamp(toWrist.length(), Math.abs(l1 - l2) + 1e-4, l1 + l2 - 1e-6);
    const dir = toWrist.normalize();
    const perp = v[14]!.subVectors(elbow, a);
    perp.addScaledVector(dir, -perp.dot(dir));
    if (perp.lengthSq() < 1e-8) {
      perp.copy(AXIS_Z).applyQuaternion(chestDelta).negate();
      perp.addScaledVector(dir, -perp.dot(dir));
      if (perp.lengthSq() < 1e-8) perp.copy(AXIS_Y).negate().addScaledVector(dir, dir.y);
    }
    perp.normalize();
    const cosA = clamp((l1 * l1 + distance * distance - l2 * l2) / (2 * l1 * distance), -1, 1);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const upperDir = v[8]!.copy(dir).multiplyScalar(cosA).addScaledVector(perp, sinA).normalize();
    const elbowPos = v[9]!.copy(a).addScaledVector(upperDir, l1);
    const foreDir = v[15]!.copy(a).addScaledVector(dir, distance).sub(elbowPos).normalize();
    // Upper arm: swing from the chest-following rest; twist from the bend plane once the elbow bends.
    const upperDelta = Q[4]!.setFromUnitVectors(
      v[11]!.copy(arm.restUpperDir).applyQuaternion(chestDelta),
      upperDir,
    );
    upperDelta.multiply(chestDelta);
    const bend = v[11]!.crossVectors(upperDir, foreDir);
    const bendWeight = clamp((bend.length() - 0.08) / 0.2, 0, 1);
    if (bendWeight > 0 && frame(Q[5]!, bend.normalize(), upperDir)) {
      Q[5]!.multiply(q1.copy(arm.restBendBasis).invert());
      if (Q[5]!.dot(upperDelta) < 0) Q[5]!.set(-Q[5]!.x, -Q[5]!.y, -Q[5]!.z, -Q[5]!.w);
      upperDelta.slerp(Q[5]!, bendWeight);
    }
    this.setWorld(upper, upperDelta);
    this.commitLocal(upper);
    this.targetStretch[fore] = stretch;
    this.fk(fore);
    // Forearm: hinge about the upper arm's bend axis, then remove any residual direction error.
    const hinge = v[11]!.copy(arm.restBend).applyQuaternion(upperDelta);
    const restFore = v[12]!.copy(arm.restForeDir).applyQuaternion(upperDelta);
    const flex = Math.atan2(v[13]!.crossVectors(restFore, foreDir).dot(hinge), restFore.dot(foreDir));
    const foreDelta = Q[6]!.setFromAxisAngle(hinge, clamp(flex, -0.1, 150 * DEG)).multiply(upperDelta);
    foreDelta.premultiply(
      q1.setFromUnitVectors(restFore.copy(arm.restForeDir).applyQuaternion(foreDelta), foreDir),
    );
    // Hand orientation: hand landmarks, else pose index/pinky, else follow the forearm.
    const handDelta = Q[7]!;
    let handKnown = false;
    const lm = t.hands[k];
    if (lm) {
      const across = v[12]!.set(lm[15]! - lm[51]!, lm[16]! - lm[52]!, lm[17]! - lm[53]!);
      const forward = v[13]!.set(lm[27]! - lm[0]!, lm[28]! - lm[1]!, lm[29]! - lm[2]!);
      handKnown = frame(handDelta, across, forward);
      if (handKnown) handDelta.multiply(q1.copy(arm.restHandBasis).invert());
    } else if (t.valid[J.INDEX_L + k] && t.valid[J.PINKY_L + k] && wristValid) {
      const index = this.target(t, J.INDEX_L + k, v[12]!),
        pinky = this.target(t, J.PINKY_L + k, v[13]!);
      const forward = v[14]!
        .addVectors(index, pinky)
        .multiplyScalar(0.5)
        .sub(this.target(t, wJ, v[9]!));
      handKnown = frame(handDelta, index.sub(pinky), forward);
      if (handKnown) handDelta.multiply(q1.copy(arm.restPoseHandBasis).invert());
    }
    if (!handKnown) {
      handDelta.copy(foreDelta);
      this.tau[hand] = AVATAR_MISSING_SMOOTH_MS;
    }
    // Share pronation: half of the hand's twist about the forearm axis rotates the forearm.
    const relWorld = Q[8]!.copy(handDelta).multiply(q1.copy(foreDelta).invert());
    const twist = swingTwistAngle(relWorld, foreDir);
    foreDelta.premultiply(q1.setFromAxisAngle(foreDir, 0.5 * twist));
    this.setWorld(fore, foreDelta);
    this.commitLocal(fore);
    this.targetStretch[hand] = stretch;
    this.fk(hand);
    const relHand = limitAngle(Q[9]!.copy(handDelta).multiply(q1.copy(foreDelta).invert()), lim.wrist * DEG);
    this.setWorld(hand, relHand.multiply(foreDelta));
    this.commitLocal(hand);
    this.solveFingers(arm, t.hands[k], clamp(t.curl[k], 0, 1));
  }

  private solveFingers(arm: ArmRest, lm: Float32Array | null, curl: number): void {
    const lim = AVATAR_LIMITS_DEG,
      d = this.a[12]!;
    for (const f of FINGERS) {
      const chain = HAND_CHAINS[f],
        ids = arm.fingers[f],
        thumb = f === 'thumb';
      for (let s = 0; s < 3; s++) {
        const id = ids[s]!,
          bone = this.rig.bones[id]!,
          rest = this.fingerRest[id]!;
        const [minFlex, maxFlex] = thumb
          ? s === 0
            ? [-lim.thumbBase, lim.thumbBase]
            : lim.thumbFlex
          : s === 0
            ? lim.mcpFlex
            : s === 1
              ? lim.pipFlex
              : lim.dipFlex;
        let flex: number,
          spread = 0;
        if (lm) {
          const from = chain[s]!,
            to = chain[s + 1]!;
          d.set(
            lm[to * 3]! - lm[from * 3]!,
            lm[to * 3 + 1]! - lm[from * 3 + 1]!,
            lm[to * 3 + 2]! - lm[from * 3 + 2]!,
          );
          d.applyQuaternion(q1.copy(this.worldQ[bone.parent]!).invert());
          flex = Math.atan2(d.dot(rest.palmar), d.dot(rest.dir)) / DEG;
          if (s === 0) spread = Math.atan2(d.dot(rest.flexAxis), d.dot(rest.dir)) / DEG;
        } else {
          flex = FINGER_CURL_DEG[thumb ? 'thumb' : 'finger'][s]! * curl;
          this.tau[id] = AVATAR_MISSING_SMOOTH_MS;
        }
        flex = clamp(flex, minFlex, maxFlex);
        const spreadLimit = thumb ? lim.thumbBase : lim.spread;
        spread = clamp(spread, -spreadLimit, spreadLimit);
        const local = q2
          .setFromAxisAngle(rest.flexAxis, flex * DEG)
          .multiply(q3.setFromAxisAngle(rest.palmar, -spread * DEG))
          .multiply(bone.localQuat)
          .normalize();
        local.toArray(this.targetLocal, id * 4);
        this.worldQ[id]!.copy(this.worldQ[bone.parent]!).multiply(local);
      }
    }
  }

  private smooth(dtMs: number): void {
    const local = this.state.local;
    for (let i = 0; i < this.n; i++) {
      const alpha = dtMs <= 0 ? 1 : 1 - Math.exp(-dtMs / this.tau[i]!);
      q1.fromArray(local, i * 4);
      q2.fromArray(this.targetLocal, i * 4);
      if (q1.dot(q2) < 0) q2.set(-q2.x, -q2.y, -q2.z, -q2.w);
      q1.slerp(q2, alpha)
        .normalize()
        .toArray(local, i * 4);
      this.state.stretch[i] =
        this.state.stretch[i]! + (this.targetStretch[i]! - this.state.stretch[i]!) * alpha;
    }
  }
}

/** Model-space bone head positions for a set of local rotations (tests/debug; allocates). */
export function posedPositions(rig: AvatarRig, local: Float32Array, stretch?: Float32Array): Vector3[] {
  const q: Quaternion[] = [],
    p: Vector3[] = [];
  rig.bones.forEach((bone, i) => {
    const lq = new Quaternion().fromArray(local, i * 4);
    if (bone.parent < 0) {
      q.push(lq);
      p.push(bone.localPos.clone());
      return;
    }
    q.push(q[bone.parent]!.clone().multiply(lq));
    p.push(
      bone.localPos
        .clone()
        .multiplyScalar(stretch?.[i] ?? 1)
        .applyQuaternion(q[bone.parent]!)
        .add(p[bone.parent]!),
    );
  });
  return p;
}
/** Model-space world rotations for a set of local rotations (tests/debug; allocates). */
export function posedRotations(rig: AvatarRig, local: Float32Array): Quaternion[] {
  const q: Quaternion[] = [];
  rig.bones.forEach((bone, i) => {
    const lq = new Quaternion().fromArray(local, i * 4);
    q.push(bone.parent < 0 ? lq : q[bone.parent]!.clone().multiply(lq));
  });
  return q;
}
