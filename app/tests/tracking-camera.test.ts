import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraController, cameraError } from '../src/tracking/camera';
import { TrackingClient } from '../src/tracking/workerClient';
import type { FromTrackingWorker, ToTrackingWorker } from '../src/tracking/protocol';
import { allocateTrackingBuffers } from '../src/tracking/protocol';
import { TRACK_FIRST_RESULT_TIMEOUT_MS, TRACK_STALL_MS } from '../src/core/constants';
import { syntheticFrame } from './tracking-fixtures';
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<FromTrackingWorker>) => void) | null = null;
  onerror: (() => void) | null = null;
  messages: ToTrackingWorker[] = [];
  terminate = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
  postMessage(message: ToTrackingWorker): void {
    this.messages.push(message);
    if (message.type === 'init')
      queueMicrotask(() =>
        this.onmessage?.({
          data: { type: 'ready', delegate: 'CPU', initMs: 2 },
        } as MessageEvent<FromTrackingWorker>),
      );
  }
}
function videoFixture() {
  let callback: VideoFrameRequestCallback | null = null;
  const video = {
    videoWidth: 1280,
    videoHeight: 720,
    requestVideoFrameCallback: vi.fn((cb: VideoFrameRequestCallback) => {
      callback = cb;
      return 1;
    }),
    cancelVideoFrameCallback: vi.fn(),
    play: vi.fn(async () => {}),
    pause: vi.fn(),
    srcObject: null,
    muted: true,
    playsInline: true,
  };
  return {
    video: video as unknown as HTMLVideoElement,
    frame(now: number) {
      callback?.(now, {} as VideoFrameCallbackMetadata);
    },
  };
}
beforeEach(() => {
  FakeWorker.instances.length = 0;
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('document', { hidden: false });
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('camera ownership and cancellation with mocked browser boundaries', () => {
  it('stops a permission result arriving after setup was cancelled', async () => {
    let resolve!: (stream: MediaStream) => void;
    const permission = new Promise<MediaStream>((r) => {
      resolve = r;
    });
    const track = { stop: vi.fn() };
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(() => permission) } });
    const camera = new CameraController();
    const v = videoFixture();
    const start = camera.start(v.video, vi.fn(), vi.fn());
    camera.stop();
    resolve({ getTracks: () => [track] } as unknown as MediaStream);
    await start;
    expect(track.stop).toHaveBeenCalledOnce();
    expect(v.video.play).not.toHaveBeenCalled();
    expect(camera.identity).toBe('');
  });
  it('bounds bitmap capture to one reserved in-flight request and closes late results', async () => {
    let resolve!: (bitmap: ImageBitmap) => void;
    const bitmapPromise = new Promise<ImageBitmap>((r) => {
      resolve = r;
    });
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const makeBitmap = vi.fn(() => bitmapPromise);
    vi.stubGlobal('createImageBitmap', makeBitmap);
    const client = new TrackingClient();
    await client.initialize(vi.fn(), vi.fn());
    const v = videoFixture();
    client.start(v.video);
    v.frame(100);
    v.frame(140);
    expect(makeBitmap).toHaveBeenCalledOnce();
    expect(client.stats.skippedBusy).toBe(1);
    client.dispose();
    resolve(bitmap);
    await Promise.resolve();
    await Promise.resolve();
    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(FakeWorker.instances[0]!.messages.some((m) => m.type === 'frame')).toBe(false);
  });
  it('acknowledges capture failure so subsequent frames can proceed', async () => {
    const onError = vi.fn();
    const makeBitmap = vi
      .fn()
      .mockRejectedValueOnce(new Error('capture'))
      .mockResolvedValue({ close: vi.fn() });
    vi.stubGlobal('createImageBitmap', makeBitmap);
    const client = new TrackingClient();
    await client.initialize(vi.fn(), onError);
    const v = videoFixture();
    client.start(v.video);
    v.frame(100);
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledOnce();
    v.frame(140);
    await Promise.resolve();
    expect(makeBitmap).toHaveBeenCalledTimes(2);
    expect(client.stats.submitted).toBe(1);
    client.dispose();
  });
  it('pauses capture without disposing models and releases a pending bitmap before restart', async () => {
    let resolve!: (bitmap: ImageBitmap) => void;
    const lateBitmap = { close: vi.fn() };
    const makeBitmap = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<ImageBitmap>((r) => {
            resolve = r;
          }),
      )
      .mockResolvedValue({ close: vi.fn() });
    vi.stubGlobal('createImageBitmap', makeBitmap);
    const client = new TrackingClient();
    await client.initialize(vi.fn(), vi.fn());
    const v = videoFixture();
    client.start(v.video);
    v.frame(100);
    client.pauseCapture();
    expect(v.video.cancelVideoFrameCallback).toHaveBeenCalled();
    expect(FakeWorker.instances[0]!.messages.some((m) => m.type === 'dispose')).toBe(false);
    client.start(v.video);
    resolve(lateBitmap as unknown as ImageBitmap);
    await Promise.resolve();
    await Promise.resolve();
    expect(lateBitmap.close).toHaveBeenCalledOnce();
    v.frame(200);
    await Promise.resolve();
    expect(makeBitmap).toHaveBeenCalledTimes(2);
    expect(client.stats.submitted).toBe(1);
    client.dispose();
  });
  it('gives actionable camera failures without treating errors as readiness', () => {
    expect(cameraError(new DOMException('denied', 'NotAllowedError'))).toContain('site settings');
    expect(cameraError(new DOMException('missing', 'NotFoundError'))).toContain('No camera');
    expect(cameraError(new DOMException('busy', 'NotReadableError'))).toContain('Close other apps');
  });
  it('resets the stall deadline after hidden capture resumes without requesting permission again', async () => {
    const track = {
      stop: vi.fn(),
      getSettings: () => ({ deviceId: 'test-local', width: 1280, height: 720 }),
      onended: null,
    };
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [track], getVideoTracks: () => [track] }));
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const camera = new CameraController();
    const v = videoFixture();
    const error = vi.fn();
    await camera.start(v.video, vi.fn(), error);
    camera.setCaptureVisible(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(error).not.toHaveBeenCalled();
    camera.setCaptureVisible(true);
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(999);
    expect(error).not.toHaveBeenCalled();
    camera.stop();
  });
  it('allows bounded first-result shader setup but retains the strict steady-state stall deadline', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const track = { stop: vi.fn(), getSettings: () => ({ width: 1280, height: 720 }), onended: null };
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(async () => ({ getTracks: () => [track], getVideoTracks: () => [track] })),
      },
    });
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ close: vi.fn() })),
    );
    const camera = new CameraController();
    const v = videoFixture();
    const error = vi.fn();
    const status = vi.fn();
    await camera.start(v.video, vi.fn(), error, status);
    v.frame(100);
    await Promise.resolve();
    expect(camera.stats.submitted).toBe(1);
    expect(status.mock.calls.at(-1)?.[0]).toContain('Preparing');
    await vi.advanceTimersByTimeAsync(TRACK_FIRST_RESULT_TIMEOUT_MS - TRACK_STALL_MS);
    expect(error).not.toHaveBeenCalled();
    const worker = FakeWorker.instances[0]!;
    const now = performance.now();
    worker.onmessage?.({
      data: {
        type: 'result',
        frame: syntheticFrame(0, now),
        buffers: allocateTrackingBuffers(),
        dropped: 0,
        allocs: 0,
      },
    } as MessageEvent<FromTrackingWorker>);
    expect(camera.stats.returned).toBe(1);
    expect(status.mock.calls.at(-1)?.[0]).toContain('preview');
    await vi.advanceTimersByTimeAsync(TRACK_STALL_MS - 1);
    expect(error).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(error).toHaveBeenCalledOnce();
    expect(track.stop).toHaveBeenCalledOnce();
    camera.stop();
  });
  it('does not grant the shader-start allowance when the camera delivers no callbacks', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const track = { stop: vi.fn(), getSettings: () => ({ width: 1280, height: 720 }), onended: null };
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(async () => ({ getTracks: () => [track], getVideoTracks: () => [track] })),
      },
    });
    const camera = new CameraController();
    const error = vi.fn();
    await camera.start(videoFixture().video, vi.fn(), error);
    await vi.advanceTimersByTimeAsync(TRACK_STALL_MS);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('not delivering'));
    camera.stop();
  });
  it('runs an injected dataset source through the same capture path with labelled status and teardown', async () => {
    const track = { stop: vi.fn(), getSettings: () => ({ width: 1280, height: 720 }), onended: null };
    const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
    const order: string[] = [];
    const source = {
      kind: 'dataset' as const,
      label: 'Dataset camera — not a webcam',
      lane: 'dataset-camera',
      onFailure: null as ((message: string) => void) | null,
      open: vi.fn(async () => stream),
      close: vi.fn(),
      setActive: vi.fn(),
      observeFrame: vi.fn(() => order.push('observe')),
      observeProcessed: vi.fn(),
      evidence: vi.fn(() => ({ lane: 'dataset-camera' })),
    };
    const getUserMedia = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => ({ close: vi.fn() })),
    );
    const camera = new CameraController();
    const v = videoFixture();
    const status = vi.fn();
    const onFrame = vi.fn(() => order.push('frame'));
    const error = vi.fn();
    await camera.start(v.video, onFrame, error, status, source);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(status.mock.calls[0]![0]).toBe('Starting Dataset camera — not a webcam');
    expect(status.mock.calls.at(-1)![0]).toContain('· Dataset camera — not a webcam');
    expect(JSON.parse(camera.identity)).toMatchObject({ source: 'dataset-camera', crop: 'center-16:9' });
    expect(camera.sourceKind).toBe('dataset');
    expect(camera.sourceLane).toBe('dataset-camera');
    expect(v.video.srcObject).toBe(stream);
    v.frame(100);
    await Promise.resolve();
    FakeWorker.instances[0]!.onmessage?.({
      data: {
        type: 'result',
        frame: syntheticFrame(0, performance.now()),
        buffers: allocateTrackingBuffers(),
        dropped: 0,
        allocs: 0,
      },
    } as MessageEvent<FromTrackingWorker>);
    expect(order).toEqual(['observe', 'frame']);
    camera.observeProcessed(5, []);
    expect(source.observeProcessed).toHaveBeenCalledWith(5, []);
    expect(camera.sourceEvidence()).toEqual({ lane: 'dataset-camera' });
    camera.setCaptureVisible(false);
    expect(source.setActive).toHaveBeenLastCalledWith(false);
    source.onFailure?.('Dataset camera — not a webcam: decode broke');
    expect(error).toHaveBeenCalledWith('Dataset camera — not a webcam: decode broke');
    expect(source.close).toHaveBeenCalledOnce();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(camera.sourceKind).toBeNull();
    camera.stop();
    expect(source.close).toHaveBeenCalledOnce();
  });
  it('closes a source whose stream arrives after cancellation and reports open failures', async () => {
    let resolve!: (stream: MediaStream) => void;
    const track = { stop: vi.fn() };
    const source = {
      kind: 'dataset' as const,
      label: 'Dataset camera — not a webcam',
      lane: 'dataset-camera',
      open: vi.fn(() => new Promise<MediaStream>((r) => (resolve = r))),
      close: vi.fn(),
    };
    const camera = new CameraController();
    const start = camera.start(videoFixture().video, vi.fn(), vi.fn(), vi.fn(), source);
    camera.stop();
    resolve({ getTracks: () => [track] } as unknown as MediaStream);
    await start;
    expect(track.stop).toHaveBeenCalledOnce();
    expect(source.close).toHaveBeenCalled();
    const failing = {
      ...source,
      open: vi.fn(async () => Promise.reject(new Error('Dataset camera photos are not prepared'))),
    };
    await expect(camera.start(videoFixture().video, vi.fn(), vi.fn(), vi.fn(), failing)).rejects.toThrow(
      /not prepared/,
    );
    expect(camera.sourceKind).toBeNull();
  });
});
