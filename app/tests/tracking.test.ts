import { describe, expect, it } from 'vitest';
import { InputPipeline } from '../src/tracking/pipeline';
import { OneEuroFilter } from '../src/tracking/filters';
import { WaveDetector } from '../src/tracking/wave';
import { cameraCrop } from '../src/tracking/workerClient';
import {
  allocateTrackingBuffers,
  copyMirroredMask,
  mirrorLandmarks,
  playerHandFromModel,
  trackingTransfers,
} from '../src/tracking/protocol';
import { syntheticFrame, syntheticHand, syntheticPose } from './tracking-fixtures';
describe('tracking contracts (synthetic, no webcam)', () => {
  it('mirrors coordinates once, converts world chirality, copies confidence mask and uses explicit handedness adapter', () => {
    const out = new Float32Array(4);
    mirrorLandmarks([{ x: 0.2, y: 0.4, z: 0.1, visibility: 0.9 }], out, 4);
    expect(out[0]).toBeCloseTo(0.8);
    expect(out[1]).toBeCloseTo(0.4);
    mirrorLandmarks([{ x: 0.2, y: 0.4, z: 0.1 }], out, 3, true);
    expect(out[0]).toBeCloseTo(-0.2);
    const mask = new Uint8Array(2);
    copyMirroredMask(new Float32Array([0.2, 0.8]), 2, 1, mask, 2, 1);
    expect([...mask]).toEqual([204, 51]);
    // raw-model-label-v2 follows dataset-camera COCO wrist evidence; not a labelled live-hand validation.
    expect(playerHandFromModel('Left')).toBe('left');
    expect(playerHandFromModel('Right')).toBe('right');
  });
  it('returns transfer ownership without reusing detached buffers', () => {
    const buffers = allocateTrackingBuffers();
    buffers.handLm[0][0] = 0.8;
    const received = structuredClone(buffers, { transfer: trackingTransfers(buffers) });
    expect(buffers.handLm[0].byteLength).toBe(0);
    expect(received.handLm[0][0]).toBeCloseTo(0.8);
    const recycled = structuredClone(received, { transfer: trackingTransfers(received) });
    expect(received.handLm[0].byteLength).toBe(0);
    expect(recycled.handLm[0].length).toBe(63);
  });
  it('center-crops wide and tall inputs without distorting the inference image', () => {
    expect(cameraCrop(1920, 1080)).toEqual({ sx: 0, sy: 0, sw: 1920, sh: 1080 });
    const tall = cameraCrop(640, 480);
    expect(tall.sh).toBe(360);
    expect(tall.sy).toBe(60);
    const wide = cameraCrop(2000, 900);
    expect(wide.sw).toBe(1600);
    expect(wide.sx).toBe(200);
  });
  it('One Euro filters by capture time and resets without carrying an old player', () => {
    const f = new OneEuroFilter();
    expect(f.filter(0, 0)).toBe(0);
    const step = f.filter(1, 1 / 30);
    expect(step).toBeGreaterThan(0);
    expect(step).toBeLessThan(1);
    expect(f.filter(1, 1 / 30)).toBe(step);
    f.reset();
    expect(f.filter(1, 1)).toBe(1);
  });
  it('rejects duplicates, stale inputs, malformed landmarks, and calibrates independently of song', () => {
    const p = new InputPipeline();
    expect(p.calibrate('camera')).toBeNull();
    for (let i = 0; i <= 20; i++) expect(p.process(syntheticFrame(i, i * 30), i * 30 + 20)).not.toBeNull();
    expect(p.result.calibrationReady).toBe(true);
    const calibration = p.calibrate('camera');
    expect(calibration?.identity).toBe('camera');
    expect(calibration?.shoulderWidthNorm).toBeCloseTo(0.2);
    expect(p.process(syntheticFrame(20, 600), 620)).toBeNull();
    expect(p.process(syntheticFrame(21, 630), 1000)).toBeNull();
    const invalid = syntheticFrame(22, 660);
    invalid.hands[0]!.landmarks[1] = Infinity;
    expect(p.process(invalid, 680)).toBeNull();
    p.invalidateCalibration();
    expect(p.calibration).toBeNull();
    expect(p.result.calibrationReady).toBe(false);
  });
  it('preserves logical hands when model labels both flip and uses neutral body metrics before calibration', () => {
    const p = new InputPipeline();
    const first = syntheticFrame(0, 0);
    p.process(first, 20);
    const before = p.result.hands[0]!.pos.x;
    p.process(
      syntheticFrame(
        1,
        30,
        [syntheticHand('open', 'right', -0.15), syntheticHand('open', 'left', 0.15)],
        syntheticPose(0.1),
      ),
      50,
    );
    expect(p.result.hands[0]!.pos.x).toBeCloseTo(before);
    expect(p.result.body.lean).toBe('center');
    expect(p.result.body.leanX).toBe(0);
    expect(p.result.body.torsoSpeed).toBe(0);
  });
  it('requires real amplitude reversals for a wave and resets after a gap', () => {
    const wave = new WaveDetector();
    let done = false;
    const points = [0.5, 0.52, 0.6, 0.52, 0.44, 0.52, 0.6, 0.52];
    for (let i = 0; i < points.length; i++) done = wave.update(points[i]!, i * 100, true) || done;
    expect(done).toBe(true);
    wave.reset();
    for (let i = 0; i < 20; i++) expect(wave.update(0.5 + i * 0.002, i * 25, true)).toBe(false);
    wave.update(0.8, 2000, false);
    expect(wave.progress).toBe(0);
  });
  it('retains the continuous hand when a long-missing hand returns with flipped labels', () => {
    const p = new InputPipeline();
    p.process(syntheticFrame(0, 0), 20);
    for (let seq = 1; seq <= 15; seq++)
      p.process(syntheticFrame(seq, seq * 30, [syntheticHand('open', 'left', -0.15)]), seq * 30 + 20);
    const x = p.result.hands[0]!.pos.x;
    p.process(
      syntheticFrame(16, 480, [syntheticHand('open', 'right', -0.15), syntheticHand('open', 'left', 0.15)]),
      500,
    );
    expect(p.result.hands[0]!.pos.x).toBeCloseTo(x);
    expect(p.result.hands[1]!.pos.x).toBeGreaterThan(x);
  });
});
