/** Readability and gesture-mix assertions on the nine packaged charts (generator v3). These are
 * algorithmic chart properties, not human comfort or musical-quality evidence. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  APPROACH_MS,
  BEAM_ISOLATION_MS,
  MAX_DENSITY_PER_S,
  MAX_VISIBLE_NOTES,
  PHRASE_MAX_MS,
  PHRASE_REST_MS,
} from '../../src/core/constants';
import { handGapMs } from '../../src/beatmap/assign';

const tracks = new URL('../../public/assets/tracks/', import.meta.url);
const load = (slug, difficulty) =>
  JSON.parse(readFileSync(new URL(`${slug}/${difficulty}.json`, tracks), 'utf8'));
const slugs = ['pamgaea', 'electro-cabello', 'cipher'];
const difficulties = ['easy', 'normal', 'hard'];
const cases = slugs.flatMap((slug) => difficulties.map((difficulty) => [slug, difficulty]));

describe('packaged chart readability (generator v3)', () => {
  it.each(cases)('%s %s mixes slashes, smashes and occasional beams', (slug, difficulty) => {
    const { notes } = load(slug, difficulty);
    const share = (type) => notes.filter((n) => n.type === type).length / notes.length;
    expect(share('slash')).toBeGreaterThanOrEqual(0.3);
    expect(share('smash')).toBeGreaterThanOrEqual(0.2);
    expect(share('smash')).toBeLessThanOrEqual(0.6);
    expect(share('beam')).toBeGreaterThan(0);
    expect(share('beam')).toBeLessThanOrEqual(0.12);
  });

  it.each(cases)('%s %s keeps the screen readable and each hand on its own side', (slug, difficulty) => {
    const { notes, song } = load(slug, difficulty);
    const seconds = song.durationMs / 1000;
    expect(notes.length / seconds).toBeLessThanOrEqual(MAX_DENSITY_PER_S[difficulty]);
    const last = {};
    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];
      const visible = notes.filter((n) => n.t >= note.t && n.t < note.t + APPROACH_MS[difficulty]).length;
      expect(visible).toBeLessThanOrEqual(MAX_VISIBLE_NOTES[difficulty]);
      const side = note.col < 2 ? 'left' : 'right';
      if (last[side])
        expect(note.t - last[side].t).toBeGreaterThanOrEqual(handGapMs(last[side].type, note.type));
      last[side] = note;
      // No two notes ever share a lane at the same moment.
      expect(notes.some((n, j) => j !== i && n.col === note.col && Math.abs(n.t - note.t) < 400)).toBe(false);
      if (note.type === 'beam') {
        expect(note.row).toBe(2);
        expect([0, 3]).toContain(note.col);
        for (const other of [notes[i - 1], notes[i + 1]])
          if (other) expect(Math.abs(other.t - note.t)).toBeGreaterThan(BEAM_ISOLATION_MS);
      }
    }
  });

  it.each(cases)('%s %s gives the player deliberate rests', (slug, difficulty) => {
    const { notes } = load(slug, difficulty);
    let runStart = notes[0].t;
    for (let i = 1; i < notes.length; i++) {
      if (notes[i].t - notes[i - 1].t >= PHRASE_REST_MS[difficulty]) runStart = notes[i].t;
      expect(notes[i].t - runStart).toBeLessThanOrEqual(PHRASE_MAX_MS[difficulty]);
    }
  });

  it.each(slugs)('%s difficulties scale density and walls from Easy to Hard', (slug) => {
    const [easy, normal, hard] = difficulties.map((d) => load(slug, d));
    expect(easy.notes.length).toBeLessThan(normal.notes.length);
    expect(normal.notes.length).toBeLessThan(hard.notes.length);
    expect(easy.obstacles.length).toBeGreaterThan(0);
    expect(hard.obstacles.length).toBeGreaterThanOrEqual(normal.obstacles.length);
    for (const map of [easy, normal, hard]) {
      const left = map.notes.filter((n) => n.col < 2).length / map.notes.length;
      expect(left).toBeGreaterThan(0.35);
      expect(left).toBeLessThan(0.65);
    }
  });
});
