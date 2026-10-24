/** Actual human-annotated still poses, held on a disclosed simulated timeline.
 * No temporal motion, fingers, gestures, depth or mask is invented. */
import type { TrackingFrame, PoseRaw } from '../core/types';
import {
  DATASET_TRIAL_HZ,
  DATASET_TRIAL_HOLD_MS,
  DATASET_TRIAL_CROP_FRACTION,
  DATASET_TRIAL_SHA256,
  DATASET_TRIAL_URL,
  DATASET_TRIAL_MAX_SAMPLES,
  DATASET_TRIAL_MAX_CATCHUP_FRAMES,
  ASSET_TEXT_MAX_CHARS,
} from '../core/constants';
import { sha256 } from '../beatmap/bundled';
const joints = {
  nose: 0,
  left_eye: 2,
  right_eye: 5,
  left_ear: 7,
  right_ear: 8,
  left_shoulder: 11,
  right_shoulder: 12,
  left_elbow: 13,
  right_elbow: 14,
  left_wrist: 15,
  right_wrist: 16,
  left_hip: 23,
  right_hip: 24,
} as const;
interface Joint {
  name: keyof typeof joints;
  x: number;
  y: number;
  visibility: number;
}
interface Sample {
  sampleId: string;
  width: number;
  height: number;
  keypoints: Joint[];
}
export interface DatasetTrialFixture {
  version: 1;
  temporalRecording: false;
  coordinateSpace: 'unmirrored-image-pixels';
  samples: Sample[];
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function validateDatasetTrial(value: unknown): DatasetTrialFixture {
  if (
    !record(value) ||
    value.version !== 1 ||
    value.temporalRecording !== false ||
    value.coordinateSpace !== 'unmirrored-image-pixels' ||
    !Array.isArray(value.samples) ||
    !value.samples.length ||
    value.samples.length > DATASET_TRIAL_MAX_SAMPLES
  )
    throw new Error('Unsupported annotated dataset trial.');
  const identities=new Set<string>();
  for (const sample of value.samples) {
    if (
      !record(sample) ||
      typeof sample.sampleId !== 'string' ||
      !sample.sampleId.trim() || sample.sampleId.length>ASSET_TEXT_MAX_CHARS || identities.has(sample.sampleId) ||
      !Number.isFinite(sample.width) ||
      !Number.isFinite(sample.height) ||
      Number(sample.width) <= 0 ||
      Number(sample.height) <= 0 ||
      !Array.isArray(sample.keypoints) ||
      sample.keypoints.length !== Object.keys(joints).length
    )
      throw new Error('Invalid dataset pose dimensions/topology.');
    const seen = new Set<string>();
    for (const point of sample.keypoints) {
      if (
        !record(point) ||
        typeof point.name !== 'string' ||
        !Object.hasOwn(joints,point.name) ||
        seen.has(point.name) ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        typeof point.visibility!=='number' || ![0,1,2].includes(point.visibility) ||
        Number(point.x)<0 || Number(point.x)>Number(sample.width) || Number(point.y)<0 || Number(point.y)>Number(sample.height)
      )
        throw new Error('Invalid annotated upper-body joint.');
      seen.add(point.name);
    }
    identities.add(sample.sampleId);
    for (const name of ['nose', 'left_shoulder', 'right_shoulder', 'left_hip', 'right_hip']) {
      const point = sample.keypoints.find((p) => record(p) && p.name === name);
      if (!point || Number(point.visibility) === 0)
        throw new Error('Dataset pose lacks a labelled head, shoulder or hip.');
    }
    datasetPose(sample as unknown as Sample);
  }
  return value as unknown as DatasetTrialFixture;
}
export function datasetPose(sample: Sample): PoseRaw {
  const pose: PoseRaw = { landmarks: new Float32Array(132), worldLandmarks: new Float32Array(99) };
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const point of sample.keypoints)
    if (point.visibility) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
  const cropWidth = Math.max(maxX - minX, ((maxY - minY) * 16) / 9) / DATASET_TRIAL_CROP_FRACTION;
  if (!Number.isFinite(cropWidth) || cropWidth <= 0) throw new Error('Degenerate dataset crop.');
  const cropHeight = (cropWidth * 9) / 16,
    centerX = (minX + maxX) / 2,
    centerY = (minY + maxY) / 2;
  for (const point of sample.keypoints) {
    if (!point.visibility) continue;
    const i = joints[point.name] * 4;
    pose.landmarks[i] = 0.5 - (point.x - centerX) / cropWidth;
    pose.landmarks[i + 1] = 0.5 + (point.y - centerY) / cropHeight;
    pose.landmarks[i + 2] = 0;
    pose.landmarks[i + 3] = point.visibility === 2 ? 1 : 0.5;
  }
  return pose;
}
export class DatasetTrial {
  private readonly frames: TrackingFrame[];
  private nextAt: number;
  private sequence = 0;
  sampleIndex = 0;
  private lastDelivered=-Infinity;
  private static clock(now:number):void{if(!Number.isFinite(now)||now<0||now>Number.MAX_SAFE_INTEGER/2)throw new RangeError('Invalid dataset clock timestamp.');}
  constructor(
    readonly fixture: DatasetTrialFixture,
    now: number,
  ) {
    DatasetTrial.clock(now);
    this.nextAt = now;
    this.frames = fixture.samples.map((sample) => ({
      seq: 0,
      tCapture: 0,
      tInferDone: 0,
      inferenceMs: 0,
      hands: [],
      pose: datasetPose(sample),
      mask: null,
    }));
  }
  static async load(now: number): Promise<DatasetTrial> {
    const response = await fetch(DATASET_TRIAL_URL);
    if (!response.ok) throw new Error('Local dataset trial is unavailable.');
    const bytes = await response.arrayBuffer();
    if ((await sha256(bytes)) !== DATASET_TRIAL_SHA256)
      throw new Error('Dataset trial integrity check failed.');
    return new DatasetTrial(validateDatasetTrial(JSON.parse(new TextDecoder().decode(bytes))), now);
  }
  rebase(now: number): void {
    DatasetTrial.clock(now);if(now<this.lastDelivered)throw new RangeError('Dataset clock cannot run backwards.');
    this.nextAt = now;
  }
  advance(
    now: number,
    songAt: (t: number) => number,
    consume: (frame: TrackingFrame, arrival: number, changed: boolean) => void,
  ): void {
    DatasetTrial.clock(now);
    if((now-this.nextAt)*DATASET_TRIAL_HZ/1000>=DATASET_TRIAL_MAX_CATCHUP_FRAMES)throw new RangeError('Dataset timeline stalled; return to Songs and restart the trial.');
    while (this.nextAt <= now) {
      const time = this.nextAt,
        songTime = songAt(time);
      const index =
        Math.floor(Math.max(0, Number.isFinite(songTime) ? songTime : 0) / DATASET_TRIAL_HOLD_MS) %
        this.frames.length;
      const changed = index !== this.sampleIndex;
      this.sampleIndex = index;
      const frame = this.frames[index]!;
      frame.seq = this.sequence++;
      frame.tCapture = time;
      frame.tInferDone = time;
      this.lastDelivered=time;
      consume(frame, time, changed);
      this.nextAt += 1000 / DATASET_TRIAL_HZ;
    }
  }
}
