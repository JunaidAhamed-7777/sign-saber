/** Dev/benchmark logic replay. Synthetic fixtures never establish webcam readiness. */
import type { BodyCalibration, Gesture, TrackingFrame } from '../core/types';
import { TRACK_RECORD_MS, TRACK_RECORD_MAX_BYTES, TRACK_TARGET_HZ } from '../core/constants';
import { sha256 } from '../utils/hash';
import { upperBodyFixturePose } from './upperBody';

export interface FixtureHand {
  handedness: 'left' | 'right';
  score: number;
  landmarks: number[];
  worldLandmarks: number[];
}
export interface FixtureFrame {
  seq: number;
  tCapture: number;
  tInferDone: number;
  tArrival: number;
  inferenceMs: number;
  hands: FixtureHand[];
  pose: { landmarks: number[]; worldLandmarks: number[] } | null;
}
export interface TrackingFixture {
  version: 1;
  name: string;
  recordedAt: string;
  source: 'synthetic' | 'consented-recording';
  seed: number;
  camera: { width: number; height: number; fps: number };
  timestampSource: 'capture' | 'callback-receipt';
  calibration?: BodyCalibration;
  labels?: { from: number; to: number; gesture: Gesture; hand: 'left' | 'right' }[];
  frames: FixtureFrame[];
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const vectorArray = (value: unknown, length: number): value is number[] =>
  Array.isArray(value) && value.length === length && value.every(finite);
const gestures = ['open', 'fist', 'point', 'none'];
const MAX_FIXTURE_FRAMES = Math.ceil((TRACK_TARGET_HZ * TRACK_RECORD_MS) / 1000) + 1;
export function validateTrackingFixture(value: unknown): string[] {
  const errors: string[] = [];
  if (!record(value)) return ['Fixture must be an object.'];
  if (value.version !== 1) errors.push('Unsupported tracking fixture version.');
  if (typeof value.name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.name))
    errors.push('Fixture name must be a logical slug.');
  if (
    typeof value.recordedAt !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value.recordedAt) ||
    !Number.isFinite(Date.parse(value.recordedAt))
  )
    errors.push('Fixture needs an ISO UTC date.');
  if (value.source !== 'synthetic' && value.source !== 'consented-recording')
    errors.push('Fixture must identify synthetic or consented recording provenance.');
  if (!Number.isInteger(value.seed) || !finite(value.seed) || value.seed < 0 || value.seed > 0xffffffff)
    errors.push('Fixture needs a fixed uint32 seed.');
  if (
    !record(value.camera) ||
    !finite(value.camera.width) ||
    value.camera.width <= 0 ||
    !finite(value.camera.height) ||
    value.camera.height <= 0 ||
    !finite(value.camera.fps) ||
    value.camera.fps <= 0
  )
    errors.push('Fixture camera dimensions/rate must be positive.');
  if (value.timestampSource !== 'capture' && value.timestampSource !== 'callback-receipt')
    errors.push('Fixture needs its timestamp source.');
  if (value.calibration !== undefined) {
    const c = value.calibration;
    if (
      !record(c) ||
      !finite(c.centerX) ||
      !finite(c.shoulderWidthNorm) ||
      c.shoulderWidthNorm <= 0 ||
      !finite(c.headY) ||
      !finite(c.physicalScale) ||
      c.physicalScale <= 0 ||
      !finite(c.capturedAt) ||
      typeof c.identity !== 'string'
    )
      errors.push('Invalid fixture calibration.');
  }
  if (
    value.labels !== undefined &&
    (!Array.isArray(value.labels) ||
      value.labels.some(
        (l) =>
          !record(l) ||
          !Number.isInteger(l.from) ||
          !Number.isInteger(l.to) ||
          !finite(l.from) ||
          !finite(l.to) ||
          l.to < l.from ||
          !gestures.includes(String(l.gesture)) ||
          (l.hand !== 'left' && l.hand !== 'right'),
      ))
  )
    errors.push('Invalid fixture labels.');
  if (!Array.isArray(value.frames) || !value.frames.length)
    return [...errors, 'Fixture needs capture records.'];
  if (value.frames.length > MAX_FIXTURE_FRAMES)
    return [...errors, 'Fixture exceeds the bounded record count.'];
  let seq = -1;
  let capture = -Infinity;
  let arrival = -Infinity;
  let inference = -Infinity;
  for (let i = 0; i < value.frames.length; i++) {
    const f = value.frames[i];
    const fail = (message: string) => errors.push(`Frame ${i}: ${message}`);
    if (!record(f)) {
      fail('must be an object');
      continue;
    }
    if (!Number.isInteger(f.seq) || !finite(f.seq) || f.seq <= seq)
      fail('sequence must increase exactly once per sample');
    if (!finite(f.tCapture) || f.tCapture < 0 || f.tCapture <= capture || (i === 0 && f.tCapture !== 0))
      fail('capture times must increase from relative zero');
    if (!finite(f.tInferDone) || !finite(f.tCapture) || f.tInferDone < f.tCapture || f.tInferDone < inference)
      fail('inference completion precedes capture or an earlier completion');
    if (!finite(f.tArrival) || !finite(f.tInferDone) || f.tArrival < f.tInferDone || f.tArrival < arrival)
      fail('arrival timestamps must preserve processing and delivery order');
    if (!finite(f.inferenceMs) || f.inferenceMs < 0)
      fail('needs actual or explicitly simulated inference duration');
    if (f.mask !== undefined && f.mask !== null) fail('fixtures must not contain masks or camera pixels');
    if (!Array.isArray(f.hands) || f.hands.length > 2) fail('invalid hand collection');
    else
      for (const h of f.hands)
        if (
          !record(h) ||
          (h.handedness !== 'left' && h.handedness !== 'right') ||
          !finite(h.score) ||
          h.score < 0 ||
          h.score > 1 ||
          !vectorArray(h.landmarks, 63) ||
          !vectorArray(h.worldLandmarks, 63)
        )
          fail('invalid hand identity, confidence or landmarks');
    if (
      f.pose !== null &&
      (!record(f.pose) || !vectorArray(f.pose.landmarks, 132) || !vectorArray(f.pose.worldLandmarks, 99))
    )
      fail('invalid pose');
    if (finite(f.seq)) seq = f.seq;
    if (finite(f.tCapture)) capture = f.tCapture;
    if (finite(f.tArrival)) arrival = f.tArrival;
    if (finite(f.tInferDone)) inference = f.tInferDone;
  }
  return errors;
}
function sanitizeFixture(fixture: TrackingFixture): TrackingFixture {
  const copy: TrackingFixture = {
    version: 1,
    name: fixture.name,
    recordedAt: fixture.recordedAt,
    source: fixture.source,
    seed: fixture.seed,
    camera: { width: fixture.camera.width, height: fixture.camera.height, fps: fixture.camera.fps },
    timestampSource: fixture.timestampSource,
    frames: fixture.frames.map((f) => ({
      seq: f.seq,
      tCapture: f.tCapture,
      tInferDone: f.tInferDone,
      tArrival: f.tArrival,
      inferenceMs: f.inferenceMs,
      hands: f.hands.map((h) => ({
        handedness: h.handedness,
        score: h.score,
        landmarks: [...h.landmarks],
        worldLandmarks: [...h.worldLandmarks],
      })),
      pose: f.pose ? upperBodyFixturePose(f.pose) : null,
    })),
  };
  if (fixture.calibration) {
    const c = fixture.calibration;
    copy.calibration = {
      centerX: c.centerX,
      shoulderWidthNorm: c.shoulderWidthNorm,
      headY: c.headY,
      physicalScale: c.physicalScale,
      capturedAt: c.capturedAt,
      identity: c.identity,
    };
  }
  if (fixture.labels)
    copy.labels = fixture.labels.map((l) => ({ from: l.from, to: l.to, gesture: l.gesture, hand: l.hand }));
  return copy;
}
export function parseTrackingFixture(value: unknown): TrackingFixture {
  const errors = validateTrackingFixture(value);
  if (errors.length) throw new Error(errors.join('\n'));
  return sanitizeFixture(value as TrackingFixture);
}
/** Hash is canonical schema data, not the whitespace/field order of a source JSON file. */
export async function hashTrackingFixture(fixture: TrackingFixture): Promise<string> {
  return sha256(new TextEncoder().encode(JSON.stringify(parseTrackingFixture(fixture))));
}

export class ReplaySource {
  readonly source = 'replay' as const;
  readonly fixture: TrackingFixture;
  private frames: TrackingFrame[];
  private arrivals: Float64Array;
  private next = 0;
  private lastAdvance = -Infinity;
  constructor(
    fixture: TrackingFixture,
    readonly origin: number,
    readonly speed = 1,
  ) {
    if (!finite(origin) || ![0.25, 0.5, 1].includes(speed))
      throw new Error('Invalid replay origin or inspection speed.');
    this.fixture = parseTrackingFixture(fixture);
    this.arrivals = Float64Array.from(this.fixture.frames, (f) => origin + f.tArrival);
    this.frames = this.fixture.frames.map((f) => ({
      seq: f.seq,
      tCapture: origin + f.tCapture,
      tInferDone: origin + f.tInferDone,
      inferenceMs: f.inferenceMs,
      hands: f.hands.map((h) => ({
        handedness: h.handedness,
        score: h.score,
        landmarks: new Float32Array(h.landmarks),
        worldLandmarks: new Float32Array(h.worldLandmarks),
      })),
      pose: f.pose
        ? {
            landmarks: new Float32Array(f.pose.landmarks),
            worldLandmarks: new Float32Array(f.pose.worldLandmarks),
          }
        : null,
      mask: null,
    }));
  }
  get finished(): boolean {
    return this.next === this.frames.length;
  }
  get consumed(): number {
    return this.next;
  }
  simulationTime(now: number): number {
    return this.origin + (now - this.origin) * this.speed;
  }
  /** Drain every due record; callback arrival is simulated delivery, never rAF receipt time. */
  advance(now: number, onFrame: (frame: TrackingFrame, arrivalTime: number) => void): number {
    if (!finite(now) || now < this.lastAdvance) throw new Error('Replay time must be finite and monotonic.');
    this.lastAdvance = now;
    const simulatedNow = this.simulationTime(now);
    let count = 0;
    while (this.next < this.frames.length) {
      const arrival = this.arrivals[this.next]!;
      if (arrival > simulatedNow) break;
      const frame = this.frames[this.next]!;
      this.next++;
      count++;
      onFrame(frame, arrival);
    }
    return count;
  }
  calibration(): BodyCalibration | null {
    const c = this.fixture.calibration;
    return c
      ? { ...c, capturedAt: this.origin + c.capturedAt, identity: `replay:${this.fixture.name}` }
      : null;
  }
}
/** Fixed generated geometry for a logic fixture; no person, pose, mask or webcam. */
function syntheticOpenFixture(): TrackingFixture {
  const frames: FixtureFrame[] = [];
  let seed = 0x53414245;
  for (let seq = 0; seq <= 60; seq++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const xOffset = Math.sin((seq * Math.PI) / 15) * 0.16 + (seed / 2 ** 32 - 0.5) * 0.0001;
    const landmarks = new Array<number>(63).fill(0);
    const worldLandmarks = new Array<number>(63).fill(0);
    const set = (index: number, x: number, y: number, worldY: number) => {
      landmarks[index * 3] = Math.fround(x + xOffset);
      landmarks[index * 3 + 1] = Math.fround(y);
      worldLandmarks[index * 3] = Math.fround((x - 0.5) * 0.2);
      worldLandmarks[index * 3 + 1] = Math.fround(worldY);
    };
    set(0, 0.5, 0.7, 0);
    for (let i = 1; i <= 4; i++) set(i, 0.3, 0.55, 0.03);
    for (let finger = 0; finger < 4; finger++) {
      const i = 5 + finger * 4;
      const x = 0.44 + finger * 0.04;
      set(i, x, 0.55, 0.03);
      set(i + 1, x, 0.43, 0.05);
      set(i + 2, x, 0.36, 0.07);
      set(i + 3, x, 0.3, 0.09);
    }
    const t = (seq * 1000) / 30;
    frames.push({
      seq,
      tCapture: t,
      tInferDone: t + 10,
      tArrival: t + 20,
      inferenceMs: 10,
      hands: [{ handedness: 'right', score: 1, landmarks, worldLandmarks }],
      pose: null,
    });
  }
  return {
    version: 1,
    name: 'synthetic-open',
    recordedAt: '2026-10-24T19:06:09.000Z',
    source: 'synthetic',
    seed: 0x53414245,
    camera: { width: 640, height: 360, fps: 30 },
    timestampSource: 'callback-receipt',
    labels: [{ from: 0, to: 60, gesture: 'open', hand: 'right' }],
    frames,
  };
}
export const REPLAY_FIXTURE_NAMES = ['synthetic-open'] as const;
/** Only this loader is used by app flags. No file path, URL or arbitrary fixture lookup. */
export function createAllowlistedReplay(
  name: string,
  origin: number,
  development = import.meta.env.DEV,
  speed = 1,
): ReplaySource | null {
  if (!development || name !== 'synthetic-open') return null;
  return new ReplaySource(syntheticOpenFixture(), origin, speed);
}

export interface RecordingOptions {
  optIn: true;
  consented: true;
  camera: TrackingFixture['camera'];
  timestampSource: TrackingFixture['timestampSource'];
  calibration?: BodyCalibration;
}
export type RecordingStopReason = 'manual' | 'time-limit' | 'size-limit' | 'frame-limit';
/** Explicit, bounded dev-only landmark recording. Masks and device identifiers are excluded. */
export class TrackingRecorder {
  active = false;
  stopReason: RecordingStopReason | null = null;
  private startedAt = 0;
  private origin = Number.NaN;
  private bytes = 0;
  private options: RecordingOptions | null = null;
  private frames: FixtureFrame[] = [];
  private recordedAt = '';
  private maximumFrames = MAX_FIXTURE_FRAMES;
  constructor(private development = import.meta.env.DEV) {}
  start(options: RecordingOptions, now: number): void {
    if (!this.development || options.optIn !== true || options.consented !== true || !finite(now))
      throw new Error('Recording requires explicit dev-only opt-in and participant consent.');
    if (
      !finite(options.camera.width) ||
      options.camera.width <= 0 ||
      !finite(options.camera.height) ||
      options.camera.height <= 0 ||
      !finite(options.camera.fps) ||
      options.camera.fps <= 0 ||
      !['capture', 'callback-receipt'].includes(options.timestampSource)
    )
      throw new Error('Recording requires actual camera dimensions, rate and timestamp source.');
    this.startedAt = now;
    this.origin = NaN;
    this.frames = [];
    this.stopReason = null;
    this.options = structuredClone(options);
    this.recordedAt = new Date().toISOString();
    // Bound export metadata exactly, reserving the longest finite Float64 timestamp.
    this.bytes = new TextEncoder().encode(JSON.stringify(this.makeFixture([], -Number.MAX_VALUE))).byteLength;
    this.active = true;
  }
  tick(now: number): void {
    if (this.active && now - this.startedAt >= TRACK_RECORD_MS) {
      this.active = false;
      this.stopReason = 'time-limit';
    }
  }
  record(frame: TrackingFrame, arrivalTime: number): boolean {
    this.tick(arrivalTime);
    if (
      !this.active ||
      !Number.isInteger(frame.seq) ||
      frame.seq < 0 ||
      frame.tCapture < this.startedAt ||
      !finite(arrivalTime) ||
      arrivalTime < frame.tInferDone ||
      frame.tCapture > frame.tInferDone
    )
      return false;
    const previous = this.frames[this.frames.length - 1];
    if (
      previous &&
      (frame.seq <= previous.seq ||
        frame.tCapture <= this.origin + previous.tCapture ||
        arrivalTime < this.origin + previous.tArrival)
    )
      return false;
    if (!finite(this.origin)) this.origin = frame.tCapture;
    const f: FixtureFrame = {
      seq: frame.seq,
      tCapture: frame.tCapture - this.origin,
      tInferDone: frame.tInferDone - this.origin,
      tArrival: arrivalTime - this.origin,
      inferenceMs: frame.inferenceMs,
      hands: frame.hands.map((h) => ({
        handedness: h.handedness,
        score: h.score,
        landmarks: Array.from(h.landmarks),
        worldLandmarks: Array.from(h.worldLandmarks),
      })),
      pose: frame.pose ? upperBodyFixturePose(frame.pose) : null,
    };
    if (
      !finite(f.tCapture) ||
      !finite(f.tInferDone) ||
      !finite(f.inferenceMs) ||
      f.inferenceMs < 0 ||
      f.hands.length > 2 ||
      f.hands.some(
        (h) =>
          !finite(h.score) ||
          h.score < 0 ||
          h.score > 1 ||
          !vectorArray(h.landmarks, 63) ||
          !vectorArray(h.worldLandmarks, 63),
      ) ||
      (f.pose && (!vectorArray(f.pose.landmarks, 132) || !vectorArray(f.pose.worldLandmarks, 99)))
    )
      return false;
    const size = new TextEncoder().encode(JSON.stringify(f)).byteLength;
    if (this.bytes + size + 1 > TRACK_RECORD_MAX_BYTES) {
      this.active = false;
      this.stopReason = 'size-limit';
      return false;
    }
    if (this.frames.length >= this.maximumFrames) {
      this.active = false;
      this.stopReason = 'frame-limit';
      return false;
    }
    this.frames.push(f);
    this.bytes += size + 1;
    return true;
  }
  finish(): TrackingFixture {
    this.active = false;
    this.stopReason ??= 'manual';
    const o = this.options;
    if (!o || !this.frames.length) throw new Error('No consented tracking samples were recorded.');
    return parseTrackingFixture(
      this.makeFixture(this.frames, o.calibration ? o.calibration.capturedAt - this.origin : 0),
    );
  }
  download(): { fixture: TrackingFixture; stopReason: RecordingStopReason } {
    const fixture = this.finish();
    const text = JSON.stringify(fixture);
    if (new TextEncoder().encode(text).byteLength > TRACK_RECORD_MAX_BYTES)
      throw new Error('Fixture exceeds the recording export size limit.');
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    try {
      const link = document.createElement('a');
      link.href = url;
      link.download = 'consented-landmarks.fixture.json';
      link.click();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
    return { fixture, stopReason: this.stopReason! };
  }
  private makeFixture(frames: FixtureFrame[], calibrationTime: number): TrackingFixture {
    const o = this.options!;
    const fixture: TrackingFixture = {
      version: 1,
      name: 'consented-landmarks',
      recordedAt: this.recordedAt,
      source: 'consented-recording',
      seed: 0,
      camera: { width: o.camera.width, height: o.camera.height, fps: o.camera.fps },
      timestampSource: o.timestampSource,
      frames,
    };
    if (o.calibration) {
      const c = o.calibration;
      fixture.calibration = {
        centerX: c.centerX,
        shoulderWidthNorm: c.shoulderWidthNorm,
        headY: c.headY,
        physicalScale: c.physicalScale,
        identity: 'consented-fixture-calibration',
        capturedAt: calibrationTime,
      };
    }
    return fixture;
  }
}
