import type { TrackingFrame } from '../core/types';
import { MASK_W, MASK_H } from '../core/constants';
export interface TrackingBuffers {
  handLm: [Float32Array, Float32Array];
  handWorld: [Float32Array, Float32Array];
  poseLm: Float32Array;
  poseWorld: Float32Array;
  mask: Uint8Array;
}
export function allocateTrackingBuffers(): TrackingBuffers {
  return {
    handLm: [new Float32Array(63), new Float32Array(63)],
    handWorld: [new Float32Array(63), new Float32Array(63)],
    poseLm: new Float32Array(132),
    poseWorld: new Float32Array(99),
    mask: new Uint8Array(MASK_W * MASK_H),
  };
}
export function trackingTransfers(b: TrackingBuffers): ArrayBuffer[] {
  return [
    b.handLm[0].buffer,
    b.handLm[1].buffer,
    b.handWorld[0].buffer,
    b.handWorld[1].buffer,
    b.poseLm.buffer,
    b.poseWorld.buffer,
    b.mask.buffer,
  ] as ArrayBuffer[];
}
export type ToTrackingWorker =
  | { type: 'init'; mainTimeOrigin: number; preferredDelegate?: 'CPU' }
  | { type: 'frame'; bitmap: ImageBitmap; seq: number; tCapture: number }
  | { type: 'recycle'; buffers: TrackingBuffers }
  | { type: 'dispose' };
export type FromTrackingWorker =
  | { type: 'ready'; delegate: 'GPU' | 'CPU'; initMs: number }
  | { type: 'result'; frame: TrackingFrame; buffers: TrackingBuffers; dropped: number; allocs: number }
  | { type: 'dropped'; seq: number }
  | { type: 'disposed' }
  | { type: 'error'; where: 'init' | 'frame'; message: string; fatal: boolean };
/** Default for raw, unmirrored camera input. Must be checked with a labelled live hand. */
export function playerHandFromModel(label: string): 'left' | 'right' {
  return label.toLowerCase() === 'left' ? 'right' : 'left';
}
export function mirrorLandmarks(
  source: readonly { x: number; y: number; z: number; visibility?: number }[],
  target: Float32Array,
  stride: number,
  world = false,
  limit = source.length,
): void {
  const count = Math.min(source.length, limit);
  for (let i = 0; i < count; i++) {
    const p = source[i]!;
    target[i * stride] = world ? -p.x : 1 - p.x;
    target[i * stride + 1] = p.y;
    target[i * stride + 2] = p.z;
    if (stride === 4) target[i * stride + 3] = p.visibility ?? 0;
  }
  target.fill(0, count * stride);
}
export function copyMirroredMask(
  source: Float32Array,
  width: number,
  height: number,
  target: Uint8Array,
  outWidth = MASK_W,
  outHeight = MASK_H,
): void {
  for (let y = 0; y < outHeight; y++)
    for (let x = 0; x < outWidth; x++) {
      const sx = Math.min(width - 1, Math.floor(((outWidth - 1 - x) * width) / outWidth));
      const sy = Math.min(height - 1, Math.floor((y * height) / outHeight));
      target[y * outWidth + x] = Math.round(Math.max(0, Math.min(1, source[sy * width + sx] ?? 0)) * 255);
    }
}
