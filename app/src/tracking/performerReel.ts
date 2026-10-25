/**
 * Sign Saber — tracking/performerReel.ts
 *
 * Responsibility: a dataset-camera reel that RENDERS the skinned avatar (natural skin/fabric material, plain
 * room) from a front virtual camera, posed every frame from the chart choreography on the session song clock.
 * MediaPipe then has to find the rendered person through the unchanged live camera path.
 * Spec: docs/05-tracking-pipeline.md §1.3; docs/17-testing-and-qa.md §Synthetic performer
 * Inputs: current BeatmapV1, ReelClock (heard song time), avatar.glb
 * Outputs: one 16:9 frame per paint plus the planned joint positions as evaluation truth
 *
 * Synthetic: a rendered avatar is not a person, a webcam or live evidence. Lane `dataset-camera-synthetic-performer`.
 * The truth is the choreography's planned image joints; the rendered rig differs in proportions and solver limits.
 */
import * as THREE from 'three';
import type { BeatmapV1 } from '../beatmap/types';
import type { Vec2 } from '../core/types';
import {
  PERFORMER_REEL_CAMERA_DISTANCE_M,
  PERFORMER_REEL_IDLE_SONG_MS,
  PERFORMER_REEL_RENDER_H,
  PERFORMER_REEL_RENDER_W,
  PERFORMER_REEL_TRUTH_POOL,
  PERFORMER_SHOULDER_WIDTH_NORM,
} from '../core/constants';
import { Choreography, type PerformerFrame } from '../performer/choreography';
import { createPerformerJoints, performerJoints, type PerformerJoints } from '../performer/synthesize';
import { AvatarFigure, loadAvatarAsset } from '../render/avatar';
import { J } from '../render/avatarRetarget';
import type { DatasetReel, ReelClock } from './datasetCamera';
import { REEL_JOINTS, type ReelKeypoint, type ReelTruth } from './datasetCameraEval';

export const PERFORMER_REEL_LANE = 'dataset-camera-synthetic-performer';
const ASPECT = 9 / 16;
/** MediaPipe pose indices 0..24 → PerformerJoints fields (anatomical names). */
const POSE_FIELDS: readonly (keyof PerformerJoints | null)[] = [
  'nose',
  null,
  'leftEye',
  null,
  null,
  'rightEye',
  null,
  'leftEar',
  'rightEar',
  'mouthLeft',
  'mouthRight',
  'leftShoulder',
  'rightShoulder',
  'leftElbow',
  'rightElbow',
  'leftWrist',
  'rightWrist',
  null,
  null,
  null,
  null,
  null,
  null,
  'leftHip',
  'rightHip',
];

interface MutableTruth extends ReelTruth {
  id: string;
  keypoints: { name: ReelKeypoint['name']; x: number; y: number; v: 0 | 1 | 2 }[];
}

/** Pure mapping from mirrored performer image joints to raw (unmirrored) model-space metres. */
export function imageToModel(p: Vec2, frameWidthM: number, out: THREE.Vector3, z = 0): THREE.Vector3 {
  return out.set((1 - p.x - 0.5) * frameWidthM, (0.5 - p.y) * frameWidthM * ASPECT, z);
}
/** Forward depth of a limb end from 2D foreshortening against a rest length (≥ 0). */
export function foreshortenedDepth(from: THREE.Vector3, to: THREE.Vector3, restLength: number): number {
  const planar = Math.hypot(to.x - from.x, to.y - from.y);
  return Math.sqrt(Math.max(0, restLength * restLength - planar * planar));
}

export class PerformerReel implements DatasetReel {
  readonly kind = 'synthetic-performer';
  readonly lane = PERFORMER_REEL_LANE;
  /** Continuous motion: attribute each capture to the latest painted pose. */
  readonly transitionGuardMs = 0;
  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera | null = null;
  private figure: AvatarFigure | null = null;
  private choreography: Choreography | null = null;
  private choreographyMap: BeatmapV1 | null = null;
  private readonly frame: PerformerFrame = Choreography.frame();
  private readonly joints = createPerformerJoints();
  private readonly pose = new Float32Array(25 * 3);
  private readonly leftHand = new Float32Array(63);
  private readonly rightHand = new Float32Array(63);
  private readonly v = Array.from({ length: 4 }, () => new THREE.Vector3());
  private frameWidthM = 1;
  private upperArmM = 0.29;
  private forearmM = 0.26;
  /** Face points sit in front of the ears by the rig's own proportions (keeps the head upright). */
  private noseZ = 0.1;
  private eyeZ = 0.08;
  private readonly truths: MutableTruth[] = Array.from({ length: PERFORMER_REEL_TRUTH_POOL }, () => ({
    id: '',
    role: 'performer',
    keypoints: REEL_JOINTS.map(([name]) => ({ name, x: 0, y: 0, v: 2 as const })),
  }));
  private truthIndex = 0;
  readonly counters = { rendered: 0, poseFailures: 0, idleFrames: 0, songFrames: 0 };
  private disposed = false;

  constructor(private readonly map: () => BeatmapV1 | null) {}

  async prepare(signal: AbortSignal): Promise<void> {
    const asset = await loadAvatarAsset(signal);
    if (signal.aborted || this.disposed) throw new Error('Dataset camera setup cancelled.');
    const figure = new AvatarFigure(asset, { outline: false });
    figure.setVariant('natural');
    figure.root.traverse((object) => object.layers.set(0));
    const a = asset.rig.anchors;
    const restShoulder = a[J.SHOULDER_L]!.distanceTo(a[J.SHOULDER_R]!);
    this.upperArmM =
      (a[J.SHOULDER_L]!.distanceTo(a[J.ELBOW_L]!) + a[J.SHOULDER_R]!.distanceTo(a[J.ELBOW_R]!)) / 2;
    this.forearmM = (a[J.ELBOW_L]!.distanceTo(a[J.WRIST_L]!) + a[J.ELBOW_R]!.distanceTo(a[J.WRIST_R]!)) / 2;
    const earZ = (a[J.EAR_L]!.z + a[J.EAR_R]!.z) / 2;
    this.noseZ = a[J.NOSE]!.z - earZ;
    this.eyeZ = (a[J.EYE_L]!.z + a[J.EYE_R]!.z) / 2 - earZ;
    // Frame the rig like the performer geometry: shoulder width = PERFORMER_SHOULDER_WIDTH_NORM of the width.
    this.frameWidthM = restShoulder / PERFORMER_SHOULDER_WIDTH_NORM;
    const canvas = document.createElement('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1);
    renderer.setSize(PERFORMER_REEL_RENDER_W, PERFORMER_REEL_RENDER_H, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer = renderer;
    const heightM = this.frameWidthM * ASPECT;
    const distance = PERFORMER_REEL_CAMERA_DISTANCE_M;
    const camera = new THREE.PerspectiveCamera(
      THREE.MathUtils.radToDeg(2 * Math.atan(heightM / 2 / distance)),
      16 / 9,
      0.1,
      20,
    );
    camera.position.set(0, 0, distance);
    camera.lookAt(0, 0, 0);
    this.camera = camera;
    // A plain room: warm grey wall behind, lighter floor, soft key/fill lighting.
    this.scene.background = new THREE.Color(0xb9b3aa);
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 10),
      new THREE.MeshStandardMaterial({ color: 0xc8c1b6, roughness: 0.95 }),
    );
    wall.position.set(0, 0, -1.6);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 10),
      new THREE.MeshStandardMaterial({ color: 0x8a8278, roughness: 0.9 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -heightM * 0.5 - 0.9, 0);
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(0.8, 1.6, 2.5);
    const fill = new THREE.DirectionalLight(0xffffff, 0.8);
    fill.position.set(-1.5, 0.5, 2);
    this.scene.add(wall, floor, key, fill, new THREE.HemisphereLight(0xffffff, 0x8a8278, 1.1), figure.root);
    this.figure = figure;
  }

  render(ctx: CanvasRenderingContext2D, width: number, height: number, clock: ReelClock): ReelTruth | null {
    if (!this.renderer || !this.camera || !this.figure)
      throw new Error('Synthetic performer is not prepared.');
    const map = this.map();
    if (map !== this.choreographyMap) {
      this.choreographyMap = map;
      this.choreography = map ? new Choreography(map) : null;
    }
    const song = clock.songTimeMs;
    const active = song !== null && Number.isFinite(song) && !!this.choreography;
    // Outside a session the performer stands at its rest pose (as before its first stroke).
    if (this.choreography) this.choreography.sample(active ? song! : PERFORMER_REEL_IDLE_SONG_MS, this.frame);
    else Object.assign(this.frame, Choreography.frame());
    if (active) this.counters.songFrames++;
    else this.counters.idleFrames++;
    performerJoints(this.frame, this.joints);
    this.writePose();
    if (
      !this.figure.poseFromJoints({ pose: this.pose, hands: { left: this.leftHand, right: this.rightHand } })
    )
      this.counters.poseFailures++;
    this.renderer.render(this.scene, this.camera);
    ctx.drawImage(this.renderer.domElement, 0, 0, width, height);
    this.counters.rendered++;
    return this.truth(active ? `performer-${Math.floor(song! / 1000)}s` : 'performer-idle');
  }

  /** Mirrored performer image joints → raw model-space metres; arm depth from rig limb foreshortening. */
  private writePose(): void {
    const j = this.joints,
      [a, b, c, d] = this.v as [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];
    this.pose.fill(Number.NaN);
    POSE_FIELDS.forEach((field, i) => {
      if (!field) return;
      imageToModel(j[field] as Vec2, this.frameWidthM, a);
      this.pose[i * 3] = a.x;
      this.pose[i * 3 + 1] = a.y;
      this.pose[i * 3 + 2] = i === 0 || i === 9 || i === 10 ? this.noseZ : i === 2 || i === 5 ? this.eyeZ : 0;
    });
    for (const [shoulder, elbow, wrist, hand, field] of [
      [11, 13, 15, this.leftHand, 'leftHand'],
      [12, 14, 16, this.rightHand, 'rightHand'],
    ] as const) {
      a.fromArray(this.pose, shoulder * 3);
      b.fromArray(this.pose, elbow * 3);
      c.fromArray(this.pose, wrist * 3);
      const elbowZ = foreshortenedDepth(a, b, this.upperArmM);
      const wristZ = elbowZ + foreshortenedDepth(b, c, this.forearmM);
      this.pose[elbow * 3 + 2] = elbowZ;
      this.pose[wrist * 3 + 2] = wristZ;
      const image = j[field];
      for (let k = 0; k < 21; k++) {
        d.set(image[k * 3]!, image[k * 3 + 1]!, 0);
        imageToModel(d, this.frameWidthM, a, wristZ - image[k * 3 + 2]! * this.frameWidthM);
        hand[k * 3] = a.x;
        hand[k * 3 + 1] = a.y;
        hand[k * 3 + 2] = a.z;
      }
    }
  }

  private truth(id: string): ReelTruth {
    const truth = this.truths[this.truthIndex]!;
    this.truthIndex = (this.truthIndex + 1) % this.truths.length;
    truth.id = id;
    REEL_JOINTS.forEach(([name], k) => {
      const field = POSE_FIELDS[REEL_JOINTS[k]![1]]!;
      const p = this.joints[field] as Vec2;
      const point = truth.keypoints[k]!;
      point.name = name;
      point.x = Math.min(1, Math.max(0, 1 - p.x));
      point.y = Math.min(1, Math.max(0, p.y));
      point.v = 2;
    });
    return truth;
  }

  describe(): Record<string, unknown> {
    return {
      kind: this.kind,
      lane: this.lane,
      synthetic: true,
      material: 'avatar natural (skin/fabric PBR)',
      background: 'plain room: warm grey wall and floor',
      render: { width: PERFORMER_REEL_RENDER_W, height: PERFORMER_REEL_RENDER_H },
      framing: {
        shoulderWidthNorm: PERFORMER_SHOULDER_WIDTH_NORM,
        frameWidthM: this.frameWidthM,
        cameraDistanceM: PERFORMER_REEL_CAMERA_DISTANCE_M,
      },
      unplayableNotes: this.choreography?.plan.unplayable.length ?? null,
      counters: { ...this.counters },
      truth: 'Planned choreography image joints; the rendered rig differs in proportions and solver limits.',
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.figure?.dispose();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const material = object.material as THREE.Material | THREE.Material[];
        for (const m of Array.isArray(material) ? material : [material]) m.dispose();
      }
    });
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = null;
    this.figure = null;
  }
}
