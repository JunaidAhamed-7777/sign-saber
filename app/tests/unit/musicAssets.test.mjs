import { describe, expect, it } from 'vitest';
import { URL } from 'node:url';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validateBeatmap } from '../../src/beatmap/validate';
import { validateBundledManifest } from '../../src/beatmap/bundled';
describe('packaged starter asset integrity (no camera or human-quality claim)', () => {
  const root = new URL('../../public/assets/tracks/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
  it('contains the three distinct documented full tracks with measured preview bounds and notices', () => {
    expect(validateBundledManifest(manifest).tracks.map((t) => t.slug)).toEqual([
      'pamgaea',
      'electro-cabello',
      'cipher',
    ]);
    for (const entry of manifest.tracks) {
      expect(entry.durationMs).toBeGreaterThan(60000);
      expect(entry.preview.startMs + entry.preview.durationMs).toBeLessThanOrEqual(entry.durationMs);
      expect(readFileSync(new URL(entry.slug + '/ATTRIBUTION.txt', root), 'utf8')).toContain(
        'By Attribution 4.0',
      );
      expect(entry.warnings).toContain('humanRhythmAndComfortReviewPending');
    }
  });
  it('matches every packaged audio/map SHA and validates all nine difficulty maps', () => {
    const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
    for (const entry of manifest.tracks) {
      expect(hash(readFileSync(new URL(entry.slug + '/audio.mp3', root)))).toBe(entry.hashes.audioSha256);
      for (const difficulty of ['easy', 'normal', 'hard']) {
        const bytes = readFileSync(new URL(entry.slug + '/' + difficulty + '.json', root));
        expect(hash(bytes)).toBe(entry.hashes.maps[difficulty]);
        const map = JSON.parse(bytes.toString('utf8'));
        expect(validateBeatmap(map)).toMatchObject({ valid: true, errors: [] });
      }
    }
  });
  it('rejects a manifest that changes track identity, preview bounds or local path confinement', () => {
    for (const change of [
      (m) => {
        m.tracks[1].slug = m.tracks[0].slug;
      },
      (m) => {
        m.tracks[0].preview.startMs = m.tracks[0].durationMs;
      },
      (m) => {
        m.tracks[0].difficultyMaps.easy = '/assets/tracks/cipher/easy.json';
      },
    ]) {
      const copy = globalThis.structuredClone(manifest);
      change(copy);
      expect(() => validateBundledManifest(copy)).toThrow();
    }
  });
});
