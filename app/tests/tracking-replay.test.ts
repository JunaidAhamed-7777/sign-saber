import { describe, expect, it } from 'vitest';
import {
  createAllowlistedReplay,
  hashTrackingFixture,
  parseTrackingFixture,
  ReplaySource,
  TrackingRecorder,
  validateTrackingFixture,
  type TrackingFixture,
} from '../src/tracking/replay';
import { InputPipeline } from '../src/tracking/pipeline';
import { TRACK_RECORD_MAX_BYTES, TRACK_RECORD_MS } from '../src/core/constants';
import { syntheticFrame } from './tracking-fixtures';
function fixture(): TrackingFixture {
  return createAllowlistedReplay('synthetic-open', 1000, true)!.fixture;
}
describe('logic replay, separate from live-camera evidence', () => {
  it('only loads allowlisted local names in development and never synthesizes camera calibration', () => {
    expect(createAllowlistedReplay('synthetic-open', 1000, false)).toBeNull();
    for (const name of ['../../private', 'https://example.com/input.json', 'other'])
      expect(createAllowlistedReplay(name, 1000, true)).toBeNull();
    const replay = createAllowlistedReplay('synthetic-open', 1000, true)!;
    const pipeline = new InputPipeline();
    replay.advance(4000, (frame, arrival) => pipeline.process(frame, arrival, 'replay'));
    expect(pipeline.result.body.present).toBe(false);
    expect(pipeline.calibration).toBeNull();
    expect(pipeline.result.calibrationReady).toBe(false);
    expect(replay.source).toBe('replay');
  });
  it('rebases capture, inference completion and simulated delivery without using JSON load/render time', () => {
    const f = fixture();
    const replay = new ReplaySource(f, 123456);
    const records: number[][] = [];
    replay.advance(123456 + 10000, (frame, arrival) =>
      records.push([frame.seq, frame.tCapture, frame.tInferDone, arrival, frame.inferenceMs]),
    );
    expect(records[0]).toEqual([0, 123456, 123466, 123476, 10]);
    expect(records).toHaveLength(f.frames.length);
    expect(replay.finished).toBe(true);
    expect(
      replay.advance(200000, () => {
        throw new Error('Must not replay twice');
      }),
    ).toBe(0);
  });
  it('drains identical accepted samples at 30/60/120Hz and across a render stall', () => {
    const run = (hz: number, stalled: boolean) => {
      const replay = new ReplaySource(fixture(), 1000);
      const pipeline = new InputPipeline();
      const trace: unknown[] = [];
      for (let elapsed = 0; elapsed <= 2200; elapsed += 1000 / hz) {
        if (stalled && elapsed > 450 && elapsed < 1150) continue;
        replay.advance(1000 + elapsed, (frame, arrival) => {
          const result = pipeline.process(frame, arrival, 'replay');
          expect(result).not.toBeNull();
          trace.push([
            frame.seq,
            frame.tCapture,
            result!.hands[1]!.gesture,
            result!.hands[1]!.pos.x,
            result!.hands[1]!.speed,
            result!.hands[1]!.bladeActive,
          ]);
        });
      }
      expect(replay.finished).toBe(true);
      return trace;
    };
    const reference = run(30, false);
    for (const hz of [30, 60, 120]) {
      expect(run(hz, false)).toEqual(reference);
      expect(run(hz, true)).toEqual(reference);
    }
  });
  it.each([
    'duplicate-seq',
    'reversed-time',
    'arrival-before-infer',
    'nan',
    'wrong-length',
    'mask',
    'version',
  ] as const)('rejects %s fixtures before replay', (corruption) => {
    const f = fixture();
    if (corruption === 'duplicate-seq') f.frames[1]!.seq = 0;
    if (corruption === 'reversed-time') f.frames[1]!.tCapture = -1;
    if (corruption === 'arrival-before-infer') f.frames[1]!.tArrival = 0;
    if (corruption === 'nan') f.frames[1]!.hands[0]!.landmarks[0] = NaN;
    if (corruption === 'wrong-length') f.frames[0]!.hands[0]!.worldLandmarks.pop();
    if (corruption === 'mask') Object.assign(f.frames[0]!, { mask: { width: 1, height: 1, data: [255] } });
    if (corruption === 'version') Object.assign(f, { version: 2 });
    expect(validateTrackingFixture(f).length).toBeGreaterThan(0);
    expect(() => new ReplaySource(f, 1000)).toThrow();
  });
  it('hashes canonical fixture data and scales the whole simulation clock for inspection', async () => {
    expect(await hashTrackingFixture(fixture())).toMatch(/^[a-f0-9]{64}$/);
    expect(await hashTrackingFixture(fixture())).toBe(await hashTrackingFixture(fixture()));
    const replay = new ReplaySource(fixture(), 1000, 0.25);
    expect(replay.simulationTime(5000)).toBe(2000);
    replay.advance(5000, () => {});
    expect(replay.finished).toBe(false);
    expect(() => replay.advance(4999, () => {})).toThrow('monotonic');
  });
  it('records only after explicit opt-in/consent, strips pixels/device identifiers and bounds time', () => {
    const options = {
      optIn: true as const,
      consented: true as const,
      camera: { width: 1280, height: 720, fps: 30 },
      timestampSource: 'callback-receipt' as const,
    };
    expect(() => new TrackingRecorder(false).start(options, 1000)).toThrow('dev-only');
    const recorder = new TrackingRecorder(true);
    recorder.start(options, 1000);
    const frame = syntheticFrame(1, 1010);
    frame.mask = { width: 1, height: 1, data: new Uint8Array([255]) };
    expect(recorder.record(frame, 1040)).toBe(true);
    expect(recorder.record(frame, 1050)).toBe(false);
    const invalid = syntheticFrame(2, 1040);
    invalid.hands[0]!.landmarks[0] = NaN;
    expect(recorder.record(invalid, 1070)).toBe(false);
    recorder.tick(1000 + TRACK_RECORD_MS);
    expect(recorder.active).toBe(false);
    expect(recorder.stopReason).toBe('time-limit');
    const recorded = recorder.finish();
    expect(recorded.frames[0]!.tCapture).toBe(0);
    expect(recorded.frames[0]!.tInferDone).toBe(20);
    expect(recorded.frames[0]!.tArrival).toBe(30);
    expect(JSON.stringify(recorded)).not.toContain('mask');
    expect(recorded.source).toBe('consented-recording');
    expect(parseTrackingFixture(recorded)).toEqual(recorded);
  });
  it('stops before the byte/frame cap and reports actual contents rather than inventing 20 seconds', () => {
    const recorder = new TrackingRecorder(true);
    recorder.start(
      {
        optIn: true,
        consented: true,
        camera: { width: 1280, height: 720, fps: 30 },
        timestampSource: 'capture',
      },
      0,
    );
    for (let i = 0; i < 2000 && recorder.active; i++) recorder.record(syntheticFrame(i, i * 5), i * 5 + 30);
    expect(['size-limit', 'frame-limit']).toContain(recorder.stopReason);
    const result = recorder.finish();
    expect(result.frames.length).toBeLessThanOrEqual(601);
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(
      TRACK_RECORD_MAX_BYTES,
    );
    expect(result.frames[result.frames.length - 1]!.tCapture).toBeLessThan(TRACK_RECORD_MS);
  });
});
