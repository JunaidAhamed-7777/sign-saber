/**
 * Sign Saber — tracking/camera.ts
 *
 * Responsibility: one injectable MediaStream source (webcam by default, or the labelled dataset camera),
 * requestVideoFrameCallback capture, 16:9 centre-crop, ImageBitmap resize to INFER_W×INFER_H.
 * Spec: docs/05-tracking-pipeline.md §Camera capture, §1.4 Dataset camera
 * Inputs: CameraStreamSource → MediaStream
 * Outputs: ImageBitmap + tCapture per frame
 *
 * Implementation: bounded live/replay input; hardware acceptance remains separate from synthetic assertions.
 * Only stream acquisition varies by source; video, worker, models, calibration and scoring are shared.
 */
import type { HandCursor, TrackingFrame } from '../core/types';
import { TRACK_STALL_MS, TRACK_FIRST_RESULT_TIMEOUT_MS, INPUT_MAX_AGE_MS } from '../core/constants';
import { TrackingClient } from './workerClient';
import { WebcamSource, type CameraStreamSource } from './cameraSource';
export function cameraError(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Camera permission was denied. Allow the camera in browser site settings, then retry. Music browsing still works.';
  if (name === 'NotFoundError')
    return 'No camera found. Connect a webcam and retry. Music browsing still works.';
  if (name === 'NotReadableError') return 'The camera is busy. Close other apps using it, then retry.';
  return error instanceof Error
    ? error.message
    : 'Camera setup failed. Retry with current Chrome or Edge on localhost.';
}
export class CameraController {
  readonly client = new TrackingClient();
  private generation = 0;
  private stream: MediaStream | null = null;
  private source: CameraStreamSource | null = null;
  private video: HTMLVideoElement | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private lastResult = 0;
  private captureVisible = true;
  identity = '';
  settings: MediaTrackSettings | null = null;
  get stats() {
    return this.client.stats;
  }
  async start(
    video: HTMLVideoElement,
    onFrame: (frame: TrackingFrame) => void,
    onError: (message: string) => void,
    onStatus: (message: string) => void = () => {},
    source: CameraStreamSource = new WebcamSource(),
  ): Promise<void> {
    this.stop();
    const generation = ++this.generation;
    this.source = source;
    const dataset = source.kind === 'dataset';
    const label = (message: string) => (dataset ? `${message} · ${source.label}` : message);
    try {
      onStatus(dataset ? `Starting ${source.label}` : 'Waiting for camera permission');
      let stream: MediaStream;
      try {
        stream = await source.open();
      } catch (error) {
        if (generation !== this.generation) {
          source.close();
          return;
        }
        throw error;
      }
      if (generation !== this.generation) {
        for (const track of stream.getTracks()) track.stop();
        source.close();
        return;
      }
      this.stream = stream;
      this.video = video;
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
      if (generation !== this.generation) return;
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error('The camera returned no video track.');
      this.settings = track.getSettings();
      this.identity = JSON.stringify({
        source: source.lane,
        deviceId: this.settings.deviceId,
        width: video.videoWidth,
        height: video.videoHeight,
        crop: 'center-16:9',
        mapping: 'raw-selfie-swap-v1',
        player: generation,
      });
      const fail = (message: string) => {
        if (generation !== this.generation) return;
        this.client.stats.phaseAtFailure = this.client.stats.phase;
        this.stop();
        onError(message);
      };
      track.onended = () => fail('Camera disconnected or permission was revoked. Set up camera again.');
      source.onFailure = fail;
      const width = video.videoWidth;
      const height = video.videoHeight;
      this.lastResult = performance.now();
      let previewAnnounced = false;
      onStatus(label('Loading local tracking models'));
      await this.client.initialize((frame) => {
        if (generation !== this.generation) return;
        if (video.videoWidth !== width || video.videoHeight !== height) {
          fail('Camera framing changed. Set up camera again.');
          return;
        }
        this.lastResult = performance.now();
        if (!previewAnnounced && this.lastResult - frame.tCapture <= INPUT_MAX_AGE_MS) {
          onStatus(label(`Camera setup preview · ${this.stats.delegate} tracking`));
          previewAnnounced = true;
        }
        source.observeFrame?.(frame);
        onFrame(frame);
      }, fail);
      if (generation !== this.generation) return;
      onStatus(label(`Preparing the first camera sample · ${this.stats.delegate} tracking`));
      this.client.start(video);
      this.captureVisible = !document.hidden;
      source.setActive?.(this.captureVisible);
      if (!this.captureVisible) this.client.pauseCapture();
      this.lastResult = performance.now();
      this.watchdog = setInterval(() => {
        // First GPU execution can compile shaders. This is setup work, never
        // readiness or scoring evidence. Afterwards keep the strict stall bound.
        const firstSubmittedResult = this.client.stats.returned === 0 && this.client.stats.submitted > 0;
        const deadline = firstSubmittedResult ? TRACK_FIRST_RESULT_TIMEOUT_MS : TRACK_STALL_MS;
        if (this.captureVisible && !document.hidden && performance.now() - this.lastResult >= deadline) {
          console.error('[Sign Saber tracking watchdog]', JSON.stringify(this.client.stats));
          fail(
            label(
              this.client.stats.cameraCallbacks === 0
                ? 'The camera is not delivering video frames. Reconnect it or retry camera setup.'
                : 'Tracking stopped producing frames. Retry camera setup.',
            ),
          );
        }
      }, TRACK_STALL_MS);
    } catch (error) {
      if (generation !== this.generation) return;
      const message = cameraError(error);
      this.stop();
      throw new Error(message, { cause: error });
    }
  }
  /** Current source kind, or null when no camera is running. */
  get sourceKind(): CameraStreamSource['kind'] | null {
    return this.source?.kind ?? null;
  }
  get sourceLane(): string | null {
    return this.source?.lane ?? null;
  }
  /** Processed gesture output for a capture, forwarded to sources that know their truth. */
  observeProcessed(tCapture: number, hands: readonly HandCursor[]): void {
    this.source?.observeProcessed?.(tCapture, hands);
  }
  sourceEvidence(): unknown {
    return this.source?.evidence?.() ?? null;
  }
  setCaptureVisible(visible: boolean): void {
    this.captureVisible = visible;
    this.source?.setActive?.(visible);
    if (!this.video || !this.stream || !this.identity) return;
    if (!visible) this.client.pauseCapture();
    else {
      // A hidden interval is not inference latency. Give the resumed pipeline a full deadline.
      this.lastResult = performance.now();
      this.client.start(this.video);
    }
  }
  stop(): void {
    this.generation++;
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
    this.client.dispose();
    if (this.source) {
      this.source.onFailure = null;
      this.source.close();
    }
    this.source = null;
    for (const track of this.stream?.getTracks() ?? []) {
      track.onended = null;
      track.stop();
    }
    this.stream = null;
    if (this.video) {
      this.video.pause();
      this.video.srcObject = null;
    }
    this.video = null;
    this.identity = '';
    this.settings = null;
  }
}
