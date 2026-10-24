/**
 * Sign Saber — tracking/body.ts
 *
 * Responsibility: BodyState derivation: centerX, leanX, lean (hysteresis LEAN_ON/LEAN_OFF), tilt, torsoSpeed, duck.
 * Spec: docs/05-tracking-pipeline.md §Body metrics; docs/02-architecture.md §BodyState
 * Inputs: PoseRaw, BodyCalibration
 * Outputs: BodyState
 *
 * Implementation follows ROADMAP.md phase gates. This file documents the module contract only.
 */
export {};
