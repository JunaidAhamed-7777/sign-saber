/**
 * Sign Saber — tracking/tracking.worker.ts
 *
 * Responsibility: bounded worker inference; head/arms/torso-through-hips retention, mirrored once, owned transfer buffers.
 * Spec: docs/05-tracking-pipeline.md §Tracking worker; docs/02-architecture.md §TrackingFrame
 * Inputs: init/frame messages
 * Outputs: result/error messages
 *
 * Implementation: bounded live/replay input; hardware acceptance remains separate from synthetic assertions.
 */
import { FilesetResolver, HandLandmarker, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { HandRaw, TrackingFrame } from '../core/types';
import {
  INFER_W,
  INFER_H,
  POSE_W,
  POSE_H,
  MASK_W,
  MASK_H,
  TRACK_CONFIDENCE_MIN,
  ASSET_TEXT_MAX_CHARS,
  UPPER_BODY_LAST_LANDMARK,
  POSE_EVERY_N_FRAMES,
} from '../core/constants';
import {
  allocateTrackingBuffers,
  copyMirroredMask,
  mirrorLandmarks,
  playerHandFromModel,
  trackingTransfers,
  type FromTrackingWorker,
  type ToTrackingWorker,
  type TrackingBuffers,
} from './protocol';
import { maskUpperBody } from './upperBody';
const worker = self as unknown as DedicatedWorkerGlobalScope;
let hands: HandLandmarker | null = null;
let pose: PoseLandmarker | null = null;
let mainTimeOrigin = 0;
let lastTs = -Infinity;
let working = false;
let disposed = false;
let dropped = 0;
const available: TrackingBuffers[] = [allocateTrackingBuffers(), allocateTrackingBuffers()];
const handCanvas = new OffscreenCanvas(INFER_W, INFER_H);
const poseCanvas = new OffscreenCanvas(POSE_W, POSE_H);
const downscale = new OffscreenCanvas(POSE_W, POSE_H);
const poseCtx = downscale.getContext('2d', { alpha: false });
// Worker-owned copy of the last pose/mask so hand-only frames can repeat it
// without re-running pose (pose runs every POSE_EVERY_N_FRAMES processed frames).
const lastPose = allocateTrackingBuffers();
let lastPoseValid = false;
let lastMaskValid = false;
let poseCountdown = 0;
function send(message: FromTrackingWorker, transfers: Transferable[] = []): void {
  worker.postMessage(message, transfers);
}
function closeTasks(): void {
  hands?.close();
  pose?.close();
  hands = pose = null;
}
function describeError(error: unknown): string {
  return (error instanceof Error ? `${error.name}: ${error.message}` : String(error))
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/g, '$1')
    .slice(0, ASSET_TEXT_MAX_CHARS);
}
async function initialize(origin: number, preferredDelegate?: 'CPU'): Promise<void> {
  const start = performance.now();
  mainTimeOrigin = origin;
  // Installed 1.1.1 explicitly supports module WASM. The default uses importScripts,
  // which is unavailable in a module worker.
  const fileset = await FilesetResolver.forVisionTasks('/models/wasm', true);
  const attempts: string[] = [];
  for (const delegate of preferredDelegate === 'CPU' ? (['CPU'] as const) : (['GPU', 'CPU'] as const)) {
    let stage = `${delegate} hand task`;
    try {
      // The SDK clears the loader's factory after each graph. Distinct public
      // loader URLs ensure module evaluation for each task/delegate attempt;
      // the unchanged WASM binary still uses the single pinned local URL.
      const handFiles = { ...fileset, wasmLoaderPath: `${fileset.wasmLoaderPath}?task=hands-${delegate}` };
      const poseFiles = { ...fileset, wasmLoaderPath: `${fileset.wasmLoaderPath}?task=pose-${delegate}` };
      hands = await HandLandmarker.createFromOptions(handFiles, {
        baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: TRACK_CONFIDENCE_MIN,
        minHandPresenceConfidence: TRACK_CONFIDENCE_MIN,
        minTrackingConfidence: TRACK_CONFIDENCE_MIN,
        canvas: handCanvas,
      });
      stage = `${delegate} pose task`;
      pose = await PoseLandmarker.createFromOptions(poseFiles, {
        baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task', delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: TRACK_CONFIDENCE_MIN,
        minPosePresenceConfidence: TRACK_CONFIDENCE_MIN,
        minTrackingConfidence: TRACK_CONFIDENCE_MIN,
        outputSegmentationMasks: true,
        canvas: poseCanvas,
      });
      if (disposed) {
        closeTasks();
        return;
      }
      send({ type: 'ready', delegate, initMs: performance.now() - start });
      return;
    } catch (error) {
      const diagnostic = `${stage}: ${describeError(error)}`;
      attempts.push(diagnostic);
      console.error('[Sign Saber tracking delegate]', diagnostic);
      try {
        closeTasks();
      } catch (closeError) {
        attempts.push(`Task cleanup: ${describeError(closeError)}`);
      }
      if (delegate === 'CPU') throw new Error(attempts.join(' | '), { cause: error });
    }
  }
}
function processFrame(message: Extract<ToTrackingWorker, { type: 'frame' }>): void {
  const buffers = available.pop();
  if (disposed || working || !hands || !pose || !buffers || !poseCtx) {
    if (buffers) available.push(buffers);
    message.bitmap.close();
    dropped++;
    send({ type: 'dropped', seq: message.seq });
    return;
  }
  working = true;
  try {
    const start = performance.now();
    const timestamp = Math.max(message.tCapture, lastTs + 1);
    lastTs = timestamp;
    const handResult = hands.detectForVideo(message.bitmap, timestamp);
    const packedHands: HandRaw[] = [];
    for (let i = 0; i < Math.min(2, handResult.landmarks.length); i++) {
      const category = handResult.handedness[i]?.[0];
      const lm = handResult.landmarks[i];
      const world = handResult.worldLandmarks[i];
      if (!category || !lm || !world) continue;
      mirrorLandmarks(lm, buffers.handLm[i]!, 3);
      mirrorLandmarks(world, buffers.handWorld[i]!, 3, true);
      packedHands.push({
        handedness: playerHandFromModel(category.categoryName),
        score: category.score,
        landmarks: buffers.handLm[i]!,
        worldLandmarks: buffers.handWorld[i]!,
      });
    }
    const frame: TrackingFrame = {
      seq: message.seq,
      tCapture: message.tCapture,
      tInferDone: 0,
      inferenceMs: 0,
      hands: packedHands,
      pose: null,
      mask: null,
    };
    if (poseCountdown <= 0) {
      poseCountdown = POSE_EVERY_N_FRAMES;
      lastPoseValid = lastMaskValid = false;
      poseCtx.drawImage(message.bitmap, 0, 0, POSE_W, POSE_H);
      pose.detectForVideo(downscale, timestamp, (result) => {
        const lm = result.landmarks[0];
        const world = result.worldLandmarks[0];
        if (lm && world) {
          mirrorLandmarks(lm, buffers.poseLm, 4, false, UPPER_BODY_LAST_LANDMARK + 1);
          mirrorLandmarks(world, buffers.poseWorld, 3, true, UPPER_BODY_LAST_LANDMARK + 1);
          frame.pose = { landmarks: buffers.poseLm, worldLandmarks: buffers.poseWorld };
          const mask = result.segmentationMasks?.[0];
          if (mask) {
            copyMirroredMask(mask.getAsFloat32Array(), mask.width, mask.height, buffers.mask);
            const packedMask = { width: MASK_W, height: MASK_H, data: buffers.mask };
            if (maskUpperBody(packedMask, buffers.poseLm)) frame.mask = packedMask;
          }
        }
        // Callback results are task-owned; no MPMask escapes its documented lifetime.
      });
      if (frame.pose) {
        lastPose.poseLm.set(buffers.poseLm);
        lastPose.poseWorld.set(buffers.poseWorld);
        lastPoseValid = true;
      }
      if (frame.mask) {
        lastPose.mask.set(buffers.mask);
        lastMaskValid = true;
      }
    } else if (lastPoseValid) {
      buffers.poseLm.set(lastPose.poseLm);
      buffers.poseWorld.set(lastPose.poseWorld);
      frame.pose = { landmarks: buffers.poseLm, worldLandmarks: buffers.poseWorld };
      if (lastMaskValid) {
        buffers.mask.set(lastPose.mask);
        frame.mask = { width: MASK_W, height: MASK_H, data: buffers.mask };
      }
    }
    poseCountdown--;
    frame.inferenceMs = performance.now() - start;
    frame.tInferDone = performance.timeOrigin + performance.now() - mainTimeOrigin;
    send({ type: 'result', frame, buffers, dropped, allocs: 0 }, trackingTransfers(buffers));
  } catch (error) {
    available.push(buffers);
    send({
      type: 'error',
      where: 'frame',
      message: error instanceof Error ? error.message : 'Tracking inference failed',
      fatal: true,
    });
  } finally {
    message.bitmap.close();
    working = false;
  }
}
worker.onmessage = (event: MessageEvent<ToTrackingWorker>) => {
  const message = event.data;
  if (message.type === 'init')
    initialize(message.mainTimeOrigin, message.preferredDelegate).catch((error) =>
      send({
        type: 'error',
        where: 'init',
        message: error instanceof Error ? error.message : 'Model initialization failed',
        fatal: true,
      }),
    );
  else if (message.type === 'frame') processFrame(message);
  else if (message.type === 'recycle') {
    if (!disposed) available.push(message.buffers);
  } else if (message.type === 'dispose') {
    disposed = true;
    closeTasks();
    available.length = 0;
    handCanvas.width = poseCanvas.width = downscale.width = 0;
    send({ type: 'disposed' });
    worker.close();
  }
};
