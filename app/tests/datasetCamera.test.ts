import { afterEach, describe, expect, it, vi } from 'vitest';
import { DATASET_CAMERA_MAX_ITEMS, DATASET_CAMERA_TRANSITION_GUARD_MS } from '../src/core/constants';
import { DatasetCameraSource, DrawTimeline, type DatasetReel } from '../src/tracking/datasetCamera';
import { DatasetCameraEvaluator, REEL_JOINTS, type ReelTruth } from '../src/tracking/datasetCameraEval';
import {
  PhotoReel,
  nextReelPosition,
  photoReelOrder,
  reelPosition,
  validatePhotoReelManifest,
} from '../src/tracking/datasetCameraReel';
import { sha256 } from '../src/utils/hash';
import { readFlags } from '../src/core/flags';
import type { HandCursor, TrackingFrame } from '../src/core/types';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Synthetic upright frontal truth in crop-normalized unmirrored coordinates. */
function truth(id: string, dx = 0): ReelTruth {
  const at: Record<string, [number, number]> = {
    nose: [0.5, 0.25],
    left_eye: [0.52, 0.23],
    right_eye: [0.48, 0.23],
    left_ear: [0.55, 0.24],
    right_ear: [0.45, 0.24],
    left_shoulder: [0.6, 0.4],
    right_shoulder: [0.4, 0.4],
    left_elbow: [0.65, 0.55],
    right_elbow: [0.35, 0.55],
    left_wrist: [0.68, 0.7],
    right_wrist: [0.32, 0.7],
    left_hip: [0.56, 0.8],
    right_hip: [0.44, 0.8],
  };
  return {
    id,
    role: 'reel',
    keypoints: REEL_JOINTS.map(([name]) => ({ name, x: at[name]![0] + dx, y: at[name]![1], v: 2 as const })),
  };
}
/** Mirrored worker output matching a truth exactly (u' = 1 − x), with optional hands at given wrists. */
function frameFor(t: ReelTruth, hands: { at: 'left_wrist' | 'right_wrist'; label: 'left' | 'right' }[] = []) {
  const landmarks = new Float32Array(132);
  for (const [name, index] of REEL_JOINTS) {
    const point = t.keypoints.find((p) => p.name === name)!;
    landmarks[index * 4] = 1 - point.x;
    landmarks[index * 4 + 1] = point.y;
    landmarks[index * 4 + 3] = 0.9;
  }
  return {
    seq: 1,
    tCapture: 100,
    tInferDone: 120,
    inferenceMs: 20,
    hands: hands.map(({ at, label }) => {
      const point = t.keypoints.find((p) => p.name === at)!;
      const lm = new Float32Array(63);
      lm[0] = 1 - point.x;
      lm[1] = point.y;
      return { handedness: label, score: 0.9, landmarks: lm, worldLandmarks: new Float32Array(63) };
    }),
    pose: { landmarks, worldLandmarks: new Float32Array(99) },
    mask: null,
  } satisfies TrackingFrame;
}

describe('dataset camera draw timeline', () => {
  it('attributes captures to the truth drawn before them, outside the transition guard', () => {
    const timeline = new DrawTimeline(4);
    const a = truth('a');
    const b = truth('b');
    expect(timeline.at(10, 300)).toBeNull();
    timeline.record(100, a);
    timeline.record(133, a);
    expect(timeline.length).toBe(1);
    timeline.record(1000, b);
    expect(timeline.at(99, 300)).toBeNull();
    expect(timeline.at(450, 300)).toBe(a);
    expect(timeline.at(1100, 300)).toBeNull();
    expect(timeline.at(1300, 300)).toBe(b);
    expect(() => timeline.record(900, a)).toThrow(RangeError);
  });
  it('is bounded and counts overwritten history', () => {
    const timeline = new DrawTimeline(2);
    const truths = [truth('a'), truth('b'), truth('c')];
    truths.forEach((t, i) => timeline.record(i * 1000, t));
    expect(timeline.length).toBe(2);
    expect(timeline.overwritten).toBe(1);
    expect(timeline.at(500, 0)).toBeNull();
    expect(timeline.at(2500, 0)).toBe(truths[2]);
  });
});

describe('photo reel clock and order', () => {
  it('holds the calibration photo until song time 0, then cycles the others by song time', () => {
    const at = (songTimeMs: number | null) =>
      reelPosition('song', 5, 1000, 20000, { streamMs: 99999, songTimeMs });
    expect(at(null)).toBe(0);
    expect(at(-2000)).toBe(0);
    expect(at(0)).toBe(1);
    expect(at(999)).toBe(1);
    expect(at(1000)).toBe(2);
    expect(at(3999)).toBe(4);
    expect(at(4000)).toBe(1);
    expect(at(Number.NaN)).toBe(0);
  });
  it('sweeps every photo by stream time after the first hold', () => {
    const at = (streamMs: number) => reelPosition('sweep', 3, 1000, 5000, { streamMs, songTimeMs: 50 });
    expect([0, 4999, 5000, 6000, 7000, 8000].map(at)).toEqual([0, 0, 1, 2, 0, 1]);
    expect(reelPosition('sweep', 1, 1000, 5000, { streamMs: 9000, songTimeMs: null })).toBe(0);
  });
  it('predicts the next prefetch position in each cycle', () => {
    expect([0, 1, 2, 3, 4].map((p) => nextReelPosition('song', 5, p))).toEqual([1, 2, 3, 4, 1]);
    expect([0, 1, 2].map((p) => nextReelPosition('sweep', 3, p))).toEqual([1, 2, 0]);
  });
  it('keeps the calibration photo first and reorders others deterministically by seed', () => {
    expect(photoReelOrder(5, 0)).toEqual([0, 1, 2, 3, 4]);
    const a = photoReelOrder(12, 7);
    expect(a[0]).toBe(0);
    expect([...a].sort((x, y) => x - y)).toEqual(Array.from({ length: 12 }, (_, i) => i));
    expect(photoReelOrder(12, 7)).toEqual(a);
    expect(photoReelOrder(12, 8)).not.toEqual(a);
  });
  it('reads dataset camera flags with bounded overrides', () => {
    expect(readFlags('', true)).toMatchObject({
      camera: 'webcam',
      reel: 'song',
      reelHoldMs: 5000,
      reelSeed: 0,
    });
    expect(readFlags('?camera=dataset&reel=sweep&reelHold=4000&reelSeed=9', false)).toMatchObject({
      camera: 'dataset',
      reel: 'sweep',
      reelHoldMs: 4000,
      reelSeed: 9,
    });
    expect(readFlags('?camera=../x&reelHold=10&reelSeed=-1', false)).toMatchObject({
      camera: 'webcam',
      reelHoldMs: 5000,
      reelSeed: 0,
    });
  });
});

async function manifestFixture(count = 3) {
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  const items = [];
  for (let i = 0; i < count; i++) {
    const file = `${String(i).padStart(3, '0')}-coco-${100 + i}.jpg`;
    const bytes = new TextEncoder().encode(`synthetic-jpeg-${i}`);
    files.set(file, bytes);
    items.push({
      ...truth(`coco-${100 + i}`),
      role: i === 0 ? 'calibration' : 'reel',
      file,
      bytes: bytes.byteLength,
      sha256: await sha256(bytes),
      license: 'http://creativecommons.org/licenses/by/2.0/',
      flickrUrl: `http://farm.example/${i}.jpg`,
      coco: { imageId: i + 1, annotationId: 100 + i, split: 'val' },
      crop: { x: 0, y: 0, width: 640, height: 360 },
    });
  }
  const manifest = {
    schema: 1,
    kind: 'coco-photo-reel',
    label: 'Dataset camera — not a webcam',
    coordinateSpace: 'crop-normalized-unmirrored',
    temporalRecording: false,
    createdAt: '2026-10-25T00:00:00.000Z',
    frame: { width: 1280, height: 720 },
    generator: { scriptSha256: 'a'.repeat(64), seed: 1 },
    items,
  };
  return { manifest, files };
}

describe('photo reel manifest admission', () => {
  it('accepts a well-formed manifest and rejects unsafe or inconsistent entries', async () => {
    const { manifest } = await manifestFixture();
    expect(validatePhotoReelManifest(manifest).items).toHaveLength(3);
    const broken = (mutate: (m: typeof manifest) => void) => {
      const copy = structuredClone(manifest);
      mutate(copy);
      return () => validatePhotoReelManifest(copy);
    };
    expect(broken((m) => (m.items[0]!.file = '../000-coco-1.jpg'))).toThrow(/item file/);
    expect(broken((m) => (m.items[1]!.role = 'calibration'))).toThrow(/role/);
    expect(broken((m) => (m.frame.height = 700))).toThrow(/16:9/);
    expect(broken((m) => ((m.items[0]!.keypoints[3] as { x: number }).x = 1.2))).toThrow(/keypoint/);
    expect(broken((m) => (m.items[0]!.sha256 = 'abc'))).toThrow(/hash/);
    expect(broken((m) => (m.items = m.items.slice(0, 1)))).toThrow(/count/);
    expect(
      broken((m) => (m.items = Array.from({ length: DATASET_CAMERA_MAX_ITEMS + 1 }, () => m.items[1]!))),
    ).toThrow(/count/);
    expect(broken((m) => ((m as { temporalRecording: boolean }).temporalRecording = true))).toThrow(
      /coordinate space/,
    );
  });
});

function reelHarness(files: Map<string, Uint8Array<ArrayBuffer>>, manifest: unknown) {
  const bitmaps: { name: string; close: ReturnType<typeof vi.fn> }[] = [];
  const pending: (() => void)[] = [];
  let holdDecodes = false;
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const name = url.split('/').pop()!;
    if (name === 'manifest.json')
      return new Response(new TextEncoder().encode(JSON.stringify(manifest)), { status: 200 });
    const bytes = files.get(name);
    return bytes ? new Response(bytes, { status: 200 }) : new Response(null, { status: 404 });
  }) as unknown as typeof fetch;
  const decode = vi.fn(async (blob: Blob) => {
    const name = await blob.text();
    if (holdDecodes) await new Promise<void>((resolve) => pending.push(resolve));
    const bitmap = { name, close: vi.fn() };
    bitmaps.push(bitmap);
    return bitmap as unknown as ImageBitmap;
  });
  return {
    bitmaps,
    fetcher,
    decode,
    hold(value: boolean) {
      holdDecodes = value;
    },
    release() {
      for (const resolve of pending.splice(0)) resolve();
    },
    get held() {
      return pending.length;
    },
  };
}
/** Waits on real asynchronous work (fetch, SubtleCrypto, decode) without assuming tick counts. */
async function until(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > end) throw new Error('Condition not reached');
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  await new Promise((resolve) => setTimeout(resolve, 1));
}
function context() {
  return { drawImage: vi.fn() } as unknown as CanvasRenderingContext2D & {
    drawImage: ReturnType<typeof vi.fn>;
  };
}

describe('photo reel bounded decode and attribution', () => {
  it('draws the calibration photo first, keeps the previous truth until the next decode, then closes it', async () => {
    const { manifest, files } = await manifestFixture(3);
    const h = reelHarness(files, manifest);
    const reel = new PhotoReel({
      mode: 'song',
      holdMs: 1000,
      seed: 0,
      manifestUrl: 'http://127.0.0.1/dataset-camera/manifest.json',
      fetcher: h.fetcher,
      decode: h.decode,
    });
    await reel.prepare(new AbortController().signal);
    const ctx = context();
    expect(reel.render(ctx, 1280, 720, { streamMs: 0, songTimeMs: null })!.id).toBe('coco-100');
    expect(ctx.drawImage).toHaveBeenCalledWith(h.bitmaps[0], 0, 0, 1280, 720);
    await until(() => h.bitmaps.length === 2);
    // Prefetched order[1] is ready by the time song time reaches 0.
    expect(reel.render(ctx, 1280, 720, { streamMs: 0, songTimeMs: 0 })!.id).toBe('coco-101');
    expect(h.bitmaps[0]!.close).toHaveBeenCalledOnce();
    // coco-102 is prefetched while coco-101 is shown.
    await until(() => h.bitmaps.length === 3);
    expect(reel.render(ctx, 1280, 720, { streamMs: 0, songTimeMs: 1000 })!.id).toBe('coco-102');
    // Hold the next decode: the shown photo (and attributed truth) stays coco-102 until coco-101 decodes.
    h.hold(true);
    expect(reel.render(ctx, 1280, 720, { streamMs: 0, songTimeMs: 2000 })!.id).toBe('coco-102');
    await until(() => h.held === 1);
    expect(reel.render(ctx, 1280, 720, { streamMs: 0, songTimeMs: 2000 })!.id).toBe('coco-102');
    h.release();
    await until(() => h.bitmaps.length === 4);
    expect(reel.render(ctx, 1280, 720, { streamMs: 0, songTimeMs: 2000 })!.id).toBe('coco-101');
    expect(reel.counters.latePaints).toBeGreaterThan(0);
    reel.dispose();
    const open = h.bitmaps.filter((bitmap) => bitmap.close.mock.calls.length === 0);
    expect(open).toHaveLength(0);
    expect(reel.describe()).toMatchObject({ kind: 'coco-photo-reel', mode: 'song', holdMs: 1000 });
  });
  it('fails visibly when a photo does not match its pinned hash', async () => {
    const { manifest, files } = await manifestFixture(2);
    files.set(manifest.items[1]!.file, new TextEncoder().encode('tampered-jpeg-1'));
    const h = reelHarness(files, manifest);
    const reel = new PhotoReel({
      mode: 'song',
      holdMs: 1000,
      seed: 0,
      manifestUrl: 'http://127.0.0.1/dataset-camera/manifest.json',
      fetcher: h.fetcher,
      decode: h.decode,
    });
    await reel.prepare(new AbortController().signal);
    reel.render(context(), 1280, 720, { streamMs: 0, songTimeMs: null });
    await until(() => reel.describe().failure !== null);
    expect(() => reel.render(context(), 1280, 720, { streamMs: 0, songTimeMs: 10 })).toThrow(/integrity/);
  });
  it('explains how to prepare missing local photos', async () => {
    const reel = new PhotoReel({
      mode: 'song',
      holdMs: 1000,
      seed: 0,
      manifestUrl: 'http://127.0.0.1/dataset-camera/manifest.json',
      fetcher: vi.fn(async () => new Response(null, { status: 404 })) as unknown as typeof fetch,
    });
    await expect(reel.prepare(new AbortController().signal)).rejects.toThrow(/prepare-dataset-camera/);
  });
});

describe('dataset camera source', () => {
  function stubCanvas() {
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
    const ctx = { drawImage: vi.fn() };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ctx),
      captureStream: vi.fn(() => stream),
    };
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });
    return { canvas, stream };
  }
  function fakeReel(render: DatasetReel['render'] = () => truth('a')) {
    return {
      kind: 'test-reel',
      transitionGuardMs: DATASET_CAMERA_TRANSITION_GUARD_MS,
      prepare: vi.fn(async () => {}),
      render: vi.fn(render),
      describe: vi.fn(() => ({ kind: 'test-reel' })),
      dispose: vi.fn(),
    } satisfies DatasetReel;
  }
  it('streams painted canvas frames, pauses its clock when hidden and releases everything once', async () => {
    vi.useFakeTimers();
    let now = 1000;
    const { canvas, stream } = stubCanvas();
    const reel = fakeReel();
    const source = new DatasetCameraSource(
      reel,
      () => 1234,
      () => now,
    );
    expect(await source.open()).toBe(stream);
    expect(canvas.captureStream).toHaveBeenCalledWith(30);
    expect(canvas.width / canvas.height).toBeCloseTo(16 / 9);
    expect(reel.render).toHaveBeenCalledWith(expect.anything(), 1280, 720, { streamMs: 0, songTimeMs: 1234 });
    now += 100;
    vi.advanceTimersByTime(100);
    const painted = source.framesPainted;
    expect(painted).toBeGreaterThan(1);
    source.setActive(false);
    now += 5000;
    vi.advanceTimersByTime(5000);
    expect(source.framesPainted).toBe(painted);
    expect(source.streamMs).toBe(100);
    source.setActive(true);
    now += 50;
    expect(source.streamMs).toBe(150);
    source.close();
    source.close();
    expect(reel.dispose).toHaveBeenCalledOnce();
    expect(canvas.width).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(source.framesPainted).toBeLessThan(painted + 10);
    await expect(source.open()).rejects.toThrow(/already used/);
  });
  it('reports a reel failure as a labelled camera failure instead of freezing silently', async () => {
    vi.useFakeTimers();
    stubCanvas();
    let fail = false;
    const reel = fakeReel(() => {
      if (fail) throw new Error('decode broke');
      return truth('a');
    });
    const source = new DatasetCameraSource(
      reel,
      () => null,
      () => 0,
    );
    await source.open();
    const onFailure = vi.fn();
    source.onFailure = onFailure;
    fail = true;
    vi.advanceTimersByTime(40);
    expect(onFailure).toHaveBeenCalledWith('Dataset camera — not a webcam: decode broke');
    expect(source.evidence()).toMatchObject({
      webcam: false,
      lane: 'dataset-camera',
      paintError: 'decode broke',
    });
    source.close();
  });
  it('abandons preparation when closed during setup', async () => {
    stubCanvas();
    let resolve!: () => void;
    const reel = fakeReel();
    reel.prepare.mockImplementation(() => new Promise<void>((r) => (resolve = r)));
    const source = new DatasetCameraSource(reel);
    const opening = source.open();
    source.close();
    resolve();
    await expect(opening).rejects.toThrow(/cancelled/);
    expect(reel.dispose).toHaveBeenCalledOnce();
  });
});

describe('dataset camera evaluation', () => {
  it('reports zero error for matching landmarks and scales offsets by annotated shoulder width', () => {
    const evaluator = new DatasetCameraEvaluator();
    const exact = truth('exact');
    evaluator.frame(exact, frameFor(exact));
    const shifted = truth('shifted');
    // Shoulder width is 0.2 frame widths; shifting predictions by 0.02 is 0.1 shoulder widths.
    evaluator.frame(shifted, frameFor(truth('shifted', 0.02)));
    evaluator.frame(null, frameFor(exact));
    const summary = evaluator.summary();
    const [a, b] = summary.items;
    expect(a!.meanLabelledJointError).toBe(0);
    expect(b!.meanLabelledJointError).toBeCloseTo(0.1, 4);
    expect(summary.perJoint.left_wrist).toMatchObject({ items: 2, pck: 1 });
    expect(summary.unattributedFrames).toBe(1);
    expect(summary.poseDetectedTruths).toBe(2);
  });
  it('compares adapter handedness with the anatomical annotated wrist', () => {
    const evaluator = new DatasetCameraEvaluator();
    const t = truth('hands');
    evaluator.frame(
      t,
      frameFor(t, [
        { at: 'left_wrist', label: 'left' },
        { at: 'right_wrist', label: 'left' },
      ]),
    );
    const far = frameFor(t);
    far.hands.push({ ...frameFor(t, [{ at: 'left_wrist', label: 'left' }]).hands[0]! });
    far.hands[0]!.landmarks[0] = 0.02;
    far.hands[0]!.landmarks[1] = 0.02;
    evaluator.frame(t, far);
    const item = evaluator.summary().items[0]!;
    expect(item.wristHands).toEqual({ matched: 2, handednessAgree: 1, handednessDisagree: 1, unmatched: 1 });
    expect(item.twoHandsRate).toBe(0.5);
  });
  it('counts processed gestures per side and bounds distinct truths', () => {
    const evaluator = new DatasetCameraEvaluator();
    const t = truth('g');
    const hand = (side: 'left' | 'right', present: boolean, gesture: HandCursor['gesture']) =>
      ({ hand: side, present, gesture }) as HandCursor;
    evaluator.frame(t, frameFor(t));
    evaluator.processed(t, [hand('left', true, 'fist'), hand('right', false, 'open')]);
    evaluator.processed(null, []);
    const summary = evaluator.summary();
    expect(summary.gestures.left.fist).toBe(1);
    expect(summary.gestures.right.absent).toBe(1);
    expect(summary.unattributedProcessed).toBe(1);
    for (let i = 0; i < DATASET_CAMERA_MAX_ITEMS + 3; i++) evaluator.frame(truth(`id-${i}`), frameFor(t));
    expect(evaluator.summary().items).toHaveLength(DATASET_CAMERA_MAX_ITEMS);
    expect(evaluator.overflowFrames).toBe(4);
    evaluator.reset();
    expect(evaluator.summary().items).toHaveLength(0);
  });
});
