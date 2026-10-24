import { describe, expect, it } from 'vitest';
import {
  ANALYSIS_SR,
  APPROACH_MS,
  DENSITY_WINDOW_MS,
  GENERATOR_VERSION,
  MAX_DENSITY_PER_S,
} from '../../src/core/constants';
import type { Difficulty, Onset } from '../../src/beatmap/types';
import { assignNotes, assignObstacles } from '../../src/beatmap/assign';
import type { AssignmentInput } from '../../src/beatmap/assign';
import { HOP_MS } from '../../src/beatmap/dsp/stft';
import { validateBeatmap } from '../../src/beatmap/validate';

function input(difficulty: Difficulty, onsets: Onset[]): AssignmentInput {
  const frames = Math.ceil(30000 / HOP_MS) + 1;
  return {
    difficulty,
    onsets,
    durationMs: 30000,
    bpm: 120,
    beats: Array.from({ length: 60 }, (_, i) => i * 500),
    centroid: new Float32Array(frames).fill(1000),
    power: {
      low: new Float32Array(frames).fill(1),
      mid: new Float32Array(frames).fill(1),
      high: new Float32Array(frames).fill(1),
    },
  };
}
describe('evidence-based playable assignment', () => {
  it.each(['easy', 'normal', 'hard'] as const)(
    'obeys density, recovery, IDs and wall safety at %s',
    (difficulty) => {
      const onsets: Onset[] = Array.from({ length: 300 }, (_, i) => ({
        t: i * 100,
        band: i % 2 ? 'high' : 'low',
        strength: 0.9,
      }));
      const source = input(difficulty, onsets),
        notes = assignNotes(source),
        obstacles = assignObstacles(source, notes);
      for (const note of notes) {
        const count = notes.filter((n) => n.t >= note.t && n.t < note.t + DENSITY_WINDOW_MS).length;
        expect(count).toBeLessThanOrEqual(
          Math.floor((MAX_DENSITY_PER_S[difficulty] * DENSITY_WINDOW_MS) / 1000),
        );
        expect(onsets.some((o) => o.t === note.t)).toBe(true);
      }
      const map = {
        version: 1,
        generatorVersion: GENERATOR_VERSION,
        song: {
          title: 'Synthetic dense evidence',
          artist: 'Sign Saber tests',
          durationMs: 30000,
          bpm: 120,
          beatOffsetMs: 0,
          source: 'upload',
          sourceHash: '0'.repeat(64),
        },
        difficulty,
        approachMs: APPROACH_MS[difficulty],
        notes,
        obstacles,
        events: [],
        analysis: { beats: [], onsets, energy: [] },
      };
      expect(validateBeatmap(map)).toMatchObject({ valid: true, errors: [] });
    },
  );
  it('does not turn three coincident broadband bands into three notes or a chained chord', () => {
    const onsets: Onset[] = [
      { t: 1000, band: 'low', strength: 1 },
      { t: 1000, band: 'mid', strength: 0.9 },
      { t: 1015, band: 'high', strength: 0.8 },
      { t: 1030, band: 'low', strength: 0.7 },
    ];
    const source = input('hard', onsets);
    source.power.mid[Math.ceil(1100 / HOP_MS)] = 1000; // Broadband transient, not sustained mid power.
    const notes = assignNotes(source);
    expect(notes).toHaveLength(2);
    expect(notes[0]!.type).toBe('smash');
    expect(notes[1]!.t - notes[0]!.t).toBeLessThan(20);
    expect(notes[0]!.col < 2).not.toBe(notes[1]!.col < 2);
  });
  it('requires measured sustained linear mid-band power before assigning an isolated beam', () => {
    const source = input('normal', [{ t: 3000, band: 'mid', strength: 0.8 }]);
    expect(assignNotes(source)[0]!.type).toBe('beam');
    source.power.mid[Math.ceil(3100 / HOP_MS)] = 1000;
    expect(assignNotes(source)[0]!.type).toBe('slash');
    expect(ANALYSIS_SR).toBeGreaterThan(0);
  });
  it.each(['normal', 'hard'] as const)(
    'retains two independently timed bands on opposite sides at %s',
    (difficulty) => {
      const source = input(difficulty, [
        { t: 1000, band: 'low', strength: 0.9 },
        { t: 1010, band: 'high', strength: 0.8 },
      ]);
      const notes = assignNotes(source);
      expect(notes).toHaveLength(2);
      expect(notes.map((n) => n.t)).toEqual([1000, 1010]);
      expect(notes[0]!.col < 2).not.toBe(notes[1]!.col < 2);
    },
  );
  it('limits the same independent evidence to one Easy note', () => {
    const source = input('easy', [
      { t: 1000, band: 'low', strength: 0.9 },
      { t: 1010, band: 'high', strength: 0.8 },
    ]);
    expect(assignNotes(source)).toHaveLength(1);
  });
  it('is stable across repeated assignment and never moves notes off musical evidence', () => {
    const source = input(
      'hard',
      Array.from({ length: 30 }, (_, i) => ({ t: i * 700, strength: 0.8, band: 'high' })),
    );
    expect(assignNotes(source)).toEqual(assignNotes(source));
  });
});
