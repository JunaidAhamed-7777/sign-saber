import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BeatmapCache, validAnalysis } from '../../src/beatmap/cache';
import { ANALYSIS_CACHE_MAX, ANALYSIS_SR, APPROACH_MS, GENERATOR_VERSION } from '../../src/core/constants';
import type { BeatmapV1 } from '../../src/beatmap/types';
import { analyzeMono } from '../../src/beatmap/pipeline';

function map(hash = 'a'.repeat(64)): BeatmapV1 {
  return {
    version: 1,
    generatorVersion: GENERATOR_VERSION,
    song: {
      title: 'Synthetic cache fixture',
      artist: 'Sign Saber tests',
      durationMs: 10000,
      bpm: 120,
      beatOffsetMs: 0,
      sourceHash: hash,
      source: 'upload',
    },
    difficulty: 'normal',
    approachMs: APPROACH_MS.normal,
    notes: [{ id: 0, t: 1000, type: 'slash', col: 1, row: 1, dir: 'any', strength: 1 }],
    obstacles: [],
    events: [],
    analysis: { onsets: [], beats: [], energy: [] },
  };
}
beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const r = indexedDB.deleteDatabase('sign-saber');
    r.onsuccess = () => resolve();
    r.onerror = () => reject(r.error);
  });
});
describe('optional chart cache', () => {
  it('keys by source/difficulty/version and preserves uncertainty on cache hits', async () => {
    const cache = new BeatmapCache(),
      value = map();
    await cache.put(value, ['lowTempoConfidence']);
    expect(await cache.get(value.song.sourceHash, 'normal')).toEqual({
      map: value,
      warnings: ['lowTempoConfidence'],
    });
    expect(await cache.get(value.song.sourceHash, 'hard')).toBeUndefined();
    expect(await cache.get('b'.repeat(64), 'normal')).toBeUndefined();
    await cache.close();
  });
  it('rejects invalid data before caching and does not fabricate a ready map', async () => {
    const cache = new BeatmapCache(),
      value = map();
    value.song.durationMs = NaN;
    await expect(cache.put(value, [])).rejects.toThrow('invalid chart');
    expect(await cache.get('not-a-hash', 'normal')).toBeUndefined();
    await cache.close();
  });
  it('discards corrupt stored data when read', async () => {
    const cache = new BeatmapCache(),
      value = map();
    await cache.put(value, []);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('sign-saber', 1);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    const tx = db.transaction('beatmaps', 'readwrite');
    tx.objectStore('beatmaps').put({
      key: `${value.song.sourceHash}:normal:${GENERATOR_VERSION}`,
      sourceHash: value.song.sourceHash,
      version: GENERATOR_VERSION,
      createdAt: 1,
      map: { ...value, notes: [] },
      warnings: [],
    });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    expect(await cache.get(value.song.sourceHash, 'normal')).toBeUndefined();
    await cache.close();
  });
  it('keeps complete recent source groups and evicts all variants/analysis of the oldest', async () => {
    const cache = new BeatmapCache();
    let time = 1000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => ++time);
    try {
      const oldest = map('0'.repeat(64));
      await cache.put(oldest, []);
      const easy = structuredClone(oldest);
      easy.difficulty = 'easy';
      easy.approachMs = APPROACH_MS.easy;
      await cache.put(easy, []);
      const pcm = new Float32Array(ANALYSIS_SR * 5);
      for (let at = ANALYSIS_SR / 2; at < pcm.length; at += ANALYSIS_SR / 2) pcm[Math.round(at)] = 1;
      await cache.putAnalysis(oldest.song.sourceHash, analyzeMono(pcm, ANALYSIS_SR, 5000));
      for (let i = 1; i <= ANALYSIS_CACHE_MAX; i++)
        await cache.put(map(i.toString(16).padStart(64, '0')), []);
      expect(await cache.get(oldest.song.sourceHash, 'normal')).toBeUndefined();
      expect(await cache.get(oldest.song.sourceHash, 'easy')).toBeUndefined();
      expect(await cache.getAnalysis(oldest.song.sourceHash)).toBeUndefined();
      expect(await cache.get(ANALYSIS_CACHE_MAX.toString(16).padStart(64, '0'), 'normal')).toBeDefined();
      expect(await cache.get('1'.padStart(64, '0'), 'normal')).toBeDefined();
    } finally {
      clock.mockRestore();
      await cache.close();
    }
  });
  it('owns copied analysis and rejects corrupt cached intermediate buffers', async () => {
    const pcm = new Float32Array(ANALYSIS_SR * 5);
    for (let at = ANALYSIS_SR / 2; at < pcm.length; at += ANALYSIS_SR / 2) pcm[Math.round(at)] = 1;
    const analysis = analyzeMono(pcm, ANALYSIS_SR, 5000),
      cache = new BeatmapCache(),
      hash = 'c'.repeat(64);
    expect(validAnalysis(analysis)).toBe(true);
    await cache.putAnalysis(hash, analysis);
    analysis.centroid[0] = NaN;
    const restored = await cache.getAnalysis(hash);
    expect(restored).toBeDefined();
    expect(Number.isFinite(restored!.centroid[0])).toBe(true);
    expect(validAnalysis(analysis)).toBe(false);
    expect(validAnalysis({ ...restored, tempoConfidence: NaN })).toBe(false);
    expect(validAnalysis({ ...restored, power: { ...restored!.power, mid: new Float32Array(0) } })).toBe(
      false,
    );
    await cache.close();
  });
});
