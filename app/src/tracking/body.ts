/**
 * Sign Saber — tracking/body.ts
 *
 * Responsibility: BodyState derivation: centerX, leanX, lean (hysteresis LEAN_ON/LEAN_OFF), tilt, torsoSpeed, duck.
 * Spec: docs/05-tracking-pipeline.md §Body metrics; docs/02-architecture.md §BodyState
 * Inputs: PoseRaw, BodyCalibration
 * Outputs: BodyState
 *
 * Implementation: bounded live/replay input; hardware acceptance remains separate from synthetic assertions.
 */
import type { BodyCalibration, BodyState, PoseRaw } from '../core/types';
import {
  BODY_FILTER_BETA,
  BODY_SPEED_EMA,
  LEAN_ON,
  LEAN_OFF,
  LEAN_TILT_ASSIST_DEG,
  TRACK_CONFIDENCE_MIN,
} from '../core/constants';
import { OneEuroFilter } from './filters';
import { upperBodyHipLine } from './upperBody';
export const enum POSE_LM {
  NOSE = 0,
  LEFT_SHOULDER = 11,
  RIGHT_SHOULDER = 12,
  LEFT_HIP = 23,
  RIGHT_HIP = 24,
}
export class BodyProcessor {
  readonly state: BodyState = {
    present: false,
    tCapture: 0,
    centerX: 0.5,
    leanX: 0,
    lean: 'center',
    tilt: 0,
    duck: false,
    torsoSpeed: 0,
  };
  readonly metrics = { centerX: 0.5, centerY: 0.5, shoulderWidthNorm: 0, headY: 0, visibility: 0 };
  private xFilter = new OneEuroFilter(BODY_FILTER_BETA);
  private yFilter = new OneEuroFilter(BODY_FILTER_BETA);
  private prevX = 0;
  private prevY = 0;
  private previousT = Number.NaN;
  reset(): void {
    this.xFilter.reset();
    this.yFilter.reset();
    this.previousT = Number.NaN;
    this.state.present = false;
    this.state.leanX = 0;
    this.state.lean = 'center';
    this.state.torsoSpeed = 0;
  }
  update(pose: PoseRaw | null, tCapture: number, calibration: BodyCalibration | null): BodyState {
    const s = this.state;
    s.tCapture = tCapture;
    const lm = pose?.landmarks;
    if (
      !lm ||
      lm.length !== 132 ||
      upperBodyHipLine(lm) === null ||
      Math.min(lm[POSE_LM.LEFT_SHOULDER * 4 + 3]!, lm[POSE_LM.RIGHT_SHOULDER * 4 + 3]!) < TRACK_CONFIDENCE_MIN
    ) {
      this.reset();
      return s;
    }
    const lx = lm[POSE_LM.LEFT_SHOULDER * 4]!;
    const rx = lm[POSE_LM.RIGHT_SHOULDER * 4]!;
    const ly = lm[POSE_LM.LEFT_SHOULDER * 4 + 1]!;
    const ry = lm[POSE_LM.RIGHT_SHOULDER * 4 + 1]!;
    const x = this.xFilter.filter((lx + rx) / 2, tCapture / 1000);
    const y = this.yFilter.filter((ly + ry) / 2, tCapture / 1000);
    s.present = true;
    s.centerX = x;
    this.metrics.centerX = x;
    this.metrics.centerY = y;
    this.metrics.shoulderWidthNorm = Math.hypot(lx - rx, ((ly - ry) * 9) / 16);
    this.metrics.headY = lm[1]!;
    this.metrics.visibility = Math.min(lm[47]!, lm[51]!);
    // atan2 is measured toward anatomical right; x reflection must not add 180°.
    s.tilt = (Math.atan2(ry - ly, Math.abs(rx - lx)) * 180) / Math.PI;
    if (!calibration || calibration.shoulderWidthNorm <= 0 || !Number.isFinite(calibration.physicalScale)) {
      s.leanX = 0;
      s.lean = 'center';
      s.torsoSpeed = 0;
      s.duck = false;
    } else {
      s.leanX = Math.max(-2, Math.min(2, (x - calibration.centerX) / calibration.shoulderWidthNorm));
      if ((s.lean === 'left' && s.leanX >= -LEAN_OFF) || (s.lean === 'right' && s.leanX <= LEAN_OFF))
        s.lean = 'center';
      const threshold = Math.abs(s.tilt) >= LEAN_TILT_ASSIST_DEG ? LEAN_OFF : LEAN_ON;
      if (s.leanX <= -threshold) s.lean = 'left';
      else if (s.leanX >= threshold) s.lean = 'right';
      const dt = (tCapture - this.previousT) / 1000;
      const speed =
        Number.isFinite(dt) && dt > 0
          ? (Math.hypot(x - this.prevX, ((y - this.prevY) * 9) / 16) * calibration.physicalScale) / dt
          : 0;
      s.torsoSpeed += (speed - s.torsoSpeed) * BODY_SPEED_EMA;
      s.duck = false;
    }
    this.prevX = x;
    this.prevY = y;
    this.previousT = tCapture;
    return s;
  }
}
