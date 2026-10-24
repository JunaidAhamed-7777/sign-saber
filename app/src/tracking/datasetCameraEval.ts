/**
 * Sign Saber — tracking/datasetCameraEval.ts
 *
 * Responsibility: compare live-pipeline MediaPipe output for dataset-camera frames with the known
 * annotation truth that was on the canvas at capture time. Pure and bounded; no DOM.
 * Spec: docs/05-tracking-pipeline.md §1.3; docs/24-benchmark-and-evidence.md §2 (dataset-camera lane)
 * Inputs: attributed TrackingFrame (mirrored image space) and processed HandCursor gestures
 * Outputs: per-truth and aggregate detection/error summaries
 *
 * Errors are normalized by the annotated isotropic shoulder width (x in width units, y scaled by 9/16).
 * Still photos contain no motion; these numbers say nothing about webcam latency or swing recognition.
 */
import type { Gesture, HandCursor, TrackingFrame } from '../core/types';
import {
  DATASET_CAMERA_MATCH_SHOULDER_FRACTION,
  DATASET_CAMERA_MAX_ITEMS,
  DATASET_CAMERA_PCK_SHOULDER_FRACTION,
} from '../core/constants';

export const REEL_JOINTS = [
  ['nose', 0],
  ['left_eye', 2],
  ['right_eye', 5],
  ['left_ear', 7],
  ['right_ear', 8],
  ['left_shoulder', 11],
  ['right_shoulder', 12],
  ['left_elbow', 13],
  ['right_elbow', 14],
  ['left_wrist', 15],
  ['right_wrist', 16],
  ['left_hip', 23],
  ['right_hip', 24],
] as const;
export type ReelJointName = (typeof REEL_JOINTS)[number][0];
export interface ReelKeypoint {
  readonly name: ReelJointName;
  /** Crop-normalized, UNMIRRORED 16:9 frame coordinates. */
  readonly x: number;
  readonly y: number;
  /** COCO convention: 0 unlabelled, 1 labelled but occluded, 2 visible. */
  readonly v: 0 | 1 | 2;
}
export interface ReelTruth {
  readonly id: string;
  readonly role: string;
  readonly keypoints: readonly ReelKeypoint[];
}
const ASPECT_Y = 9 / 16;
const GESTURES: readonly (Gesture | 'absent')[] = ['open', 'fist', 'point', 'none', 'absent'];
type GestureCounts = Record<Gesture | 'absent', number>;
const gestureCounts = (): GestureCounts => ({ open: 0, fist: 0, point: 0, none: 0, absent: 0 });

class TruthStats {
  frames = 0;
  poseFrames = 0;
  handFrames = [0, 0, 0];
  readonly errorSum = new Float64Array(REEL_JOINTS.length);
  readonly errorCount = new Uint32Array(REEL_JOINTS.length);
  readonly visibilitySum = new Float64Array(REEL_JOINTS.length);
  wristMatched = 0;
  handednessAgree = 0;
  handednessDisagree = 0;
  handsUnmatched = 0;
  processedFrames = 0;
  readonly gestures = { left: gestureCounts(), right: gestureCounts() };
  constructor(
    readonly id: string,
    readonly role: string,
  ) {}
}

export function shoulderWidth(truth: ReelTruth): number | null {
  const left = truth.keypoints.find((p) => p.name === 'left_shoulder');
  const right = truth.keypoints.find((p) => p.name === 'right_shoulder');
  if (!left?.v || !right?.v) return null;
  const width = Math.hypot(left.x - right.x, (left.y - right.y) * ASPECT_Y);
  return width > 0 ? width : null;
}
/** Isotropic distance between a mirrored landmark and an unmirrored truth point, in frame-width units. */
export function mirroredDistance(u: number, v: number, truth: { x: number; y: number }): number {
  return Math.hypot(1 - u - truth.x, (v - truth.y) * ASPECT_Y);
}
function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
const round = (value: number | null, digits = 4): number | null =>
  value === null || !Number.isFinite(value) ? null : Number(value.toFixed(digits));

export class DatasetCameraEvaluator {
  private readonly stats = new Map<string, TruthStats>();
  unattributedFrames = 0;
  unattributedProcessed = 0;
  overflowFrames = 0;
  private entry(truth: ReelTruth): TruthStats | null {
    let entry = this.stats.get(truth.id);
    if (!entry) {
      if (this.stats.size >= DATASET_CAMERA_MAX_ITEMS) return null;
      entry = new TruthStats(truth.id, truth.role);
      this.stats.set(truth.id, entry);
    }
    return entry;
  }
  /** Raw worker output for one capture. `truth` is null when the capture cannot be attributed. */
  frame(truth: ReelTruth | null, frame: TrackingFrame): void {
    if (!truth) {
      this.unattributedFrames++;
      return;
    }
    const entry = this.entry(truth);
    if (!entry) {
      this.overflowFrames++;
      return;
    }
    entry.frames++;
    entry.handFrames[Math.min(2, frame.hands.length)]!++;
    const scale = shoulderWidth(truth);
    if (frame.pose) {
      entry.poseFrames++;
      const lm = frame.pose.landmarks;
      for (let j = 0; j < REEL_JOINTS.length; j++) {
        const [name, index] = REEL_JOINTS[j]!;
        entry.visibilitySum[j] = entry.visibilitySum[j]! + lm[index * 4 + 3]!;
        const point = truth.keypoints.find((p) => p.name === name);
        if (!point?.v || scale === null) continue;
        entry.errorSum[j] =
          entry.errorSum[j]! + mirroredDistance(lm[index * 4]!, lm[index * 4 + 1]!, point) / scale;
        entry.errorCount[j]!++;
      }
    }
    if (scale === null) return;
    const wrists = (['left', 'right'] as const)
      .map((side) => ({ side, point: truth.keypoints.find((p) => p.name === `${side}_wrist`) }))
      .filter((wrist) => !!wrist.point?.v);
    for (const hand of frame.hands) {
      let best: 'left' | 'right' | null = null;
      let bestDistance = Infinity;
      for (const wrist of wrists) {
        const distance = mirroredDistance(hand.landmarks[0]!, hand.landmarks[1]!, wrist.point!) / scale;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = wrist.side;
        }
      }
      if (!best || bestDistance > DATASET_CAMERA_MATCH_SHOULDER_FRACTION) {
        entry.handsUnmatched++;
        continue;
      }
      entry.wristMatched++;
      if (hand.handedness === best) entry.handednessAgree++;
      else entry.handednessDisagree++;
    }
  }
  /** Gesture classification produced by the unchanged input pipeline for the same capture. */
  processed(truth: ReelTruth | null, hands: readonly HandCursor[]): void {
    if (!truth) {
      this.unattributedProcessed++;
      return;
    }
    const entry = this.entry(truth);
    if (!entry) return;
    entry.processedFrames++;
    for (const hand of hands) entry.gestures[hand.hand][hand.present ? hand.gesture : 'absent']++;
  }
  reset(): void {
    this.stats.clear();
    this.unattributedFrames = this.unattributedProcessed = this.overflowFrames = 0;
  }
  summary() {
    const items = [...this.stats.values()].map((entry) => {
      const meanError: Record<string, number | null> = {};
      const meanVisibility: Record<string, number | null> = {};
      let upperSum = 0;
      let upperCount = 0;
      REEL_JOINTS.forEach(([name], j) => {
        const count = entry.errorCount[j]!;
        const mean = count ? entry.errorSum[j]! / count : null;
        meanError[name] = round(mean);
        meanVisibility[name] = entry.poseFrames ? round(entry.visibilitySum[j]! / entry.poseFrames, 3) : null;
        if (mean !== null) {
          upperSum += mean;
          upperCount++;
        }
      });
      return {
        id: entry.id,
        role: entry.role,
        frames: entry.frames,
        poseRate: entry.frames ? round(entry.poseFrames / entry.frames, 3) : null,
        oneOrMoreHandsRate: entry.frames
          ? round((entry.handFrames[1]! + entry.handFrames[2]!) / entry.frames, 3)
          : null,
        twoHandsRate: entry.frames ? round(entry.handFrames[2]! / entry.frames, 3) : null,
        meanJointErrorShoulderWidths: meanError,
        meanLabelledJointError: upperCount ? round(upperSum / upperCount) : null,
        meanPoseVisibility: meanVisibility,
        wristHands: {
          matched: entry.wristMatched,
          handednessAgree: entry.handednessAgree,
          handednessDisagree: entry.handednessDisagree,
          unmatched: entry.handsUnmatched,
        },
        processedFrames: entry.processedFrames,
        gestures: entry.gestures,
      };
    });
    const observed = items.filter((item) => item.frames > 0);
    const perJoint: Record<string, { items: number; median: number | null; pck: number | null }> = {};
    for (const [name] of REEL_JOINTS) {
      const values = observed
        .map((item) => item.meanJointErrorShoulderWidths[name])
        .filter((value): value is number => value !== null && value !== undefined);
      perJoint[name] = {
        items: values.length,
        median: round(median(values)),
        pck: values.length
          ? round(
              values.filter((value) => value <= DATASET_CAMERA_PCK_SHOULDER_FRACTION).length / values.length,
              3,
            )
          : null,
      };
    }
    const sum = (pick: (item: (typeof items)[number]) => number) =>
      observed.reduce((total, item) => total + pick(item), 0);
    const gestureTotals = { left: gestureCounts(), right: gestureCounts() };
    for (const item of observed)
      for (const side of ['left', 'right'] as const)
        for (const gesture of GESTURES) gestureTotals[side][gesture] += item.gestures[side][gesture];
    return {
      definitions: {
        unit: 'Per-photo means; frames of one still photo are not independent samples.',
        error:
          'Isotropic distance between unmirrored MediaPipe pose landmark and annotation, divided by annotated shoulder width.',
        pck: `Fraction of photos whose mean joint error is <= ${DATASET_CAMERA_PCK_SHOULDER_FRACTION} shoulder widths.`,
        wristMatch: `A detected hand's wrist landmark within ${DATASET_CAMERA_MATCH_SHOULDER_FRACTION} shoulder widths of an annotated wrist; handedness agreement compares the adapter's player hand with that anatomical wrist.`,
        detected: 'poseRate >= 0.5 of attributed frames.',
      },
      attributedFrames: sum((item) => item.frames),
      unattributedFrames: this.unattributedFrames,
      unattributedProcessed: this.unattributedProcessed,
      overflowFrames: this.overflowFrames,
      truthsObserved: observed.length,
      poseDetectedTruths: observed.filter((item) => (item.poseRate ?? 0) >= 0.5).length,
      anyHandTruths: observed.filter((item) => (item.oneOrMoreHandsRate ?? 0) >= 0.5).length,
      twoHandTruths: observed.filter((item) => (item.twoHandsRate ?? 0) >= 0.5).length,
      medianLabelledJointError: round(
        median(
          observed
            .map((item) => item.meanLabelledJointError)
            .filter((value): value is number => value !== null),
        ),
      ),
      perJoint,
      wristHands: {
        matched: sum((item) => item.wristHands.matched),
        handednessAgree: sum((item) => item.wristHands.handednessAgree),
        handednessDisagree: sum((item) => item.wristHands.handednessDisagree),
        unmatched: sum((item) => item.wristHands.unmatched),
      },
      gestures: gestureTotals,
      items,
    };
  }
}
