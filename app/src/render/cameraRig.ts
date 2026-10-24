/**
 * Sign Saber — render/cameraRig.ts
 *
 * Responsibility: Subtle gameplay camera response: trauma-based smooth shake from hits, bad cuts, kicks,
 * drops and obstacle hits, plus a small bass FOV breath.
 * Spec: docs/13-rendering-environment-camera-postfx.md §5 Camera rig
 * Inputs: Game/music events (trauma), smoothed bass response, mode, Calm.
 * Outputs: Position offset, roll and FOV delta applied by the renderer around the base pose.
 *
 * Visual only. Disabled entirely outside play and in Calm (fixed framing). Shake uses smooth value
 * noise at CAMERA_SHAKE_HZ (never white noise) and is capped at SHAKE_MAX_M / SHAKE_MAX_ROLL_DEG.
 */
import * as THREE from 'three';
import {
  CAMERA_BASS_FOV_DEG,
  CAMERA_SHAKE_HZ,
  SHAKE_MAX_M,
  SHAKE_MAX_ROLL_DEG,
  TRAUMA_DECAY_S,
} from '../core/constants';

function hash(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}
/** Smooth 1-D value noise in [-1, 1] (cosine-interpolated lattice). */
export function noise1(t: number, salt: number): number {
  const i = Math.floor(t),
    f = t - i,
    w = (1 - Math.cos(f * Math.PI)) / 2;
  return hash(i + salt * 57) * (1 - w) + hash(i + 1 + salt * 57) * w;
}

export class CameraRig {
  readonly offset = new THREE.Vector3();
  roll = 0;
  fovDelta = 0;
  private trauma = 0;
  private time = 0;

  addTrauma(amount: number): void {
    if (Number.isFinite(amount) && amount > 0) this.trauma = Math.min(1, this.trauma + amount);
  }

  get currentTrauma(): number {
    return this.trauma;
  }

  update(dtMs: number, active: boolean, calm: boolean, bass: number): void {
    const dt = Math.min(0.1, Math.max(0, dtMs / 1000));
    if (!active || calm) {
      this.trauma = 0;
      this.offset.set(0, 0, 0);
      this.roll = this.fovDelta = 0;
      return;
    }
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - dt / TRAUMA_DECAY_S);
    const shake = this.trauma * this.trauma,
      t = this.time * CAMERA_SHAKE_HZ;
    this.offset.set(noise1(t, 0), noise1(t, 7), noise1(t, 13) * 0.5).multiplyScalar(SHAKE_MAX_M * shake);
    this.roll = THREE.MathUtils.degToRad(noise1(t, 21) * SHAKE_MAX_ROLL_DEG * shake);
    this.fovDelta = CAMERA_BASS_FOV_DEG * Math.max(0, Math.min(1, bass));
  }

  reset(): void {
    this.trauma = this.time = 0;
    this.offset.set(0, 0, 0);
    this.roll = this.fovDelta = 0;
  }
}
