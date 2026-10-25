/** Shared consumer for live/replay TrackingFrames. Owns retained filtered arrays. */
import type { BodyCalibration, HandRaw, PoseRaw, TrackingFrame } from '../core/types';
import type { MenuHandSample } from '../core/menuInput';
import {
  CALIB_ASSUMED_SHOULDER_M,
  CALIB_SAMPLE_MS,
  CALIB_SHOULDER_MAX,
  CALIB_SHOULDER_MIN,
  CALIB_VISIBILITY_MIN,
  HAND_IDENTITY_GRACE_MS,
  HAND_IDENTITY_MATCH_DIST,
  HAND_IDENTITY_OVERRIDE_DIST,
  INPUT_MAX_AGE_MS,
  TRACK_CONFIDENCE_MIN,
  TRACK_TARGET_HZ,
  UPPER_BODY_LAST_LANDMARK,
} from '../core/constants';
import { CursorProcessor } from '../gestures/cursor';
import { LandmarkFilters } from './filters';
import { BodyProcessor } from './body';
import { copyUpperBodyPose } from './upperBody';
const HANDS = ['left', 'right'] as const;
const SAMPLE_CAPACITY = Math.ceil((CALIB_SAMPLE_MS / 1000) * TRACK_TARGET_HZ) + 2;
class HandSlot {
  readonly processor: CursorProcessor;
  readonly filters = new LandmarkFilters(63);
  readonly raw: HandRaw;
  lastSeen = -Infinity;
  lastX = 0;
  lastY = 0;
  constructor(readonly hand: 'left' | 'right') {
    this.processor = new CursorProcessor(hand);
    this.raw = {
      handedness: hand,
      score: 0,
      landmarks: new Float32Array(63),
      worldLandmarks: new Float32Array(63),
    };
  }
  reset(): void {
    this.processor.reset();
    this.filters.reset();
  }
}
export class InputPipeline {
  calibration: BodyCalibration | null = null;
  private slots = [new HandSlot('left'), new HandSlot('right')] as const;
  private bodyProcessor = new BodyProcessor();
  private poseFilters = new LandmarkFilters(132);
  readonly pose: PoseRaw = { landmarks: new Float32Array(132), worldLandmarks: new Float32Array(99) };
  private readonly upperPoseInput: PoseRaw = {
    landmarks: new Float32Array(132),
    worldLandmarks: new Float32Array(99),
  };
  readonly result = {
    hands: [this.slots[0].processor.cursor, this.slots[1].processor.cursor],
    body: this.bodyProcessor.state,
    menuHands: HANDS.map(
      (hand) =>
        ({
          hand,
          present: false,
          tCapture: 0,
          seq: -1,
          palm: { x: 0, y: 0 },
          gesture: 'none',
          confidence: 0,
        }) as MenuHandSample,
    ),
    pose: null as PoseRaw | null,
    calibrationReady: false,
  };
  private seq = -1;
  private t = -Infinity;
  private calibTimes = new Float64Array(SAMPLE_CAPACITY);
  private calibValues = new Float64Array(SAMPLE_CAPACITY * 3);
  private calibIndex = 0;
  private calibCount = 0;
  private assigned: [HandRaw | null, HandRaw | null] = [null, null];
  reset(): void {
    for (const slot of this.slots) slot.reset();
    this.bodyProcessor.reset();
    this.poseFilters.reset();
    this.seq = -1;
    this.t = -Infinity;
    this.calibCount = this.calibIndex = 0;
    this.result.calibrationReady = false;
  }
  invalidateCalibration(): void {
    this.calibration = null;
    this.reset();
  }
  beamFired(hand: 'left' | 'right', tCapture: number): void {
    this.slots[hand === 'left' ? 0 : 1].processor.beamFired(tCapture);
  }
  process(frame: TrackingFrame, now: number, source: 'live' | 'replay' = 'live'): typeof this.result | null {
    if (
      !this.validFrame(frame) ||
      frame.seq <= this.seq ||
      frame.tCapture <= this.t ||
      (source === 'live' && (now - frame.tCapture > INPUT_MAX_AGE_MS || now < frame.tCapture))
    )
      return null;
    if (frame.tCapture - this.t > INPUT_MAX_AGE_MS) {
      for (const slot of this.slots) slot.reset();
      this.bodyProcessor.reset();
      this.calibCount = 0;
    }
    this.seq = frame.seq;
    this.t = frame.tCapture;
    this.assignHands(frame);
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i]!;
      const assigned = this.assigned[i];
      const menu = this.result.menuHands[i]!;
      if (assigned) {
        if (frame.tCapture - slot.lastSeen > HAND_IDENTITY_GRACE_MS) slot.reset();
        slot.filters.apply(assigned.landmarks, slot.raw.landmarks, frame.tCapture);
        slot.raw.worldLandmarks.set(assigned.worldLandmarks);
        slot.raw.score = assigned.score;
        slot.lastX = assigned.landmarks[0]!;
        slot.lastY = assigned.landmarks[1]!;
        slot.lastSeen = frame.tCapture;
        slot.processor.update(slot.raw, frame.tCapture);
      } else {
        slot.processor.update(null, frame.tCapture);
        slot.filters.reset();
      }
      menu.seq = frame.seq;
      menu.tCapture = frame.tCapture;
      menu.present = !!assigned;
      menu.palm.x = slot.processor.palm.x;
      menu.palm.y = slot.processor.palm.y;
      menu.gesture = slot.processor.cursor.gesture;
      // Current evidence must agree with the stable gesture; a held display pose cannot click.
      menu.confidence =
        slot.processor.evidence.gesture === menu.gesture && !slot.processor.evidence.ambiguous && assigned
          ? slot.processor.evidence.confidence
          : 0;
    }
    if (frame.pose) {
      copyUpperBodyPose(frame.pose, this.upperPoseInput);
      this.poseFilters.apply(this.upperPoseInput.landmarks, this.pose.landmarks, frame.tCapture, 4);
      this.pose.worldLandmarks.set(this.upperPoseInput.worldLandmarks);
      this.result.pose = this.pose;
    } else {
      this.result.pose = null;
      this.poseFilters.reset();
    }
    this.bodyProcessor.update(this.result.pose, frame.tCapture, this.calibration);
    this.sampleCalibration(frame.tCapture);
    return this.result;
  }
  calibrate(identity: string): BodyCalibration | null {
    if (!identity || !this.result.calibrationReady) return null;
    let x = 0;
    let width = 0;
    let head = 0;
    let count = 0;
    for (let i = 0; i < this.calibCount; i++)
      if (this.t - this.calibTimes[i]! <= CALIB_SAMPLE_MS) {
        x += this.calibValues[i * 3]!;
        width += this.calibValues[i * 3 + 1]!;
        head += this.calibValues[i * 3 + 2]!;
        count++;
      }
    if (!count || width <= 0) return null;
    this.calibration = {
      centerX: x / count,
      shoulderWidthNorm: width / count,
      headY: head / count,
      physicalScale: CALIB_ASSUMED_SHOULDER_M / (width / count),
      capturedAt: this.t,
      identity,
    };
    return this.calibration;
  }
  private sampleCalibration(t: number): void {
    const m = this.bodyProcessor.metrics;
    const valid =
      this.result.body.present &&
      m.visibility >= CALIB_VISIBILITY_MIN &&
      m.shoulderWidthNorm >= CALIB_SHOULDER_MIN &&
      m.shoulderWidthNorm <= CALIB_SHOULDER_MAX;
    // Head and shoulders are enough to calibrate; hips and hands are optional (desk/close play).
    const upperBodyValid = this.pose.landmarks[3]! >= CALIB_VISIBILITY_MIN;
    if (!valid || !upperBodyValid) {
      this.calibCount = 0;
      this.calibIndex = 0;
      this.result.calibrationReady = false;
      return;
    }
    const previousIndex = (this.calibIndex - 1 + SAMPLE_CAPACITY) % SAMPLE_CAPACITY;
    if (this.calibCount === 0 || t - this.calibTimes[previousIndex]! >= 1000 / TRACK_TARGET_HZ) {
      this.calibTimes[this.calibIndex] = t;
      this.calibValues[this.calibIndex * 3] = m.centerX;
      this.calibValues[this.calibIndex * 3 + 1] = m.shoulderWidthNorm;
      this.calibValues[this.calibIndex * 3 + 2] = m.headY;
      this.calibIndex = (this.calibIndex + 1) % SAMPLE_CAPACITY;
      this.calibCount = Math.min(SAMPLE_CAPACITY, this.calibCount + 1);
    }
    let oldest = t;
    for (let i = 0; i < this.calibCount; i++) oldest = Math.min(oldest, this.calibTimes[i]!);
    this.result.calibrationReady = t - oldest >= CALIB_SAMPLE_MS;
  }
  private validFrame(f: TrackingFrame): boolean {
    if (
      !Number.isInteger(f.seq) ||
      !Number.isFinite(f.tCapture) ||
      !Number.isFinite(f.tInferDone) ||
      !Number.isFinite(f.inferenceMs) ||
      f.hands.length > 2
    )
      return false;
    for (const h of f.hands) {
      if (h.landmarks.length !== 63 || h.worldLandmarks.length !== 63 || !Number.isFinite(h.score))
        return false;
      for (let i = 0; i < 63; i++)
        if (!Number.isFinite(h.landmarks[i]) || !Number.isFinite(h.worldLandmarks[i])) return false;
    }
    if (f.pose) {
      if (f.pose.landmarks.length !== 132 || f.pose.worldLandmarks.length !== 99) return false;
      for (let i = 0; i < (UPPER_BODY_LAST_LANDMARK + 1) * 4; i++)
        if (!Number.isFinite(f.pose.landmarks[i])) return false;
      for (let i = 0; i < (UPPER_BODY_LAST_LANDMARK + 1) * 3; i++)
        if (!Number.isFinite(f.pose.worldLandmarks[i])) return false;
    }
    return true;
  }
  private assignHands(frame: TrackingFrame): void {
    this.assigned[0] = this.assigned[1] = null;
    const a = frame.hands[0];
    const b = frame.hands[1];
    const validA = a && a.score >= TRACK_CONFIDENCE_MIN ? a : null;
    const validB = b && b.score >= TRACK_CONFIDENCE_MIN ? b : null;
    const recent0 = frame.tCapture - this.slots[0].lastSeen <= HAND_IDENTITY_GRACE_MS;
    const recent1 = frame.tCapture - this.slots[1].lastSeen <= HAND_IDENTITY_GRACE_MS;
    const distance = (h: HandRaw, i: number) =>
      Math.hypot(h.landmarks[0]! - this.slots[i]!.lastX, h.landmarks[1]! - this.slots[i]!.lastY);
    if (validA && validB) {
      if (recent0 || recent1) {
        const direct = (recent0 ? distance(validA, 0) : 0) + (recent1 ? distance(validB, 1) : 0);
        const reverse = (recent1 ? distance(validA, 1) : 0) + (recent0 ? distance(validB, 0) : 0);
        const swap = reverse < direct || (reverse === direct && validA.handedness === 'right');
        this.assigned[0] = swap ? validB : validA;
        this.assigned[1] = swap ? validA : validB;
      } else if (validA.handedness !== validB.handedness) {
        this.assigned[validA.handedness === 'left' ? 0 : 1] = validA;
        this.assigned[validB.handedness === 'left' ? 0 : 1] = validB;
      }
      return;
    }
    const single = validA ?? validB;
    if (!single) return;
    const labelled = single.handedness === 'left' ? 0 : 1;
    const other = labelled === 0 ? 1 : 0;
    const labelRecent = labelled === 0 ? recent0 : recent1;
    const otherRecent = other === 0 ? recent0 : recent1;
    if (
      otherRecent &&
      distance(single, other) < HAND_IDENTITY_OVERRIDE_DIST &&
      (!labelRecent || distance(single, labelled) > HAND_IDENTITY_MATCH_DIST)
    )
      this.assigned[other] = single;
    else this.assigned[labelled] = single;
  }
}
