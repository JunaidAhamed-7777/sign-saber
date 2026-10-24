/**
 * Sign Saber — tracking/workerClient.ts
 *
 * Responsibility: Main-thread wrapper around the worker: protocol typing, buffer ring, latest-frame access, latency stats.
 * Spec: docs/05-tracking-pipeline.md §Worker protocol
 * Inputs: Worker messages
 * Outputs: TrackingFrame | null per render frame
 *
 * Implementation: bounded live/replay input; hardware acceptance remains separate from synthetic assertions.
 */
import type { TrackingFrame } from '../core/types';
import {
  INFER_W,
  INFER_H,
  TRACK_TARGET_HZ,
  TRACK_RATE_TOLERANCE_MS,
  TRACK_STALL_MS,
  TRACK_STATS_WINDOW,
} from '../core/constants';
import { trackingTransfers, type FromTrackingWorker, type ToTrackingWorker } from './protocol';
export interface TrackingStats {
  hz: number;
  initMs: number;
  inferenceMs: number;
  mainToMainMs: number;
  dropped: number;
  delegate: string;
  timestampSource: 'capture' | 'callback-receipt';
  opportunities: number;
  skippedBusy: number;
  submitted: number;
  returned: number;
  initializationError: string | null;
  phase: 'stopped' | 'initializing' | 'waiting-frame' | 'bitmap' | 'worker' | 'result';
  cameraCallbacks: number;
  bitmapsCreated: number;
  lastCaptureAt: number;
  lastBitmapAt: number;
  lastSubmitAt: number;
  lastResultAt: number;
  phaseAtFailure: string | null;
}
export function cameraCrop(
  width: number,
  height: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const sw = Math.min(width, (height * 16) / 9);
  const sh = Math.min(height, (width * 9) / 16);
  return { sx: (width - sw) / 2, sy: (height - sh) / 2, sw, sh };
}
export class TrackingClient {
  latest: TrackingFrame | null = null;
  readonly stats: TrackingStats = {
    hz: 0,
    initMs: 0,
    inferenceMs: 0,
    mainToMainMs: 0,
    dropped: 0,
    delegate: '',
    timestampSource: 'callback-receipt',
    opportunities: 0,
    skippedBusy: 0,
    submitted: 0,
    returned: 0,
    initializationError: null,
    phase: 'stopped',
    cameraCallbacks: 0,
    bitmapsCreated: 0,
    lastCaptureAt: 0,
    lastBitmapAt: 0,
    lastSubmitAt: 0,
    lastResultAt: 0,
    phaseAtFailure: null,
  };
  private worker: Worker | null = null;
  private video: HTMLVideoElement | null = null;
  private callback = 0;
  private generation = 0;
  private captureGeneration = 0;
  private inFlight = false;
  private seq = 0;
  private lastSent = -Infinity;
  private lastResult = 0;
  private readyReject: ((error: Error) => void) | null = null;
  private onFrame: (frame: TrackingFrame) => void = () => {};
  private onError: (message: string) => void = () => {};
  async initialize(
    onFrame: (frame: TrackingFrame) => void,
    onError: (message: string) => void,
  ): Promise<void> {
    this.dispose();
    const generation = ++this.generation;
    this.onFrame = onFrame;
    this.onError = onError;
    Object.assign(this.stats, {
      hz: 0,
      initMs: 0,
      inferenceMs: 0,
      mainToMainMs: 0,
      dropped: 0,
      delegate: '',
      timestampSource: 'callback-receipt',
      opportunities: 0,
      skippedBusy: 0,
      submitted: 0,
      returned: 0,
      initializationError: null,
      phase: 'initializing',
      cameraCallbacks: 0,
      bitmapsCreated: 0,
      lastCaptureAt: 0,
      lastBitmapAt: 0,
      lastSubmitAt: 0,
      lastResultAt: 0,
      phaseAtFailure: null,
    });
    const worker = new Worker(new URL('./tracking.worker.ts', import.meta.url), { type: 'module' });
    this.worker = worker;
    return new Promise<void>((resolve, reject) => {
      this.readyReject = reject;
      worker.onerror = (event) => {
        if (generation !== this.generation) return;
        this.inFlight = false;
        this.stats.initializationError = event.message || 'Worker module failed before initialization.';
        this.stats.phaseAtFailure = this.stats.phase;
        console.error('[Sign Saber tracking initialization]', this.stats.initializationError);
        reject(
          new Error(
            'Tracking could not start. The host may need to prepare the local camera assets; retry camera setup.',
          ),
        );
        this.onError('Tracking worker stopped. Retry camera setup.');
      };
      worker.onmessage = (event: MessageEvent<FromTrackingWorker>) => {
        if (event.data.type === 'disposed') {
          worker.terminate();
          return;
        }
        if (generation !== this.generation) return;
        const message = event.data;
        if (message.type === 'ready') {
          this.stats.delegate = message.delegate;
          this.stats.initMs = message.initMs;
          this.readyReject = null;
          resolve();
        } else if (message.type === 'result') {
          this.inFlight = false;
          const now = performance.now();
          this.stats.phase = 'result';
          this.stats.lastResultAt = now;
          this.stats.returned++;
          this.stats.inferenceMs = message.frame.inferenceMs;
          this.stats.mainToMainMs = now - message.frame.tCapture;
          this.stats.dropped = message.dropped;
          const interval = now - this.lastResult;
          if (this.lastResult && interval > 0) {
            const hz = 1000 / interval;
            this.stats.hz = this.stats.hz
              ? this.stats.hz + ((hz - this.stats.hz) * 2) / (TRACK_STATS_WINDOW + 1)
              : hz;
          }
          this.lastResult = now;
          this.latest = message.frame;
          try {
            if (this.video && !document.hidden) this.onFrame(message.frame);
          } finally {
            this.latest = null;
            if (this.worker === worker)
              this.post({ type: 'recycle', buffers: message.buffers }, trackingTransfers(message.buffers));
          }
        } else if (message.type === 'error') {
          this.inFlight = false;
          this.stats.phaseAtFailure = this.stats.phase;
          if (message.where === 'init') {
            this.stats.initializationError = message.message;
            console.error('[Sign Saber tracking initialization]', message.message);
          }
          const messageText =
            message.where === 'init'
              ? 'Tracking models could not load. The host may need to prepare the local camera assets; retry camera setup.'
              : 'Camera tracking stopped. Retry camera setup.';
          reject(new Error(messageText));
          this.onError(messageText);
        } else if (message.type === 'dropped') this.inFlight = false;
      };
      this.post({ type: 'init', mainTimeOrigin: performance.timeOrigin });
    });
  }
  start(video: HTMLVideoElement): void {
    this.stop();
    this.video = video;
    this.stats.phase = 'waiting-frame';
    const generation = this.generation;
    const captureGeneration = ++this.captureGeneration;
    if (!video.requestVideoFrameCallback)
      throw new Error('This browser lacks camera frame callbacks. Use current Chrome or Edge.');
    const next: VideoFrameRequestCallback = (now, metadata) => {
      if (
        generation !== this.generation ||
        captureGeneration !== this.captureGeneration ||
        this.video !== video
      )
        return;
      this.callback = video.requestVideoFrameCallback(next);
      this.stats.cameraCallbacks++;
      if (document.hidden) return;
      this.stats.opportunities++;
      if (this.inFlight) {
        this.stats.skippedBusy++;
        return;
      }
      if (now - this.lastSent < 1000 / TRACK_TARGET_HZ - TRACK_RATE_TOLERANCE_MS) return;
      const optional = metadata as VideoFrameCallbackMetadata & { captureTime?: number };
      const hasCapture = Number.isFinite(optional.captureTime);
      const captureTime = hasCapture ? optional.captureTime! : now;
      this.stats.timestampSource = hasCapture ? 'capture' : 'callback-receipt';
      this.inFlight = true;
      this.stats.phase = 'bitmap';
      this.stats.lastCaptureAt = now;
      this.lastSent = now;
      const crop = cameraCrop(video.videoWidth, video.videoHeight);
      createImageBitmap(video, crop.sx, crop.sy, crop.sw, crop.sh, {
        resizeWidth: INFER_W,
        resizeHeight: INFER_H,
        resizeQuality: 'low',
      })
        .then((bitmap) => {
          this.stats.bitmapsCreated++;
          this.stats.lastBitmapAt = performance.now();
          if (
            generation !== this.generation ||
            captureGeneration !== this.captureGeneration ||
            this.video !== video
          ) {
            bitmap.close();
            if (generation === this.generation) this.inFlight = false;
            return;
          }
          try {
            this.post({ type: 'frame', bitmap, seq: this.seq++, tCapture: captureTime }, [bitmap]);
            this.stats.phase = 'worker';
            this.stats.lastSubmitAt = performance.now();
            this.stats.submitted++;
          } catch {
            bitmap.close();
            this.inFlight = false;
            this.onError('Camera frame transfer failed. Retry camera setup.');
          }
        })
        .catch(() => {
          if (generation === this.generation) {
            this.inFlight = false;
            if (captureGeneration === this.captureGeneration)
              this.onError('Camera frame capture failed. Retry camera setup.');
          }
        });
    };
    this.callback = video.requestVideoFrameCallback(next);
  }
  stop(): void {
    this.captureGeneration++;
    if (this.video) this.video.cancelVideoFrameCallback(this.callback);
    this.video = null;
    this.latest = null;
    this.stats.phase = 'stopped';
  }
  pauseCapture(): void {
    this.stop();
  }
  dispose(): void {
    this.stop();
    this.generation++;
    this.inFlight = false;
    this.lastSent = -Infinity;
    this.lastResult = 0;
    this.readyReject?.(new Error('Camera setup cancelled.'));
    this.readyReject = null;
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      worker.postMessage({ type: 'dispose' } satisfies ToTrackingWorker);
      setTimeout(() => worker.terminate(), TRACK_STALL_MS);
    }
  }
  private post(message: ToTrackingWorker, transfers: Transferable[] = []): void {
    if (!this.worker) throw new Error('Tracking worker is stopped');
    this.worker.postMessage(message, transfers);
  }
}
