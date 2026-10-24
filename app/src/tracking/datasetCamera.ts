/**
 * Sign Saber — tracking/datasetCamera.ts
 *
 * Responsibility: a labelled "dataset camera": a real MediaStream from canvas.captureStream()
 * whose frames come from a pluggable reel. From the stream onward the live path is unchanged
 * (video element, rVFC, ImageBitmap crop, worker, MediaPipe, calibration, judgement).
 * Spec: docs/05-tracking-pipeline.md §1.4; evidence lane `dataset-camera` in docs/24.
 * Inputs: a DatasetReel and an optional heard-song-time provider
 * Outputs: MediaStream frames; a bounded draw timeline used to attribute captures to known truth
 *
 * This is never webcam evidence: still photos or rendered performers are not a person in front of a camera.
 */
import type { HandCursor, TrackingFrame } from '../core/types';
import { CAM_REQ_FPS, CAM_REQ_H, CAM_REQ_W, DATASET_CAMERA_TIMELINE_CAPACITY } from '../core/constants';
import type { CameraStreamSource } from './cameraSource';
import { DatasetCameraEvaluator, type ReelTruth } from './datasetCameraEval';

export const DATASET_CAMERA_LABEL = 'Dataset camera — not a webcam';

export interface ReelClock {
  /** Milliseconds the dataset camera has been actively streaming (hidden intervals excluded). */
  readonly streamMs: number;
  /** Heard song time while a session is armed, playing or paused; otherwise null. */
  readonly songTimeMs: number | null;
}

/**
 * Pluggable frame producer. A photo reel draws still dataset photos; a later performer reel can
 * render a posed avatar for the same clock. `render` draws exactly one complete 16:9 frame and
 * returns the truth it depicts (or null when none is known).
 */
export interface DatasetReel {
  readonly kind: string;
  /** Captures inside this window after a truth change are not attributed to either truth. */
  readonly transitionGuardMs: number;
  prepare(signal: AbortSignal): Promise<void>;
  render(ctx: CanvasRenderingContext2D, width: number, height: number, clock: ReelClock): ReelTruth | null;
  describe(): Record<string, unknown>;
  dispose(): void;
}

/** Bounded ring of (first-drawn time, truth) transitions in the main performance timeline. */
export class DrawTimeline {
  private readonly times: Float64Array;
  private readonly truths: (ReelTruth | null)[];
  private cursor = 0;
  private size = 0;
  overwritten = 0;
  constructor(readonly capacity = DATASET_CAMERA_TIMELINE_CAPACITY) {
    this.times = new Float64Array(capacity);
    this.truths = new Array<ReelTruth | null>(capacity).fill(null);
  }
  get length(): number {
    return this.size;
  }
  /** Records a transition only when the drawn truth object changes. */
  record(time: number, truth: ReelTruth | null): void {
    if (this.size) {
      const last = (this.cursor - 1 + this.capacity) % this.capacity;
      if (this.truths[last] === truth) return;
      if (time < this.times[last]!) throw new RangeError('Dataset camera draw time ran backwards');
    }
    if (this.size === this.capacity) this.overwritten++;
    this.times[this.cursor] = time;
    this.truths[this.cursor] = truth;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.size = Math.min(this.capacity, this.size + 1);
  }
  /** Truth visible for a capture at `time`, or null before history, inside a guard band, or unknown. */
  at(time: number, guardMs: number): ReelTruth | null {
    for (let k = 1; k <= this.size; k++) {
      const index = (this.cursor - k + this.capacity) % this.capacity;
      if (this.times[index]! <= time) return time - this.times[index]! < guardMs ? null : this.truths[index]!;
    }
    return null;
  }
  clear(): void {
    this.cursor = this.size = 0;
    this.truths.fill(null);
  }
}

export class DatasetCameraSource implements CameraStreamSource {
  readonly kind = 'dataset' as const;
  readonly label = DATASET_CAMERA_LABEL;
  readonly lane = 'dataset-camera';
  readonly timeline = new DrawTimeline();
  readonly evaluator = new DatasetCameraEvaluator();
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private abort: AbortController | null = null;
  private activeSince = 0;
  private accumulatedMs = 0;
  private active = false;
  private closed = false;
  private paintError: string | null = null;
  onFailure: ((message: string) => void) | null = null;
  framesPainted = 0;
  constructor(
    readonly reel: DatasetReel,
    private readonly songTime: () => number | null = () => null,
    private readonly now: () => number = () => performance.now(),
  ) {}
  get streamMs(): number {
    return this.accumulatedMs + (this.active ? this.now() - this.activeSince : 0);
  }
  async open(): Promise<MediaStream> {
    if (this.closed || this.abort) throw new Error('This dataset camera source was already used.');
    const abort = (this.abort = new AbortController());
    await this.reel.prepare(abort.signal);
    if (abort.signal.aborted || this.closed) throw new Error('Dataset camera setup cancelled.');
    const canvas = document.createElement('canvas');
    canvas.width = CAM_REQ_W;
    canvas.height = CAM_REQ_H;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx || typeof canvas.captureStream !== 'function')
      throw new Error('This browser cannot stream a canvas as a camera. Use current Chrome or Edge.');
    this.canvas = canvas;
    this.ctx = ctx;
    this.activeSince = this.now();
    this.active = true;
    this.paint();
    const stream = canvas.captureStream(CAM_REQ_FPS);
    this.startTimer();
    return stream;
  }
  setActive(active: boolean): void {
    if (this.closed || !this.canvas || active === this.active) return;
    if (active) {
      this.activeSince = this.now();
      this.active = true;
      this.startTimer();
    } else {
      this.accumulatedMs += this.now() - this.activeSince;
      this.active = false;
      this.stopTimer();
    }
  }
  observeFrame(frame: TrackingFrame): void {
    this.evaluator.frame(this.timeline.at(frame.tCapture, this.reel.transitionGuardMs), frame);
  }
  observeProcessed(tCapture: number, hands: readonly HandCursor[]): void {
    this.evaluator.processed(this.timeline.at(tCapture, this.reel.transitionGuardMs), hands);
  }
  evidence(): Record<string, unknown> {
    return {
      label: this.label,
      lane: this.lane,
      webcam: false,
      reel: this.reel.describe(),
      canvas: { width: CAM_REQ_W, height: CAM_REQ_H, captureFps: CAM_REQ_FPS },
      framesPainted: this.framesPainted,
      streamMs: Math.round(this.streamMs),
      timelineTransitions: this.timeline.length,
      timelineOverwritten: this.timeline.overwritten,
      transitionGuardMs: this.reel.transitionGuardMs,
      paintError: this.paintError,
      evaluation: this.evaluator.summary(),
    };
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.abort?.abort();
    this.stopTimer();
    this.active = false;
    this.reel.dispose();
    if (this.canvas) this.canvas.width = this.canvas.height = 0;
    this.canvas = null;
    this.ctx = null;
  }
  private startTimer(): void {
    this.stopTimer();
    this.timer = setInterval(() => this.paint(), 1000 / CAM_REQ_FPS);
  }
  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
  private paint(): void {
    if (!this.ctx || !this.canvas || !this.active) return;
    try {
      const truth = this.reel.render(this.ctx, this.canvas.width, this.canvas.height, {
        streamMs: this.streamMs,
        songTimeMs: this.songTime(),
      });
      this.framesPainted++;
      this.timeline.record(this.now(), truth);
    } catch (error) {
      // A reel failure stops new frames and is reported as a camera failure, never hidden.
      this.paintError = error instanceof Error ? error.message : String(error);
      this.stopTimer();
      this.onFailure?.(`${DATASET_CAMERA_LABEL}: ${this.paintError}`);
    }
  }
}
