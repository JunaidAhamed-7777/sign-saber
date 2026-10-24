/**
 * Sign Saber — tracking/camera.ts
 *
 * Responsibility: getUserMedia at CAM_REQ_*, requestVideoFrameCallback capture, 16:9 centre-crop, ImageBitmap resize to INFER_W×INFER_H.
 * Spec: docs/05-tracking-pipeline.md §Camera capture
 * Inputs: MediaStream
 * Outputs: ImageBitmap + tCapture per frame
 *
 * Implementation begins at the hackathon kick-off (docs/19-build-plan.md). This file documents the module contract only.
 */
export {};
