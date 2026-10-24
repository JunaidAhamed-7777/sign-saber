import { URL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadBundledAudioBytes, loadBundledLibrary, loadBundledMap } from '../../src/beatmap/bundled';
const root = new URL('../../public/assets/tracks/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
function localFetch(corruptPath) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url) => {
      const path = url.replace('/assets/tracks/', '');
      if (path === corruptPath) return new globalThis.Response('changed', { status: 200 });
      return new globalThis.Response(readFileSync(new URL(path, root)), { status: 200 });
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());
describe('bundled runtime loader isolation', () => {
  it('loads a camera-independent library, checks map identity and verifies original music bytes', async () => {
    localFetch();
    expect(await loadBundledLibrary()).toEqual(manifest.tracks);
    const entry = manifest.tracks[0];
    const map = await loadBundledMap(entry, 'easy');
    expect(map.song.sourceHash).toBe(entry.hashes.audioSha256);
    expect(map.song.durationMs).toBe(entry.durationMs);
    expect((await loadBundledAudioBytes(entry)).byteLength).toBeGreaterThan(100000);
  });
  it('rejects a changed chart while other entries remain loadable', async () => {
    localFetch('pamgaea/easy.json');
    await expect(loadBundledMap(manifest.tracks[0], 'easy')).rejects.toThrow('chart hash mismatch');
    expect((await loadBundledMap(manifest.tracks[1], 'easy')).song.title).toBe('Electro Cabello');
  });
  it('does not turn absent music into a fabricated playable selection', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new globalThis.Response('', { status: 404 })),
    );
    await expect(loadBundledAudioBytes(manifest.tracks[0])).rejects.toThrow('Local asset unavailable');
  });
  it('fails changed music and cross-title chart/catalog pairing', async () => {
    localFetch('pamgaea/audio.mp3');
    await expect(loadBundledAudioBytes(manifest.tracks[0])).rejects.toThrow('audio hash mismatch');
    localFetch();
    const entry = { ...manifest.tracks[0], title: 'Unrelated title' };
    await expect(loadBundledMap(entry, 'easy')).rejects.toThrow('identity mismatch');
  });
});
