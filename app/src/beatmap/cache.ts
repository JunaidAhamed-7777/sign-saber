import {
  ANALYSIS_CACHE_MAX,
  ANALYSIS_SR,
  APPROACH_MS,
  ASSET_TEXT_MAX_CHARS,
  GENERATOR_VERSION,
  HOP,
  MAX_TRACK_MS,
  MIN_TRACK_MS,
} from '../core/constants';
import type { BeatmapV1, Difficulty } from './types';
import type { AnalysisResult } from './pipeline';
import { isBoundedText, isFiniteNumber, isHash, isRecord, validateBeatmap } from './validate';

interface Stored {
  key: string;
  sourceHash: string;
  version: number;
  createdAt: number;
  map?: BeatmapV1;
  warnings?: string[];
  analysis?: AnalysisResult;
}
export interface CachedMap {
  map: BeatmapV1;
  warnings: string[];
}
const mapKey = (hash: string, difficulty: Difficulty): string => `${hash}:${difficulty}:${GENERATOR_VERSION}`;
const analysisKey = (hash: string): string => `${hash}:analysis:${GENERATOR_VERSION}`;
function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Cache operation failed'));
  });
}
function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () =>
      reject(transaction.error ?? new Error('Cache transaction failed'));
  });
}
export function validAnalysis(value: unknown): value is AnalysisResult {
  if (
    !isRecord(value) ||
    !isFiniteNumber(value.durationMs) ||
    value.durationMs < MIN_TRACK_MS ||
    value.durationMs > MAX_TRACK_MS ||
    !isFiniteNumber(value.bpm) ||
    value.bpm < 40 ||
    value.bpm > 240 ||
    !isFiniteNumber(value.beatOffsetMs) ||
    !isFiniteNumber(value.tempoConfidence) ||
    value.tempoConfidence < 0 ||
    value.tempoConfidence > 1
  )
    return false;
  if (
    !Array.isArray(value.onsets) ||
    !Array.isArray(value.beats) ||
    !Array.isArray(value.energy) ||
    !Array.isArray(value.events) ||
    !Array.isArray(value.warnings) ||
    !value.warnings.every(isBoundedText) ||
    !(value.centroid instanceof Float32Array) ||
    !isRecord(value.power)
  )
    return false;
  if (
    !(['low', 'mid', 'high'] as const).every(
      (band) => (value.power as Record<string, unknown>)[band] instanceof Float32Array,
    )
  )
    return false;
  if (
    value.warnings.length > ASSET_TEXT_MAX_CHARS ||
    value.centroid.length !== Math.floor(Math.round((value.durationMs / 1000) * ANALYSIS_SR) / HOP) + 1 ||
    !Number.isSafeInteger(value.detectedOnsetCount) ||
    (value.detectedOnsetCount as number) < value.onsets.length
  )
    return false;
  // Feed persisted diagnostics through the public schema guard before assignment.
  const check = validateBeatmap({
    version: 1,
    generatorVersion: GENERATOR_VERSION,
    song: {
      title: 'Cache validation',
      artist: 'Sign Saber',
      source: 'upload',
      sourceHash: '0'.repeat(64),
      durationMs: value.durationMs,
      bpm: value.bpm,
      beatOffsetMs: value.beatOffsetMs,
    },
    difficulty: 'normal',
    approachMs: APPROACH_MS.normal,
    notes: [{ id: 0, t: 0, type: 'slash', col: 1, row: 1, dir: 'any', strength: 1 }],
    obstacles: [],
    events: value.events,
    analysis: { onsets: value.onsets, beats: value.beats, energy: value.energy },
  });
  if (!check.valid) return false;
  for (const samples of [
    value.centroid,
    value.power.low,
    value.power.mid,
    value.power.high,
  ] as Float32Array[]) {
    if (samples.length !== value.centroid.length) return false;
    for (const sample of samples) if (!Number.isFinite(sample) || sample < 0) return false;
  }
  return true;
}

/** Cache is optional: callers retain a ready map when browser storage is denied/full. */
export class BeatmapCache {
  private database: Promise<IDBDatabase> | null = null;
  private open(): Promise<IDBDatabase> {
    this.database ??= new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('Local chart cache is unavailable'));
        return;
      }
      const req = indexedDB.open('sign-saber', 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains('beatmaps'))
          req.result.createObjectStore('beatmaps', { keyPath: 'key' });
      };
      req.onsuccess = () => {
        req.result.onversionchange = () => {
          req.result.close();
          this.database = null;
        };
        resolve(req.result);
      };
      req.onerror = () => {
        this.database = null;
        reject(req.error ?? new Error('Cannot open chart cache'));
      };
      req.onblocked = () => {
        this.database = null;
        reject(new Error('Chart cache blocked by another tab'));
      };
    });
    return this.database;
  }
  private async read(key: string, hash: string): Promise<Stored | undefined> {
    if (!isHash(hash)) return undefined;
    const db = await this.open();
    const tx = db.transaction('beatmaps', 'readonly');
    const raw: unknown = await request(tx.objectStore('beatmaps').get(key));
    if (
      !isRecord(raw) ||
      raw.sourceHash !== hash ||
      raw.version !== GENERATOR_VERSION ||
      raw.key !== key ||
      !isFiniteNumber(raw.createdAt)
    ) {
      if (raw !== undefined) await this.remove(key);
      return undefined;
    }
    return raw as unknown as Stored;
  }
  async get(hash: string, difficulty: Difficulty): Promise<CachedMap | undefined> {
    const entry = await this.read(mapKey(hash, difficulty), hash);
    if (!entry) return undefined;
    const validation = validateBeatmap(entry.map);
    if (
      !validation.valid ||
      !validation.map ||
      validation.map.song.sourceHash !== hash ||
      validation.map.difficulty !== difficulty ||
      !Array.isArray(entry.warnings) ||
      !entry.warnings.every(isBoundedText)
    ) {
      await this.remove(mapKey(hash, difficulty));
      return undefined;
    }
    return { map: validation.map, warnings: [...entry.warnings] };
  }
  async getAnalysis(hash: string): Promise<AnalysisResult | undefined> {
    const entry = await this.read(analysisKey(hash), hash);
    if (!entry) return undefined;
    if (!validAnalysis(entry.analysis)) {
      await this.remove(analysisKey(hash));
      return undefined;
    }
    return entry.analysis;
  }
  async put(map: BeatmapV1, warnings: string[]): Promise<void> {
    if (
      !validateBeatmap(map).valid ||
      warnings.length > ASSET_TEXT_MAX_CHARS ||
      !warnings.every(isBoundedText)
    )
      throw new Error('Refusing to cache an invalid chart');
    await this.write({
      key: mapKey(map.song.sourceHash, map.difficulty),
      sourceHash: map.song.sourceHash,
      version: GENERATOR_VERSION,
      createdAt: Date.now(),
      map,
      warnings: [...warnings],
    });
  }
  async putAnalysis(hash: string, analysis: AnalysisResult): Promise<void> {
    if (!isHash(hash) || !validAnalysis(analysis)) throw new Error('Refusing to cache invalid analysis');
    await this.write({
      key: analysisKey(hash),
      sourceHash: hash,
      version: GENERATOR_VERSION,
      createdAt: Date.now(),
      analysis,
    });
  }
  private async write(entry: Stored): Promise<void> {
    const db = await this.open();
    let tx = db.transaction('beatmaps', 'readwrite');
    const stored = complete(tx);
    tx.objectStore('beatmaps').put(entry);
    await stored;
    tx = db.transaction('beatmaps', 'readonly');
    const entries = (await request(tx.objectStore('beatmaps').getAll())) as Stored[];
    const groups = new Map<string, number>();
    for (const item of entries)
      groups.set(item.sourceHash, Math.max(groups.get(item.sourceHash) ?? 0, item.createdAt));
    const retained = new Set(
      [...groups]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, ANALYSIS_CACHE_MAX)
        .map(([hash]) => hash),
    );
    const expired = entries.filter((item) => !retained.has(item.sourceHash));
    if (expired.length) {
      tx = db.transaction('beatmaps', 'readwrite');
      const evicted = complete(tx);
      for (const item of expired) tx.objectStore('beatmaps').delete(item.key);
      await evicted;
    }
  }
  private async remove(key: string): Promise<void> {
    const db = await this.open(),
      tx = db.transaction('beatmaps', 'readwrite');
    const removed = complete(tx);
    tx.objectStore('beatmaps').delete(key);
    await removed;
  }
  async close(): Promise<void> {
    if (this.database) {
      (await this.database).close();
      this.database = null;
    }
  }
}
