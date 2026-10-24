/**
 * Sign Saber — tracking/cameraSource.ts
 *
 * Responsibility: injectable MediaStream acquisition for the single live camera path.
 * Spec: docs/05-tracking-pipeline.md §1.1 and §1.3
 * Inputs: browser media APIs (webcam) or a labelled dataset reel (dataset camera)
 * Outputs: one MediaStream; everything after the stream is unchanged
 *
 * The controller owns and stops returned tracks. A source releases only its own extra
 * resources (canvas, timers, decoded bitmaps) in `close()`, which must be idempotent.
 */
import type { TrackingFrame } from '../core/types';
import { CAM_REQ_FPS, CAM_REQ_H, CAM_REQ_W } from '../core/constants';
import type { HandCursor } from '../core/types';

export type CameraSourceKind = 'webcam' | 'dataset';

export interface CameraStreamSource {
  readonly kind: CameraSourceKind;
  /** Player-facing label used in statuses/captions. */
  readonly label: string;
  /** Evidence lane for exported diagnostics. */
  readonly lane: string;
  open(): Promise<MediaStream>;
  close(): void;
  /** Set by the controller after open: reports a source fault that stops frame production. */
  onFailure?: ((message: string) => void) | null;
  /** Visibility: a source may pause synthetic frame production and its own clock. */
  setActive?(active: boolean): void;
  /** Optional raw-frame evaluation against known source truth. Called before buffers are recycled. */
  observeFrame?(frame: TrackingFrame): void;
  /** Optional processed-input observation (gesture classification) for the same capture time. */
  observeProcessed?(tCapture: number, hands: readonly HandCursor[]): void;
  /** Optional structured description for diagnostics export. */
  evidence?(): unknown;
}

export class WebcamSource implements CameraStreamSource {
  readonly kind = 'webcam' as const;
  readonly label = 'Camera';
  readonly lane = 'live-camera-unverified';
  async open(): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error(
        'Camera needs a secure browser context. Open the locally served app in current Chrome or Edge.',
      );
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          width: { ideal: CAM_REQ_W },
          height: { ideal: CAM_REQ_H },
          frameRate: { ideal: CAM_REQ_FPS, max: CAM_REQ_FPS },
          facingMode: 'user',
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'OverconstrainedError')
        return navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      throw error;
    }
  }
  close(): void {
    /* getUserMedia tracks are owned and stopped by the controller. */
  }
}
