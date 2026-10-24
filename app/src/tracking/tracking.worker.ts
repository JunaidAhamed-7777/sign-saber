/**
 * Sign Saber — tracking/tracking.worker.ts
 *
 * Responsibility: Web Worker: HandLandmarker + PoseLandmarker (segmentation on) with GPU delegate; mirrors once; posts TrackingFrame with transferables; keep-latest frame policy.
 * Spec: docs/05-tracking-pipeline.md §Tracking worker; docs/02-architecture.md §TrackingFrame
 * Inputs: init/frame messages
 * Outputs: result/error messages
 *
 * Implementation follows ROADMAP.md phase gates. This file documents the module contract only.
 */
export {};
