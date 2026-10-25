import { describe, expect, it } from 'vitest';
import { URL } from 'node:url';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { validateBeatmap } from '../../src/beatmap/validate';
import { validateBundledManifest } from '../../src/beatmap/bundled';
describe('packaged starter asset integrity (no camera or human-quality claim)', () => {
  const root = new URL('../../public/assets/tracks/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('manifest.json', root), 'utf8'));
  it('contains eight distinct documented full tracks with measured preview bounds and notices', () => {
    expect(validateBundledManifest(manifest).tracks.map((t) => t.slug)).toEqual([
      'pamgaea',
      'electro-cabello',
      'cipher',
      'chipper-doodle-v2',
      'funkorama',
      'cut-and-run',
      'rhinoceros',
      'marty-gots-a-plan',
    ]);
    for (const entry of manifest.tracks) {
      expect(entry.durationMs).toBeGreaterThan(60000);
      expect(entry.durationMs).toBeLessThanOrEqual(300000);
      expect(entry.preview.startMs + entry.preview.durationMs).toBeLessThanOrEqual(entry.durationMs);
      expect(readFileSync(new URL(entry.slug + '/ATTRIBUTION.txt', root), 'utf8')).toContain(
        'By Attribution 4.0',
      );
      expect(entry.warnings).toContain('humanRhythmAndComfortReviewPending');
      const receipt = JSON.parse(readFileSync(new URL(entry.slug + '/acquisition.json', root), 'utf8'));
      const generation = JSON.parse(readFileSync(new URL(entry.slug + '/generation.json', root), 'utf8'));
      expect(receipt.audioSha256).toBe(entry.hashes.audioSha256);
      expect(receipt.audioBytes).toBeLessThanOrEqual(60 * 1024 * 1024);
      expect(receipt.license).toBe('CC-BY-4.0');
      expect(receipt.sourceUrl).toBe(entry.rights.sourceUrl);
      expect(receipt.trackPageSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(receipt.catalogSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(Date.parse(receipt.verifiedAt)).toBeGreaterThan(0);
      expect(entry.rights.attribution).toBe(
        `"${entry.title}" Kevin MacLeod (incompetech.com). Licensed under Creative Commons: By Attribution 4.0 License.`,
      );
      expect(generation.canonicalDecode.durationMs).toBe(entry.durationMs);
      expect(generation.canonicalPcmSha256).toBe(entry.hashes.canonicalPcmSha256);
      expect(generation.generatorVersion).toBe(entry.generatorVersion);
    }
  });
  it('matches every packaged audio/map SHA and validates all 24 difficulty maps', () => {
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
