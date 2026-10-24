import { describe, expect, it } from 'vitest';
import type { BeatmapV1 } from '../../src/beatmap/types';
import { validateBeatmap } from '../../src/beatmap/validate';
import { APPROACH_MS, GENERATOR_VERSION, VALIDATION_MAX_ERRORS } from '../../src/core/constants';

export function fixture(): BeatmapV1 {
  return {
    version: 1,
    generatorVersion: GENERATOR_VERSION,
    song: {
      title: 'Synthetic schema fixture',
      artist: 'Sign Saber tests',
      durationMs: 10000,
      bpm: 120,
      beatOffsetMs: 0,
      sourceHash: '0'.repeat(64),
      source: 'upload',
    },
    difficulty: 'normal',
    approachMs: APPROACH_MS.normal,
    notes: [
      { id: 0, t: 1000, type: 'slash', col: 1, row: 1, dir: 'any', strength: 1 },
      { id: 1, t: 2000, type: 'smash', col: 2, row: 1, dir: 'any', strength: 0.8 },
      { id: 2, t: 4000, type: 'beam', col: 3, row: 2, dir: 'any', strength: 0.7 },
    ],
    obstacles: [{ id: 0, t: 8000, durationMs: 600, kind: 'wallLeft' }],
    events: [{ t: 1000, kind: 'kick', intensity: 1 }],
    analysis: { beats: [1000, 1500, 2000], onsets: [], energy: [] },
  };
}
describe('unknown beatmap admission', () => {
  it('accepts a complete finite fixture and returns the validated identity', () => {
    const map = fixture();
    expect(validateBeatmap(map)).toEqual({ valid: true, errors: [], map });
  });
  it.each([null, 2, [], {}, { song: null }, { song: { title: 'x' }, notes: null }])(
    'rejects malformed outer structures without dereferencing',
    (value) => {
      const result = validateBeatmap(value);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.length).toBeLessThanOrEqual(VALIDATION_MAX_ERRORS);
    },
  );
  it('rejects invalid timebases, source hashes, versions and unsafe audio paths', () => {
    for (const mutate of [
      (map: BeatmapV1) => {
        map.song.durationMs = NaN;
      },
      (map: BeatmapV1) => {
        map.song.beatOffsetMs = 500;
      },
      (map: BeatmapV1) => {
        map.song.sourceHash = 'invented';
      },
      (map: BeatmapV1) => {
        map.generatorVersion = GENERATOR_VERSION + 1;
      },
      (map: BeatmapV1) => {
        map.song.source = 'bundled';
        map.song.audioUrl = '/assets/tracks/../private/audio.mp3';
      },
      (map: BeatmapV1) => {
        map.song.source = 'bundled';
        map.song.audioUrl = 'https://example.org/audio.mp3';
      },
    ]) {
      const map = fixture();
      mutate(map);
      expect(validateBeatmap(map).valid).toBe(false);
    }
  });
  it('rejects duplicate terminal IDs, same-cell collisions and transitive chords', () => {
    const duplicate = fixture();
    duplicate.notes[1]!.id = 0;
    expect(validateBeatmap(duplicate).errors.some((e) => e.path.endsWith('.id'))).toBe(true);
    const close = fixture();
    close.notes[1]!.t = 1050;
    close.notes[1]!.col = 1;
    expect(validateBeatmap(close).valid).toBe(false);
    const chain = fixture();
    chain.notes[1]!.t = 1015;
    chain.notes[2]!.t = 1030;
    chain.notes[2]!.type = 'slash';
    expect(validateBeatmap(chain).valid).toBe(false);
  });
  it('enforces beam preparation/isolation, wall margins and easy recovery', () => {
    const beam = fixture();
    beam.notes[2]!.t = 2500;
    expect(validateBeatmap(beam).errors.some((e) => e.message.includes('Beam'))).toBe(true);
    const wall = fixture();
    wall.notes.push({ id: 3, t: 7900, type: 'slash', col: 0, row: 1, dir: 'any', strength: 1 });
    expect(validateBeatmap(wall).errors.some((e) => e.message.includes('Wall overlaps'))).toBe(true);
    const easy = fixture();
    easy.difficulty = 'easy';
    easy.approachMs = APPROACH_MS.easy;
    easy.notes[0]!.row = 0;
    easy.notes[1]!.row = 0;
    expect(validateBeatmap(easy).errors.some((e) => e.message.includes('low-row'))).toBe(true);
  });
  it('bounds hostile arrays and rejects empty levels rather than pretending silence is playable', () => {
    const map = fixture();
    map.notes = [];
    expect(validateBeatmap(map).valid).toBe(false);
    const huge = { ...fixture(), notes: new Array(100000).fill(null) };
    expect(validateBeatmap(huge).valid).toBe(false);
  });
  it.each(['normal', 'hard'] as const)(
    'accepts a supported two-note opposite-side chord at %s',
    (difficulty) => {
      const map = fixture();
      map.difficulty = difficulty;
      map.approachMs = APPROACH_MS[difficulty];
      map.notes[1]!.t = 1010;
      map.analysis.onsets = [
        { t: 1000, band: 'low', strength: 1 },
        { t: 1010, band: 'high', strength: 0.8 },
      ];
      expect(validateBeatmap(map)).toMatchObject({ valid: true, errors: [] });
      map.analysis.onsets[1]!.band = 'low';
      expect(validateBeatmap(map).errors.some((error) => error.message.includes('supporting evidence'))).toBe(
        true,
      );
      map.difficulty = 'easy';
      map.approachMs = APPROACH_MS.easy;
      expect(validateBeatmap(map).valid).toBe(false);
    },
  );
});
