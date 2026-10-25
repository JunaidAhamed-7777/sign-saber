/** Retargeting against the actual authored avatar rig (GLB parsed in Node; no GPU, webcam or pixels). */
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { avatarFromScene } from '../src/render/avatar';
import type { AvatarAsset } from '../src/render/avatar';
import {
  AVATAR_BONE_NAMES,
  AvatarSolver,
  FINGERS,
  J,
  JOINT_COUNT,
  createTargets,
  idleTargets,
  neutralTargets,
  posedPositions,
  posedRotations,
  quatAngle,
  restTargets,
  targetsFromJoints,
  targetsFromTracking,
} from '../src/render/avatarRetarget';
import type { AvatarRig, AvatarTargets } from '../src/render/avatarRetarget';
import { AVATAR_HOLD_MS, AVATAR_STRETCH_MAX } from '../src/core/constants';

let asset: AvatarAsset;
let rig: AvatarRig;
beforeAll(async () => {
  // Node-only file read; the app tsconfig has no Node types, so resolve the module at runtime.
  const fsModule = 'node:fs/promises';
  const { readFile } = (await import(/* @vite-ignore */ fsModule)) as {
    readFile(url: URL): Promise<Uint8Array>;
  };
  const bytes = await readFile(new URL('../public/assets/models/avatar.glb', import.meta.url));
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  asset = avatarFromScene(gltf.scene);
  rig = asset.rig;
});

const idx = (name: string) => rig.index[name]!;
const vec = (t: AvatarTargets, j: number) => new THREE.Vector3().fromArray(t.joints, j * 3);
const put = (t: AvatarTargets, j: number, p: THREE.Vector3) => p.toArray(t.joints, j * 3);
function maxRestDeviationDeg(local: Float32Array, names: readonly string[]): number {
  let worst = 0;
  for (const name of names) {
    const i = idx(name);
    const q = new THREE.Quaternion().fromArray(local, i * 4);
    worst = Math.max(worst, (quatAngle(q.invert().multiply(rig.bones[i]!.localQuat)) * 180) / Math.PI);
  }
  return worst;
}
/** Solved bone head positions mapped back into target space (the anchor aligns shoulder midpoints). */
function solvedJoint(solver: AvatarSolver, t: AvatarTargets, bone: string): THREE.Vector3 {
  const p = posedPositions(rig, solver.state.local, solver.state.stretch)[idx(bone)]!;
  const mid = vec(t, J.SHOULDER_L).add(vec(t, J.SHOULDER_R)).multiplyScalar(0.5);
  return p.sub(solver.state.anchor).add(mid);
}

describe('authored avatar rig', () => {
  it('loads every standard bone and landmark anchor, with no leg bones', () => {
    expect(rig.bones.map((b) => b.name)).toEqual([...AVATAR_BONE_NAMES]);
    expect(rig.bones).toHaveLength(43);
    expect(rig.anchors).toHaveLength(JOINT_COUNT);
    expect(rig.bones.some((b) => /thigh|leg|shin|foot|knee/i.test(b.name))).toBe(false);
    // Faces +Z: nose in front of the ears; avatar-left (.L) on +X.
    expect(rig.anchors[J.NOSE]!.z).toBeGreaterThan(rig.anchors[J.EAR_L]!.z + 0.05);
    expect(rig.bones[idx('hand.L')]!.worldPos.x).toBeGreaterThan(0.5);
    expect(rig.bones[idx('hand.R')]!.worldPos.x).toBeLessThan(-0.5);
  });
});

describe('avatar retargeting', () => {
  it('maps the rest anchors to the rest pose (identity deltas)', () => {
    const solver = new AvatarSolver(rig),
      t = restTargets(rig, createTargets(), 1.7, new THREE.Vector3(0.3, 1.2, -0.1));
    // Scale-free: targets are divided by scale by callers; here feed model scale directly.
    restTargets(rig, t);
    solver.update(t, 0, 0);
    expect(maxRestDeviationDeg(solver.state.local, AVATAR_BONE_NAMES)).toBeLessThan(0.75);
    expect(
      solver.state.anchor.distanceTo(vec(t, J.SHOULDER_L).add(vec(t, J.SHOULDER_R)).multiplyScalar(0.5)),
    ).toBeLessThan(1e-4);
  });

  it('raises an arm to horizontal and lands the hand on the tracked wrist', () => {
    const solver = new AvatarSolver(rig),
      t = restTargets(rig, createTargets());
    const s = vec(t, J.SHOULDER_L);
    const upper = rig.anchors[J.SHOULDER_L]!.distanceTo(rig.anchors[J.ELBOW_L]!),
      fore = rig.anchors[J.ELBOW_L]!.distanceTo(rig.anchors[J.WRIST_L]!);
    put(t, J.ELBOW_L, s.clone().add(new THREE.Vector3(upper, 0, 0)));
    put(t, J.WRIST_L, s.clone().add(new THREE.Vector3(upper + fore, 0, 0)));
    solver.update(t, 0, 0);
    expect(solvedJoint(solver, t, 'hand.L').distanceTo(vec(t, J.WRIST_L))).toBeLessThan(0.01);
    expect(solvedJoint(solver, t, 'forearm.L').distanceTo(vec(t, J.ELBOW_L))).toBeLessThan(0.01);
    // The other arm keeps its rest pose.
    expect(maxRestDeviationDeg(solver.state.local, ['upper_arm.R', 'forearm.R'])).toBeLessThan(0.75);
  });

  it.each([90, 120])('reproduces a %i° elbow with the forearm bending forward', (deg) => {
    const solver = new AvatarSolver(rig),
      t = restTargets(rig, createTargets());
    const s = vec(t, J.SHOULDER_R);
    const upper = rig.anchors[J.SHOULDER_R]!.distanceTo(rig.anchors[J.ELBOW_R]!),
      fore = rig.anchors[J.ELBOW_R]!.distanceTo(rig.anchors[J.WRIST_R]!);
    const elbow = s.clone().add(new THREE.Vector3(0, -upper, 0));
    const inner = ((180 - deg) * Math.PI) / 180; // flexion from straight
    const wrist = elbow
      .clone()
      .add(new THREE.Vector3(0, -Math.cos(inner), Math.sin(inner)).multiplyScalar(fore));
    put(t, J.ELBOW_R, elbow);
    put(t, J.WRIST_R, wrist);
    solver.update(t, 0, 0);
    const p = posedPositions(rig, solver.state.local, solver.state.stretch);
    const a = p[idx('upper_arm.R')]!,
      e = p[idx('forearm.R')]!,
      w = p[idx('hand.R')]!;
    const angle = (a.clone().sub(e).angleTo(w.clone().sub(e)) * 180) / Math.PI;
    expect(Math.abs(angle - deg)).toBeLessThan(2);
    expect(w.z).toBeGreaterThan(e.z + 0.05);
  });

  it('stretches arms by a bounded amount to reach far wrists', () => {
    const solver = new AvatarSolver(rig),
      t = restTargets(rig, createTargets());
    const s = vec(t, J.SHOULDER_L),
      reach = rig.anchors[J.SHOULDER_L]!.distanceTo(rig.anchors[J.WRIST_L]!);
    put(t, J.ELBOW_L, s.clone().add(new THREE.Vector3(0, 0, 0.3)));
    put(t, J.WRIST_L, s.clone().add(new THREE.Vector3(0, 0, reach * 1.08)));
    solver.update(t, 0, 0);
    expect(solver.state.stretch[idx('forearm.L')]).toBeCloseTo(1.08, 2);
    expect(solvedJoint(solver, t, 'hand.L').distanceTo(vec(t, J.WRIST_L))).toBeLessThan(0.01);
    put(t, J.WRIST_L, s.clone().add(new THREE.Vector3(0, 0, reach * 2)));
    solver.update(t, 0, 0);
    expect(solver.state.stretch[idx('forearm.L')]).toBeCloseTo(AVATAR_STRETCH_MAX, 5);
  });

  it('recovers fist and point curls from 21-point hand landmarks', () => {
    // Curl-driven reference poses, converted into landmarks, must solve back to the same finger rotations.
    for (const gesture of ['fist', 'point', 'open'] as const) {
      const reference = new AvatarSolver(rig),
        t = restTargets(rig, createTargets());
      t.curl[0] = t.curl[1] = gesture === 'open' ? 0 : 1;
      reference.update(t, 0, 0);
      const landmarks = handLandmarks(reference.state.local, 'L', gesture === 'point');
      const solver = new AvatarSolver(rig),
        u = restTargets(rig, createTargets());
      u.hands[0] = landmarks;
      solver.update(u, 0, 0);
      for (const f of FINGERS)
        for (let s = 1; s <= 3; s++) {
          const name = `${f}_0${s}.L`,
            i = idx(name);
          const want = new THREE.Quaternion().fromArray(
            gesture === 'point' && f === 'index' ? restLocal(i) : reference.state.local,
            gesture === 'point' && f === 'index' ? 0 : i * 4,
          );
          const got = new THREE.Quaternion().fromArray(solver.state.local, i * 4);
          expect((quatAngle(want.invert().multiply(got)) * 180) / Math.PI, `${gesture} ${name}`).toBeLessThan(
            4,
          );
        }
      const tip = (f: string) => posedPositions(rig, solver.state.local)[idx(`${f}_03.L`)]!;
      const palm = posedPositions(rig, solver.state.local)[idx('hand.L')]!;
      if (gesture === 'fist') expect(tip('index').distanceTo(palm)).toBeLessThan(0.1);
      if (gesture === 'point')
        expect(tip('index').distanceTo(palm)).toBeGreaterThan(tip('middle').distanceTo(palm) + 0.02);
    }
  });

  it('holds then eases missing joints toward the neutral pose instead of snapping', () => {
    const solver = new AvatarSolver(rig),
      t = restTargets(rig, createTargets());
    solver.update(t, 0, 0);
    const rest = new THREE.Quaternion().fromArray(solver.state.local, idx('upper_arm.L') * 4);
    t.valid[J.ELBOW_L] = t.valid[J.WRIST_L] = 0;
    solver.update(t, AVATAR_HOLD_MS / 2, 16);
    const held = new THREE.Quaternion().fromArray(solver.state.local, idx('upper_arm.L') * 4);
    expect(quatAngle(held.clone().invert().multiply(rest))).toBeLessThan(1e-3);
    let now = AVATAR_HOLD_MS;
    solver.update(t, (now += 16), 16);
    const first = new THREE.Quaternion().fromArray(solver.state.local, idx('upper_arm.L') * 4);
    const step = quatAngle(first.clone().invert().multiply(rest));
    expect(step).toBeGreaterThan(0);
    expect(step).toBeLessThan(0.1);
    for (let i = 0; i < 200; i++) solver.update(t, (now += 16), 16);
    const neutral = new THREE.Quaternion().fromArray(solver.neutralPose, idx('upper_arm.L') * 4);
    const settled = new THREE.Quaternion().fromArray(solver.state.local, idx('upper_arm.L') * 4);
    expect(quatAngle(settled.invert().multiply(neutral))).toBeLessThan(0.02);
    // Neutral arms hang below the shoulders.
    const p = posedPositions(rig, solver.state.local);
    expect(p[idx('hand.L')]!.y).toBeLessThan(p[idx('upper_arm.L')]!.y - 0.4);
  });

  it('keeps the placement anchor on the rendered shoulders throughout a lean and tracking loss', () => {
    const solver = new AvatarSolver(rig);
    const t = neutralTargets(rig, createTargets());
    solver.update(t, 0, 0);
    const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 6);
    for (let j = 0; j < JOINT_COUNT; j++) put(t, j, vec(t, j).applyQuaternion(turn));
    const expectRenderedAnchor = () => {
      const p = posedPositions(rig, solver.state.local, solver.state.stretch);
      const shoulderMid = p[idx('upper_arm.L')]!.clone().add(p[idx('upper_arm.R')]!).multiplyScalar(0.5);
      expect(solver.state.anchor.distanceTo(shoulderMid)).toBeLessThan(1e-6);
    };
    for (let frame = 1; frame <= 30; frame++) {
      solver.update(t, frame * 16, 16);
      expectRenderedAnchor();
    }
    // Loss recovery also changes the torso, and must not leave the old anchor behind.
    t.valid.fill(0);
    for (let frame = 31; frame <= 90; frame++) {
      solver.update(t, frame * 16, 16);
      expectRenderedAnchor();
    }
  });

  it('anchors asymmetric shoulder reaches after clavicle solving, including snap updates', () => {
    const solver = new AvatarSolver(rig);
    const t = neutralTargets(rig, createTargets());
    t.joints[J.SHOULDER_L * 3 + 1]! += 0.08;
    solver.update(t, 0, 0);
    const p = posedPositions(rig, solver.state.local, solver.state.stretch);
    const shoulderMid = p[idx('upper_arm.L')]!.clone().add(p[idx('upper_arm.R')]!).multiplyScalar(0.5);
    expect(solver.state.anchor.distanceTo(shoulderMid)).toBeLessThan(1e-6);
  });

  it.each([
    ['pitch', new THREE.Vector3(1, 0, 0)],
    ['yaw', new THREE.Vector3(0, 1, 0)],
    ['roll', new THREE.Vector3(0, 0, 1)],
  ] as const)('preserves the authored head basis during a combined torso turn and head %s', (_name, axis) => {
    const solver = new AvatarSolver(rig);
    const t = restTargets(rig, createTargets());
    const torso = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, 0.15, -0.1));
    const head = new THREE.Quaternion().setFromAxisAngle(axis, Math.PI / 9);
    const centre = vec(t, J.EAR_L).add(vec(t, J.EAR_R)).multiplyScalar(0.5);
    for (const j of [J.NOSE, J.EAR_L, J.EAR_R, J.EYE_L, J.EYE_R])
      put(t, j, vec(t, j).sub(centre).applyQuaternion(head).add(centre));
    for (let j = 0; j < JOINT_COUNT; j++) put(t, j, vec(t, j).applyQuaternion(torso));
    solver.update(t, 0, 0);
    const actual = posedRotations(rig, solver.state.local)[idx('head')]!;
    const expected = torso.clone().multiply(head).multiply(rig.bones[idx('head')]!.worldQuat);
    expect(quatAngle(actual.clone().invert().multiply(expected))).toBeLessThan(1e-3);
  });

  it('turns the head toward the tracked nose and limits extreme rotations', () => {
    const solver = new AvatarSolver(rig),
      t = restTargets(rig, createTargets());
    // Rotate face points 30° about +Y around the ear midpoint.
    const centre = vec(t, J.EAR_L).add(vec(t, J.EAR_R)).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 6);
    for (const j of [J.NOSE, J.EAR_L, J.EAR_R, J.EYE_L, J.EYE_R])
      put(t, j, vec(t, j).sub(centre).applyQuaternion(q).add(centre));
    solver.update(t, 0, 0);
    const world = posedRotations(rig, solver.state.local)[idx('head')]!;
    const delta = world.clone().multiply(rig.bones[idx('head')]!.worldQuat.clone().invert());
    expect((quatAngle(delta) * 180) / Math.PI).toBeCloseTo(30, 0);
    for (const j of [J.NOSE, J.EAR_L, J.EAR_R])
      put(t, j, vec(t, j).sub(centre).applyQuaternion(q).applyQuaternion(q).applyQuaternion(q).add(centre));
    solver.update(t, 0, 0);
    const limited = posedRotations(rig, solver.state.local)[idx('head')]!;
    const deltaLimited = limited.clone().multiply(rig.bones[idx('head')]!.worldQuat.clone().invert());
    expect((quatAngle(deltaLimited) * 180) / Math.PI).toBeLessThanOrEqual(70.5);
  });
});

describe('tracking adapters', () => {
  function pose(raise: 'left' | 'right' | null, depth = false) {
    const lm = new Float32Array(132),
      world = new Float32Array(99);
    const set = (i: number, x: number, y: number) => {
      lm[i * 4] = x;
      lm[i * 4 + 1] = y;
      lm[i * 4 + 3] = 1;
      world[i * 3] = (x - 0.5) * 1.6;
      world[i * 3 + 1] = (y - 0.75) * 0.9;
      world[i * 3 + 2] = depth ? -0.2 : 0;
    };
    // Mirrored image: the player's left shoulder (11) appears on the viewer's left.
    set(0, 0.5, 0.2);
    set(2, 0.48, 0.18);
    set(5, 0.52, 0.18);
    set(7, 0.46, 0.2);
    set(8, 0.54, 0.2);
    set(11, 0.4, 0.4);
    set(12, 0.6, 0.4);
    set(13, raise === 'left' ? 0.28 : 0.38, raise === 'left' ? 0.4 : 0.55);
    set(14, raise === 'right' ? 0.72 : 0.62, raise === 'right' ? 0.4 : 0.55);
    set(15, raise === 'left' ? 0.16 : 0.38, raise === 'left' ? 0.4 : 0.68);
    set(16, raise === 'right' ? 0.84 : 0.62, raise === 'right' ? 0.4 : 0.68);
    set(23, 0.44, 0.75);
    set(24, 0.56, 0.75);
    // Hips must be visible; legs are absent (indices 25..32 zero).
    return { landmarks: lm, worldLandmarks: world };
  }
  it('mirrors the player: their raised left arm drives the avatar right side on the viewer left', () => {
    const t = createTargets();
    expect(targetsFromTracking(pose('left'), [], t, rig, { mirror: true })).toBe(true);
    expect(vec(t, J.WRIST_R).x).toBeLessThan(vec(t, J.SHOULDER_R).x - 0.3);
    expect(vec(t, J.SHOULDER_R).x).toBeLessThan(vec(t, J.SHOULDER_L).x);
    const direct = createTargets();
    targetsFromTracking(pose('left'), [], direct, rig, { mirror: false });
    expect(vec(direct, J.WRIST_L).x).toBeCloseTo(vec(t, J.WRIST_R).x, 6);
  });
  it('routes player handedness to the mirrored avatar hand', () => {
    const t = createTargets();
    const hand = {
      handedness: 'left' as const,
      score: 1,
      landmarks: new Float32Array(63).fill(0.3),
      worldLandmarks: new Float32Array(63).map((_, i) => (i % 3 === 1 ? -i * 0.001 : i * 0.0005)),
    };
    targetsFromTracking(pose(null), [hand], t, rig, { mirror: true });
    expect(t.hands[1]).not.toBeNull();
    expect(t.hands[0]).toBeNull();
    // World y-down becomes game y-up.
    expect(t.hands[1]![4]).toBeCloseTo(0.004, 6);
  });
  it('estimates forward depth from foreshortened limbs for 2D-only (dataset) poses', () => {
    const p = pose(null);
    p.worldLandmarks.fill(0);
    // Shorten the left forearm on screen: it must point toward the camera.
    p.landmarks[15 * 4] = 0.385;
    p.landmarks[15 * 4 + 1] = 0.58;
    const t = createTargets();
    expect(targetsFromTracking(p, [], t, rig)).toBe(true);
    for (let i = 0; i < t.joints.length; i++) expect(Number.isFinite(t.joints[i]!)).toBe(true);
    expect(vec(t, J.WRIST_R).z).toBeGreaterThan(vec(t, J.ELBOW_R).z + 0.1);
    expect(vec(t, J.SHOULDER_R).z).toBeCloseTo(0, 6);
  });
  it('keeps each joint on the camera ray through its play-plane point', () => {
    const t = createTargets();
    targetsFromTracking(pose('right', true), [], t, rig);
    const nose = vec(t, J.NOSE);
    expect(Number.isFinite(nose.z)).toBe(true);
    const cam = new THREE.Vector3(0, 1.75, 4.6);
    const planeHit = cam.clone().add(
      nose
        .clone()
        .sub(cam)
        .multiplyScalar(cam.z / (cam.z - nose.z)),
    );
    expect(planeHit.x).toBeCloseTo(0, 6);
    expect(planeHit.y).toBeCloseTo(1.5 + (0.5 - 0.2) * 3, 5);
  });
  it('rejects input without both shoulders and never reads leg indices', () => {
    const p = pose(null);
    p.landmarks[11 * 4 + 3] = 0;
    expect(targetsFromTracking(p, [], createTargets(), rig)).toBe(false);
    const q = pose(null);
    for (let i = 25; i < 33; i++) q.landmarks.set([Number.NaN, Number.NaN, Number.NaN, 1], i * 4);
    const t = createTargets();
    expect(targetsFromTracking(q, [], t, rig)).toBe(true);
    expect(Array.from(t.joints).every(Number.isFinite)).toBe(true);
  });
  it('poses from explicit performer joints without mirroring by default', () => {
    const joints = new Float32Array(75).fill(Number.NaN);
    const n = createTargets();
    neutralTargets(rig, n);
    // Subject-left (MediaPipe 11/13/15) on +X, as for a person facing the viewer.
    const map: [number, number][] = [
      [11, J.SHOULDER_L],
      [12, J.SHOULDER_R],
      [13, J.ELBOW_L],
      [14, J.ELBOW_R],
      [15, J.WRIST_L],
      [16, J.WRIST_R],
      [23, J.HIP_L],
      [24, J.HIP_R],
      [0, J.NOSE],
      [7, J.EAR_L],
      [8, J.EAR_R],
    ];
    for (const [mp, j] of map) vec(n, j).toArray(joints, mp * 3);
    const t = targetsFromJoints({ pose: joints }, createTargets());
    expect(vec(t, J.WRIST_L).distanceTo(vec(n, J.WRIST_L))).toBeLessThan(1e-6);
    expect(t.valid[J.INDEX_L]).toBe(0);
    const solver = new AvatarSolver(rig);
    expect(solver.update(t, 0, 0)).toBe(true);
  });
  it('idle motion stays bounded and is static at a fixed time (Calm)', () => {
    const a = idleTargets(rig, createTargets(), 0),
      b = idleTargets(rig, createTargets(), 0);
    expect(Array.from(a.joints)).toEqual(Array.from(b.joints));
    const n = neutralTargets(rig, createTargets());
    for (let s = 0; s < 30; s += 0.7) {
      const t = idleTargets(rig, createTargets(), s);
      for (let j = 0; j < JOINT_COUNT; j++) expect(vec(t, j).distanceTo(vec(n, j))).toBeLessThan(0.03);
    }
  });
});

function restLocal(i: number): Float32Array {
  return new Float32Array(rig.bones[i]!.localQuat.toArray());
}
/** 21 MediaPipe-topology hand points (game axes) from a solved pose of one avatar hand. */
function handLandmarks(local: Float32Array, side: 'L' | 'R', pointIndex: boolean): Float32Array {
  const use = new Float32Array(local);
  if (pointIndex)
    for (let s = 1; s <= 3; s++)
      use.set(restLocal(idx(`index_0${s}.${side}`)), idx(`index_0${s}.${side}`) * 4);
  const p = posedPositions(rig, use),
    q = posedRotations(rig, use);
  const out = new Float32Array(63);
  const write = (i: number, v: THREE.Vector3) => v.toArray(out, i * 3);
  write(0, p[idx(`hand.${side}`)]!);
  const chains = { thumb: 1, index: 5, middle: 9, ring: 13, pinky: 17 } as const;
  for (const f of FINGERS) {
    const base = chains[f];
    for (let s = 1; s <= 3; s++) write(base + s - 1, p[idx(`${f}_0${s}.${side}`)]!);
    const last = idx(`${f}_03.${side}`);
    const length = p[last]!.distanceTo(p[idx(`${f}_02.${side}`)]!) * 0.85;
    write(base + 3, p[last]!.clone().add(new THREE.Vector3(0, length, 0).applyQuaternion(q[last]!)));
  }
  return out;
}
