/**
 * Sign Saber — render/avatar.ts
 *
 * Responsibility: load the authored skinned upper-body avatar, shade it (holographic or natural PBR),
 * place it on the play plane and drive it from tracked, dataset, idle or explicit joint targets.
 * Spec: docs/10-rendering-silhouette.md §Avatar; docs/18-blender-mcp-asset-pipeline.md §Avatar
 * Inputs: TrackingFrame (pose + hands), explicit AvatarJointInput, BandEnergies/kick for the glow
 * Outputs: an Object3D on AVATAR_LAYER; presentation only (never scoring or tracking evidence)
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { TrackingFrame } from '../core/types';
import {
  AVATAR_ACCENT_COLOR,
  AVATAR_ACCENT_GAIN,
  AVATAR_AUDIO_GAIN,
  AVATAR_FILL_COLOR,
  AVATAR_OUTLINE_M,
  AVATAR_PLACEHOLDER_HIP_Y,
  AVATAR_PLACEHOLDER_SCALE,
  AVATAR_RIM_COLOR_A,
  AVATAR_RIM_COLOR_B,
  AVATAR_RIM_GAIN,
  AVATAR_RIM_POWER,
  AVATAR_ROOT_SMOOTH_MS,
  AVATAR_SCALE_SMOOTH_MS,
  AVATAR_URL,
  KICK_DECAY_MS,
} from '../core/constants';
import { validateLocalGlb } from './assets';
import {
  AVATAR_BONE_NAMES,
  AvatarSolver,
  J,
  createRig,
  createTargets,
  idleTargets,
  targetsFromJoints,
  targetsFromTracking,
} from './avatarRetarget';
import type { AvatarJointInput, AvatarRig, AvatarTargets, RigBoneInput } from './avatarRetarget';

/** Render layer used for the avatar backdrop pass (drawn before gameplay; never occludes targets). */
export const AVATAR_LAYER = 2;
export type AvatarVariant = 'holo' | 'natural';
export type AvatarSlot = 'suit' | 'skin' | 'accent' | 'eye' | 'hair';
const SLOTS: readonly AvatarSlot[] = ['suit', 'skin', 'accent', 'eye', 'hair'];

export interface AvatarAsset {
  readonly scene: THREE.Group;
  readonly rig: AvatarRig;
  /** Bones in rig order. */
  readonly bones: readonly THREE.Bone[];
  readonly meshes: readonly THREE.SkinnedMesh[];
}

/** Build the rig description from a loaded glTF scene (no WebGL needed). */
export function avatarFromScene(scene: THREE.Group): AvatarAsset {
  const rigNode = scene.getObjectByName('avatar_rig');
  if (!rigNode) throw new Error('Avatar model is missing avatar_rig.');
  const anchors = (rigNode.userData as { sign_saber_anchors?: Record<string, number[]> }).sign_saber_anchors;
  if (!anchors) throw new Error('Avatar model is missing landmark anchors.');
  const byName = new Map<string, THREE.Bone>();
  scene.traverse((object) => {
    if (object instanceof THREE.Bone) byName.set(object.name, object);
  });
  const sanitized = (name: string) => THREE.PropertyBinding.sanitizeNodeName(name);
  const bones: THREE.Bone[] = [];
  const inputs: RigBoneInput[] = [];
  const authored = new Map<THREE.Object3D, string>();
  // Parent-first order: hips, then the authored list (which is parent-first by construction).
  for (const name of AVATAR_BONE_NAMES) {
    const bone = byName.get(sanitized(name));
    if (!bone) throw new Error(`Avatar model is missing bone ${name}.`);
    authored.set(bone, name);
    bones.push(bone);
  }
  for (const bone of bones) {
    const parentName = bone.parent ? (authored.get(bone.parent) ?? null) : null;
    inputs.push({
      name: authored.get(bone)!,
      parent: parentName,
      position: [bone.position.x, bone.position.y, bone.position.z],
      quaternion: [bone.quaternion.x, bone.quaternion.y, bone.quaternion.z, bone.quaternion.w],
    });
  }
  const meshes: THREE.SkinnedMesh[] = [];
  scene.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) meshes.push(object);
  });
  if (!meshes.length) throw new Error('Avatar model has no skinned mesh.');
  if (
    !rigNode.position.equals(new THREE.Vector3()) ||
    rigNode.quaternion.angleTo(new THREE.Quaternion()) > 1e-6
  )
    throw new Error('Avatar armature must sit at the model origin.');
  return { scene, rig: createRig(inputs, anchors), bones, meshes };
}

export async function loadAvatarAsset(signal?: AbortSignal): Promise<AvatarAsset> {
  const response = await fetch(AVATAR_URL, signal ? { signal } : {});
  if (!response.ok) throw new Error(`Local avatar model unavailable (${response.status}).`);
  const bytes = await response.arrayBuffer();
  validateLocalGlb(bytes);
  const gltf = await new GLTFLoader().parseAsync(bytes, '/assets/models/');
  return avatarFromScene(gltf.scene);
}

// ---------------------------------------------------------------------------------------------
// Materials.
const VERTEX = /* glsl */ `
#include <common>
#include <color_pars_vertex>
#include <skinning_pars_vertex>
uniform float uOutline;
varying vec3 vNormalV;
varying vec3 vViewPos;
varying vec3 vRestPos;
void main() {
  #include <color_vertex>
  #include <skinbase_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  transformed += normalize(objectNormal) * uOutline;
  vRestPos = position;
  vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
  vNormalV = normalize(transformedNormal);
  vViewPos = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
const FRAGMENT = /* glsl */ `
#include <common>
#include <color_pars_fragment>
uniform vec3 uFill;
uniform vec3 uRimA;
uniform vec3 uRimB;
uniform vec3 uAccent;
uniform float uRimPower;
uniform float uRimGain;
uniform float uGlow;
uniform float uEnergy;
uniform float uKick;
uniform float uTime;
uniform float uScan;
uniform float uDetail;
uniform float uOutlinePass;
varying vec3 vNormalV;
varying vec3 vViewPos;
varying vec3 vRestPos;
void main() {
  vec3 n = normalize(vNormalV);
  vec3 v = normalize(vViewPos);
  if (uOutlinePass > 0.5) n = -n;
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float fres = pow(1.0 - ndv, uRimPower);
  float g = clamp(vRestPos.y * 1.05 + 0.08 + n.x * 0.18, 0.0, 1.0);
  vec3 rim = mix(uRimB, uRimA, g);
  float pulse = 1.0 + uEnergy + uKick * 0.8;
  if (uOutlinePass > 0.5) {
    gl_FragColor = vec4(rim * (0.55 + 0.45 * pulse) * (0.35 + fres), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    return;
  }
  vec3 detail = vec3(1.0);
  #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
    detail = mix(vec3(1.0), vColor.rgb, uDetail);
  #endif
  vec3 key = normalize(vec3(-0.35, 0.55, 0.76));
  float diffuse = 0.32 + 0.68 * max(dot(n, key), 0.0);
  float spec = pow(max(dot(n, normalize(key + v)), 0.0), 48.0);
  float scan = 0.5 + 0.5 * sin((vRestPos.y * 160.0 - uTime * 1.6) * 3.14159);
  vec3 col = uFill * detail * diffuse;
  col += rim * (fres * uRimGain * pulse + spec * 0.35);
  col += rim * uScan * scan * (0.25 + fres);
  col += uAccent * uGlow * pulse;
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

interface SlotLook {
  fill: number;
  rimGain: number;
  glow: number;
  detail: number;
  scan: number;
}
const HOLO_LOOK: Record<AvatarSlot, SlotLook> = {
  suit: { fill: AVATAR_FILL_COLOR, rimGain: AVATAR_RIM_GAIN, glow: 0, detail: 0, scan: 0.035 },
  skin: { fill: 0x2c3a52, rimGain: AVATAR_RIM_GAIN * 0.8, glow: 0, detail: 0.85, scan: 0.02 },
  accent: { fill: AVATAR_ACCENT_COLOR, rimGain: 0.4, glow: AVATAR_ACCENT_GAIN, detail: 0, scan: 0 },
  eye: { fill: 0xbfeaff, rimGain: 0.3, glow: 0.35, detail: 1, scan: 0 },
  hair: { fill: 0x0b1020, rimGain: AVATAR_RIM_GAIN * 0.9, glow: 0, detail: 0, scan: 0.02 },
};

export interface AvatarShared {
  readonly uEnergy: { value: number };
  readonly uKick: { value: number };
  readonly uTime: { value: number };
  readonly uScanGain: { value: number };
}

function holoMaterial(slot: AvatarSlot, shared: AvatarShared, outline: boolean): THREE.ShaderMaterial {
  const look = HOLO_LOOK[slot];
  return new THREE.ShaderMaterial({
    name: `avatar_holo_${slot}${outline ? '_outline' : ''}`,
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    vertexColors: slot === 'skin' || slot === 'eye',
    side: outline ? THREE.BackSide : THREE.FrontSide,
    transparent: outline,
    blending: outline ? THREE.AdditiveBlending : THREE.NormalBlending,
    depthWrite: !outline,
    uniforms: {
      uFill: { value: new THREE.Color(look.fill) },
      uRimA: { value: new THREE.Color(AVATAR_RIM_COLOR_A) },
      uRimB: { value: new THREE.Color(AVATAR_RIM_COLOR_B) },
      uAccent: { value: new THREE.Color(AVATAR_ACCENT_COLOR) },
      uRimPower: { value: AVATAR_RIM_POWER },
      uRimGain: { value: look.rimGain },
      uGlow: { value: look.glow },
      uDetail: { value: look.detail },
      uScan: { value: look.scan },
      uOutline: { value: outline ? AVATAR_OUTLINE_M : 0 },
      uOutlinePass: { value: outline ? 1 : 0 },
      uEnergy: shared.uEnergy,
      uKick: shared.uKick,
      uTime: shared.uTime,
    },
  });
}

function slotOf(material: THREE.Material): AvatarSlot {
  const slot = material.name.replace(/^avatar_/, '') as AvatarSlot;
  if (!SLOTS.includes(slot)) throw new Error(`Unexpected avatar material ${material.name}.`);
  return slot;
}

/** Natural PBR look (skin/fabric) from the authored base colours, for virtual-camera rendering. */
function naturalMaterial(source: THREE.Material, slot: AvatarSlot): THREE.MeshStandardMaterial {
  const base = source instanceof THREE.MeshStandardMaterial ? source : new THREE.MeshStandardMaterial();
  const material = base.clone();
  material.name = `avatar_natural_${slot}`;
  material.metalness = 0;
  material.vertexColors = slot === 'skin' || slot === 'eye';
  material.roughness = { suit: 0.8, skin: 0.55, accent: 0.35, eye: 0.15, hair: 0.75 }[slot];
  if (slot === 'accent') {
    material.emissive.setHex(AVATAR_ACCENT_COLOR);
    material.emissiveIntensity = 0.6;
  }
  return material;
}

// ---------------------------------------------------------------------------------------------
export interface AvatarSnapshot {
  readonly local: Float32Array;
  readonly stretch: Float32Array;
  readonly position: THREE.Vector3;
  scale: number;
  valid: boolean;
}

/** One avatar instance: owns its materials, outline hull, solver and placement. */
export class AvatarFigure {
  readonly root = new THREE.Group();
  readonly solver: AvatarSolver;
  readonly shared: AvatarShared = {
    uEnergy: { value: 0 },
    uKick: { value: 0 },
    uTime: { value: 0 },
    uScanGain: { value: 1 },
  };
  private readonly holo = new Map<THREE.SkinnedMesh, THREE.ShaderMaterial>();
  private readonly natural = new Map<THREE.SkinnedMesh, THREE.MeshStandardMaterial>();
  private readonly outlines: THREE.SkinnedMesh[] = [];
  private readonly sources = new Set<THREE.Material>();
  private readonly targets: AvatarTargets = createTargets();
  private readonly fitted: AvatarTargets = createTargets();
  private readonly position = new THREE.Vector3();
  private readonly wantPosition = new THREE.Vector3();
  private readonly shoulderMid = new THREE.Vector3();
  private readonly restShoulder: number;
  private readonly restTorso: number;
  private scale = 0;
  private hasTargets = false;
  private kickAt = -Infinity;
  private variantName: AvatarVariant = 'holo';

  constructor(
    readonly asset: AvatarAsset,
    options: { outline?: boolean } = {},
  ) {
    this.solver = new AvatarSolver(asset.rig);
    const a = asset.rig.anchors;
    this.restShoulder = a[J.SHOULDER_L]!.distanceTo(a[J.SHOULDER_R]!);
    this.restTorso = new THREE.Vector3()
      .addVectors(a[J.SHOULDER_L]!, a[J.SHOULDER_R]!)
      .sub(new THREE.Vector3().addVectors(a[J.HIP_L]!, a[J.HIP_R]!))
      .multiplyScalar(0.5)
      .length();
    this.root.name = 'player_avatar';
    this.root.add(asset.scene);
    for (const mesh of asset.meshes) {
      const source = mesh.material as THREE.Material;
      this.sources.add(source);
      const slot = slotOf(source);
      this.holo.set(mesh, holoMaterial(slot, this.shared, false));
      this.natural.set(mesh, naturalMaterial(source, slot));
      mesh.material = this.holo.get(mesh)!;
      mesh.frustumCulled = false;
      if (options.outline !== false && slot !== 'eye' && slot !== 'accent') {
        const hull = new THREE.SkinnedMesh(mesh.geometry, holoMaterial(slot, this.shared, true));
        hull.name = `${mesh.name}_outline`;
        hull.frustumCulled = false;
        hull.renderOrder = -1;
        mesh.parent!.add(hull);
        hull.bind(mesh.skeleton, mesh.bindMatrix);
        this.outlines.push(hull);
      }
    }
    this.root.traverse((object) => object.layers.set(AVATAR_LAYER));
    this.applyPose();
  }

  get variant(): AvatarVariant {
    return this.variantName;
  }
  /** 'holo' for the arena; 'natural' skin/fabric PBR for a virtual camera that a pose model should read. */
  setVariant(variant: AvatarVariant): void {
    this.variantName = variant;
    for (const [mesh, material] of variant === 'holo' ? this.holo : this.natural) mesh.material = material;
    for (const hull of this.outlines) hull.visible = variant === 'holo';
  }
  setOutline(enabled: boolean): void {
    for (const hull of this.outlines) hull.visible = enabled && this.variantName === 'holo';
  }

  /** Music response hook: smoothed band energies (0..1) and kick events. */
  setAudio(energy: number, nowMs: number, calm: boolean): void {
    this.shared.uEnergy.value = calm ? 0 : Math.max(0, Math.min(1, energy)) * AVATAR_AUDIO_GAIN;
    const kickAge = nowMs - this.kickAt;
    this.shared.uKick.value = calm || kickAge < 0 ? 0 : Math.max(0, 1 - kickAge / KICK_DECAY_MS);
    this.shared.uTime.value = calm ? 0 : nowMs / 1000;
  }
  kick(nowMs: number): void {
    this.kickAt = nowMs;
  }

  /** Store play-space targets from a tracking frame; returns false without a usable torso. */
  track(frame: TrackingFrame): boolean {
    this.hasTargets =
      !!frame.pose && targetsFromTracking(frame.pose, frame.hands, this.targets, this.asset.rig);
    return this.hasTargets;
  }
  clearTracking(): void {
    this.hasTargets = false;
  }
  get tracked(): boolean {
    return this.hasTargets;
  }

  /** Solve and place from the latest tracked targets (play-space world metres). */
  updateTracked(nowMs: number, dtMs: number): boolean {
    if (!this.hasTargets) return false;
    const t = this.targets,
      f = this.fitted;
    const ls = scratchL.fromArray(t.joints, J.SHOULDER_L * 3),
      rs = scratchR.fromArray(t.joints, J.SHOULDER_R * 3);
    this.shoulderMid.addVectors(ls, rs).multiplyScalar(0.5);
    let wanted = ls.distanceTo(rs) / this.restShoulder;
    if (t.valid[J.HIP_L] && t.valid[J.HIP_R]) {
      const hips = scratchL
        .fromArray(t.joints, J.HIP_L * 3)
        .add(scratchR.fromArray(t.joints, J.HIP_R * 3))
        .multiplyScalar(0.5);
      wanted = Math.max(wanted, (0.9 * this.shoulderMid.distanceTo(hips)) / this.restTorso);
    }
    if (!Number.isFinite(wanted) || wanted <= 0) return false;
    this.scale = this.scale > 0 ? ease(this.scale, wanted, dtMs, AVATAR_SCALE_SMOOTH_MS) : wanted;
    for (let i = 0; i < t.joints.length; i++) f.joints[i] = t.joints[i]! / this.scale;
    f.valid.set(t.valid);
    f.hands[0] = t.hands[0];
    f.hands[1] = t.hands[1];
    f.curl[0] = t.curl[0];
    f.curl[1] = t.curl[1];
    if (!this.solver.update(f, nowMs, dtMs)) return false;
    this.wantPosition.copy(this.solver.state.anchor).multiplyScalar(-this.scale).add(this.shoulderMid);
    this.placeEased(dtMs);
    this.applyPose();
    return true;
  }

  /** Illustrative idle at the menu placeholder position. Calm passes a fixed time for a static pose. */
  updateIdle(tSec: number, nowMs: number, dtMs: number): void {
    idleTargets(this.asset.rig, this.fitted, tSec);
    this.solver.update(this.fitted, nowMs, dtMs);
    this.scale = AVATAR_PLACEHOLDER_SCALE;
    this.wantPosition.set(0, AVATAR_PLACEHOLDER_HIP_Y, 0);
    this.position.copy(this.wantPosition);
    this.applyPose();
  }

  /**
   * Performer API: pose from explicit joints (metres, Y up, +Z toward the viewer; see AvatarJointInput).
   * The avatar is placed at scale 1 so its shoulders coincide with the given shoulders. `dtMs` ≤ 0 snaps.
   */
  poseFromJoints(input: AvatarJointInput, nowMs = 0, dtMs = 0): boolean {
    targetsFromJoints(input, this.fitted);
    if (!this.solver.update(this.fitted, nowMs, dtMs)) return false;
    this.scale = 1;
    const t = this.fitted.joints;
    this.wantPosition
      .set(
        (t[J.SHOULDER_L * 3]! + t[J.SHOULDER_R * 3]!) / 2,
        (t[J.SHOULDER_L * 3 + 1]! + t[J.SHOULDER_R * 3 + 1]!) / 2,
        (t[J.SHOULDER_L * 3 + 2]! + t[J.SHOULDER_R * 3 + 2]!) / 2,
      )
      .sub(this.solver.state.anchor);
    this.position.copy(this.wantPosition);
    this.applyPose();
    return true;
  }

  private placeEased(dtMs: number): void {
    if (this.position.lengthSq() === 0 || dtMs <= 0) this.position.copy(this.wantPosition);
    else this.position.lerp(this.wantPosition, 1 - Math.exp(-dtMs / AVATAR_ROOT_SMOOTH_MS));
  }

  /** Copy solver output to the bones and the root transform. */
  applyPose(): void {
    const { local, stretch } = this.solver.state;
    const rest = this.asset.rig.bones;
    this.asset.bones.forEach((bone, i) => {
      bone.quaternion.fromArray(local, i * 4);
      bone.position.copy(rest[i]!.localPos).multiplyScalar(stretch[i]!);
    });
    this.root.position.copy(this.position);
    this.root.scale.setScalar(this.scale > 0 ? this.scale : 1);
  }

  snapshot(into?: AvatarSnapshot): AvatarSnapshot {
    const out = into ?? {
      local: new Float32Array(this.solver.state.local.length),
      stretch: new Float32Array(this.solver.state.stretch.length),
      position: new THREE.Vector3(),
      scale: 1,
      valid: false,
    };
    out.local.set(this.solver.state.local);
    out.stretch.set(this.solver.state.stretch);
    out.position.copy(this.position);
    out.scale = this.scale;
    out.valid = true;
    return out;
  }
  restore(snapshot: AvatarSnapshot): void {
    if (!snapshot.valid) return;
    this.solver.state.local.set(snapshot.local);
    this.solver.state.stretch.set(snapshot.stretch);
    this.position.copy(snapshot.position);
    this.wantPosition.copy(snapshot.position);
    this.scale = snapshot.scale;
    this.applyPose();
  }
  resetMotion(): void {
    this.solver.reset();
    this.hasTargets = false;
  }

  collectDisposal(geometries: Set<THREE.BufferGeometry>, materials: Set<THREE.Material>): void {
    for (const mesh of this.asset.meshes) geometries.add(mesh.geometry);
    for (const m of this.holo.values()) materials.add(m);
    for (const m of this.natural.values()) materials.add(m);
    for (const hull of this.outlines) materials.add(hull.material as THREE.Material);
    for (const m of this.sources) materials.add(m);
  }
  dispose(): void {
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>();
    this.collectDisposal(geometries, materials);
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    for (const mesh of this.asset.meshes) mesh.skeleton.dispose();
    this.root.removeFromParent();
  }
}

const scratchL = new THREE.Vector3(),
  scratchR = new THREE.Vector3();
function ease(current: number, target: number, dtMs: number, tauMs: number): number {
  return dtMs <= 0 ? target : current + (target - current) * (1 - Math.exp(-dtMs / tauMs));
}
