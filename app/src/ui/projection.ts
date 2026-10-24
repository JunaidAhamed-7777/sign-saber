/**
 * World → viewport projection for HUD judgement pops (docs14 §Projecting hit positions to screen).
 * Mirrors the renderer's play camera: CAM_POS looking at CAM_LOOK_AT with CAM_FOV_DEG over the full viewport.
 * If camera choreography changes the play camera, this adapter must follow it. Reuses one camera and vector.
 */
import { PerspectiveCamera, Vector3 } from 'three';
import { CAM_FOV_DEG, CAM_LOOK_AT, CAM_POS, HUD_POP_TORSO_CLEAR_FRACTION } from '../core/constants';
import type { Vec3 } from '../core/types';
const camera = new PerspectiveCamera(CAM_FOV_DEG, 16 / 9, 0.05, 1000);
camera.position.set(CAM_POS.x, CAM_POS.y, CAM_POS.z);
camera.lookAt(CAM_LOOK_AT.x, CAM_LOOK_AT.y, CAM_LOOK_AT.z);
camera.updateMatrixWorld();
// eslint-disable-next-line no-restricted-syntax -- single module-level scratch, reused for every projection
const scratch = new Vector3();
let lastAspect = 0;
export interface ScreenPoint {
  x: number;
  y: number;
  visible: boolean;
}
/** Projects into caller-owned `out` (CSS pixels from the viewport's top-left). */
export function projectToViewport(pos: Vec3, width: number, height: number, out: ScreenPoint): ScreenPoint {
  const aspect = width / Math.max(1, height);
  if (aspect !== lastAspect) {
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
    lastAspect = aspect;
  }
  scratch.set(pos.x, pos.y, pos.z).project(camera);
  out.visible = Number.isFinite(scratch.x) && Number.isFinite(scratch.y) && scratch.z >= -1 && scratch.z <= 1;
  out.x = ((scratch.x + 1) / 2) * width;
  out.y = ((1 - scratch.y) / 2) * height;
  return out;
}
/**
 * Keeps pop text out of the central torso band: points inside ±HUD_POP_TORSO_CLEAR_FRACTION of the width
 * around the centre move to the nearer band edge. Text centred on a side edge stays readable beside the player.
 */
export function clearOfTorso(point: ScreenPoint, width: number): 'left' | 'right' | null {
  const centre = width / 2,
    half = width * HUD_POP_TORSO_CLEAR_FRACTION;
  const offset = point.x - centre;
  if (Math.abs(offset) >= half) return null;
  point.x = centre + (offset < 0 ? -half : half);
  return offset < 0 ? 'left' : 'right';
}
