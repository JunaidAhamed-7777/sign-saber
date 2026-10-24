/**
 * Sign Saber — tracking/datasetCameraReel.ts
 *
 * Responsibility: photo reel for the dataset camera. Draws locally prepared, attributed COCO CC-BY
 * upper-body crops (scripts/prepare-dataset-camera.mjs; ignored by Git) in a deterministic order.
 * Spec: docs/05-tracking-pipeline.md §1.3
 * Inputs: /dataset-camera/manifest.json + hash-pinned JPEGs; ReelClock
 * Outputs: one drawn 16:9 frame per paint and the annotation truth it depicts
 *
 * Memory is bounded to the current decoded bitmap plus one prefetched/pending photo; replaced
 * bitmaps are closed. Still photos contain no motion, swings or gesture labels.
 */
import {
  ASSET_TEXT_MAX_CHARS,
  DATASET_CAMERA_MANIFEST_URL,
  DATASET_CAMERA_MAX_FILE_BYTES,
  DATASET_CAMERA_MAX_ITEMS,
  DATASET_CAMERA_SWEEP_FIRST_HOLD_MS,
  DATASET_CAMERA_TRANSITION_GUARD_MS,
  MAX_ASSET_JSON_BYTES,
} from '../core/constants';
import { sha256 } from '../utils/hash';
import type { DatasetReel, ReelClock } from './datasetCamera';
import { REEL_JOINTS, type ReelKeypoint, type ReelTruth } from './datasetCameraEval';

export interface PhotoReelItem extends ReelTruth {
  readonly role: 'calibration' | 'reel';
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly license: string;
  readonly flickrUrl: string;
  readonly coco: { readonly imageId: number; readonly annotationId: number; readonly split: string };
}
export interface PhotoReelManifest {
  readonly schema: 1;
  readonly kind: 'coco-photo-reel';
  readonly label: string;
  readonly coordinateSpace: 'crop-normalized-unmirrored';
  readonly temporalRecording: false;
  readonly createdAt: string;
  readonly frame: { readonly width: number; readonly height: number };
  readonly generator: { readonly scriptSha256: string; readonly seed: number };
  readonly items: readonly PhotoReelItem[];
}
export type PhotoReelMode = 'song' | 'sweep';

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown, max = ASSET_TEXT_MAX_CHARS): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max;

export function validatePhotoReelManifest(value: unknown): PhotoReelManifest {
  const fail = (reason: string): never => {
    throw new Error(`Dataset camera manifest is invalid (${reason}). Re-run the preparation script.`);
  };
  if (!record(value)) return fail('not an object');
  if (value.schema !== 1 || value.kind !== 'coco-photo-reel') fail('schema');
  if (value.coordinateSpace !== 'crop-normalized-unmirrored' || value.temporalRecording !== false)
    fail('coordinate space');
  if (!text(value.label) || !text(value.createdAt)) fail('label');
  const frame = value.frame;
  if (
    !record(frame) ||
    !Number.isInteger(frame.width) ||
    !Number.isInteger(frame.height) ||
    Number(frame.width) <= 0 ||
    Number(frame.width) * 9 !== Number(frame.height) * 16
  )
    fail('frame must be 16:9');
  const generator = value.generator;
  if (
    !record(generator) ||
    !/^[0-9a-f]{64}$/.test(String(generator.scriptSha256)) ||
    !Number.isInteger(generator.seed)
  )
    fail('generator receipt');
  const items = value.items;
  if (!Array.isArray(items) || items.length < 2 || items.length > DATASET_CAMERA_MAX_ITEMS)
    fail('item count');
  const ids = new Set<string>();
  (items as unknown[]).forEach((item, index) => {
    if (!record(item)) return fail('item');
    if (!text(item.id) || ids.has(item.id)) fail('item id');
    ids.add(item.id as string);
    if (item.role !== (index === 0 ? 'calibration' : 'reel')) fail('item role order');
    if (typeof item.file !== 'string' || !/^\d{3}-coco-\d+\.jpg$/.test(item.file)) fail('item file');
    if (
      !Number.isInteger(item.bytes) ||
      Number(item.bytes) <= 0 ||
      Number(item.bytes) > DATASET_CAMERA_MAX_FILE_BYTES
    )
      fail('item bytes');
    if (typeof item.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(item.sha256)) fail('item hash');
    if (!text(item.license) || !text(item.flickrUrl)) fail('item attribution');
    if (
      !record(item.coco) ||
      !Number.isInteger(item.coco.imageId) ||
      !Number.isInteger(item.coco.annotationId)
    )
      fail('item source');
    const keypoints = item.keypoints;
    if (!Array.isArray(keypoints) || keypoints.length !== REEL_JOINTS.length)
      return fail('keypoint topology');
    keypoints.forEach((point: unknown, j: number) => {
      if (
        !record(point) ||
        point.name !== REEL_JOINTS[j]![0] ||
        ![0, 1, 2].includes(point.v as number) ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        Number(point.x) < 0 ||
        Number(point.x) > 1 ||
        Number(point.y) < 0 ||
        Number(point.y) > 1
      )
        fail('keypoint');
    });
  });
  return value as unknown as PhotoReelManifest;
}

/** Calibration photo first; others in manifest order (seed 0) or a deterministic mulberry32 shuffle. */
export function photoReelOrder(count: number, seed: number): number[] {
  const rest = Array.from({ length: Math.max(0, count - 1) }, (_, i) => i + 1);
  if (seed) {
    let state = seed >>> 0;
    const random = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [rest[i], rest[j]] = [rest[j]!, rest[i]!];
    }
  }
  return count > 0 ? [0, ...rest] : [];
}

/**
 * Position in the reel order for a clock.
 * - `song`: the calibration photo until heard song time reaches 0, then the others by song time.
 *   The same song time always shows the same photo, so pauses and retries are reproducible.
 * - `sweep`: calibration photo for `firstHoldMs` of streaming, then every photo cyclically.
 */
export function reelPosition(
  mode: PhotoReelMode,
  count: number,
  holdMs: number,
  firstHoldMs: number,
  clock: ReelClock,
): number {
  if (count < 2 || !(holdMs > 0)) return 0;
  if (mode === 'song') {
    const time = clock.songTimeMs;
    if (time === null || !Number.isFinite(time) || time < 0) return 0;
    return 1 + (Math.floor(time / holdMs) % (count - 1));
  }
  const time = Math.max(0, Number.isFinite(clock.streamMs) ? clock.streamMs : 0);
  if (time < firstHoldMs) return 0;
  return (1 + Math.floor((time - firstHoldMs) / holdMs)) % count;
}

/** The position that follows `position` in the reel's own cycle (used only for prefetching). */
export function nextReelPosition(mode: PhotoReelMode, count: number, position: number): number {
  if (count < 2) return 0;
  if (mode === 'song') return position <= 0 ? 1 : (position % (count - 1)) + 1;
  return (position + 1) % count;
}

interface Decoded {
  index: number;
  bitmap: ImageBitmap;
}
export interface PhotoReelOptions {
  mode: PhotoReelMode;
  holdMs: number;
  seed: number;
  firstHoldMs?: number;
  manifestUrl?: string;
  fetcher?: typeof fetch;
  decode?: (blob: Blob) => Promise<ImageBitmap>;
}

export class PhotoReel implements DatasetReel {
  readonly kind = 'coco-photo-reel';
  readonly transitionGuardMs = DATASET_CAMERA_TRANSITION_GUARD_MS;
  manifest: PhotoReelManifest | null = null;
  private order: number[] = [];
  private current: Decoded | null = null;
  private ready: Decoded | null = null;
  private pending = -1;
  private disposed = false;
  private failure: string | null = null;
  private signal: AbortSignal | null = null;
  readonly counters = { loads: 0, closed: 0, discarded: 0, latePaints: 0 };
  private readonly fetcher: typeof fetch;
  private readonly decode: (blob: Blob) => Promise<ImageBitmap>;
  private readonly manifestUrl: string;
  readonly firstHoldMs: number;
  constructor(readonly options: PhotoReelOptions) {
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    this.decode = options.decode ?? ((blob) => createImageBitmap(blob));
    this.manifestUrl = options.manifestUrl ?? DATASET_CAMERA_MANIFEST_URL;
    this.firstHoldMs = options.firstHoldMs ?? DATASET_CAMERA_SWEEP_FIRST_HOLD_MS;
  }
  async prepare(signal: AbortSignal): Promise<void> {
    this.signal = signal;
    const response = await this.fetcher(this.manifestUrl, { signal, cache: 'no-store' });
    if (!response.ok)
      throw new Error(
        'Dataset camera photos are not prepared on this host. Run node scripts/prepare-dataset-camera.mjs, then retry.',
      );
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > MAX_ASSET_JSON_BYTES) throw new Error('Dataset camera manifest is too large.');
    this.manifest = validatePhotoReelManifest(JSON.parse(new TextDecoder().decode(bytes)));
    this.order = photoReelOrder(this.manifest.items.length, this.options.seed);
    this.current = await this.load(0);
    if (this.disposed || signal.aborted) {
      this.release();
      throw new Error('Dataset camera setup cancelled.');
    }
  }
  render(ctx: CanvasRenderingContext2D, width: number, height: number, clock: ReelClock): ReelTruth | null {
    if (this.failure) throw new Error(this.failure);
    const manifest = this.manifest;
    if (!manifest || !this.current) throw new Error('Dataset camera reel is not prepared.');
    const position = reelPosition(
      this.options.mode,
      this.order.length,
      this.options.holdMs,
      this.firstHoldMs,
      clock,
    );
    const target = this.order[position]!;
    if (target !== this.current.index) {
      if (this.ready?.index === target) {
        this.current.bitmap.close();
        this.counters.closed++;
        this.current = this.ready;
        this.ready = null;
      } else {
        if (this.ready) {
          this.ready.bitmap.close();
          this.counters.discarded++;
          this.ready = null;
        }
        // The previous photo stays on screen (and remains the attributed truth) until decoded.
        this.counters.latePaints++;
        this.request(target);
      }
    }
    if (target === this.current.index && !this.ready) {
      const next = this.order[nextReelPosition(this.options.mode, this.order.length, position)]!;
      if (next !== this.current.index) this.request(next);
    }
    ctx.drawImage(this.current.bitmap, 0, 0, width, height);
    return manifest.items[this.current.index]!;
  }
  describe(): Record<string, unknown> {
    const manifest = this.manifest;
    return {
      kind: this.kind,
      mode: this.options.mode,
      holdMs: this.options.holdMs,
      firstHoldMs: this.options.mode === 'sweep' ? this.firstHoldMs : null,
      seed: this.options.seed,
      transitionGuardMs: this.transitionGuardMs,
      failure: this.failure,
      counters: { ...this.counters },
      manifest: manifest
        ? {
            createdAt: manifest.createdAt,
            generatorScriptSha256: manifest.generator.scriptSha256,
            generatorSeed: manifest.generator.seed,
            frame: manifest.frame,
            count: manifest.items.length,
          }
        : null,
      order: this.order.map((index) => manifest?.items[index]?.id ?? index),
      attribution: manifest?.items.map((item) => ({
        id: item.id,
        file: item.file,
        sha256: item.sha256,
        cocoImageId: item.coco.imageId,
        license: item.license,
        flickrUrl: item.flickrUrl,
      })),
    };
  }
  dispose(): void {
    this.disposed = true;
    this.release();
  }
  private release(): void {
    for (const decoded of [this.current, this.ready]) {
      if (!decoded) continue;
      decoded.bitmap.close();
      this.counters.closed++;
    }
    this.current = this.ready = null;
  }
  private request(index: number): void {
    if (this.pending >= 0 || this.disposed) return;
    this.pending = index;
    this.load(index).then(
      (decoded) => {
        this.pending = -1;
        if (this.disposed || this.ready) {
          decoded.bitmap.close();
          this.counters.discarded++;
          return;
        }
        this.ready = decoded;
      },
      (error: unknown) => {
        this.pending = -1;
        if (!this.disposed) this.failure = error instanceof Error ? error.message : String(error);
      },
    );
  }
  private async load(index: number): Promise<Decoded> {
    const item = this.manifest!.items[index]!;
    const url = new URL(
      item.file,
      new URL(this.manifestUrl, globalThis.location?.href ?? 'http://localhost/'),
    ).href;
    const response = await this.fetcher(url, { signal: this.signal, cache: 'no-store' });
    if (!response.ok)
      throw new Error(`Dataset camera photo ${item.file} is missing. Re-run the preparation script.`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== item.bytes || (await sha256(bytes)) !== item.sha256)
      throw new Error(
        `Dataset camera photo ${item.file} failed its integrity check. Re-run the preparation script.`,
      );
    const bitmap = await this.decode(new Blob([bytes], { type: 'image/jpeg' }));
    this.counters.loads++;
    if (this.disposed) {
      bitmap.close();
      this.counters.closed++;
      throw new Error('Dataset camera stopped.');
    }
    return { index, bitmap };
  }
}
export type { ReelKeypoint };
