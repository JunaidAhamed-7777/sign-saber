/** Pure trajectory tests, not evidence of visible pixels, webcam scoring or human readability. */
import { describe, expect, it } from 'vitest';
import { TerminalNoteVisuals } from '../src/render/failures';
import { createLiveNote, LANE_DIRECTION, notePosition } from '../src/game/liveObjects';
import type { LiveNote } from '../src/game/liveObjects';
import type { Note } from '../src/beatmap/types';
import {
  APPROACH_MS,
  BADCUT_MS,
  BADCUT_PUSHBACK_M,
  BEAM_ESCAPE_RISE_M,
  BEAM_ESCAPE_VISUAL_MS,
  BEAM_HOVER_Y_OFFSET,
  BEAM_HOVER_Z,
  DESPAWN_Z,
  LANE_Y,
  MISS_DIM_MS,
  TERMINAL_DIM_FACTOR,
} from '../src/core/constants';

function terminal(id = 0, type: Note['type'] = 'slash', state: LiveNote['state'] = 'missed'): LiveNote {
  const live = createLiveNote({ id, t: 1000, type, col: 2, row: 1, dir: 'any', strength: 1 });
  live.state = state;
  live.spawned = true;
  live.rotation = 0.45;
  return live;
}
const expected = { x: 0, y: 0, z: 0 };

describe('terminal-note presentation remains separate from judging', () => {
  it('dims a still-visible miss on its exact chart trajectory and stops rotation without writing game data', () => {
    const pool = new TerminalNoteVisuals(),
      live = terminal(),
      before = JSON.stringify(live);
    Object.freeze(live.note);
    Object.freeze(live.pos);
    Object.freeze(live);
    pool.prepare([live]);
    // Slow synthetic approach keeps the target visible through the fade; this is geometry evidence.
    const approach = 10000;
    expect(pool.resolve(live.note, 'miss', 1200)).toBe(true);
    const first = pool.sample(0, 1200, approach, false)!;
    expect(first.brightness).toBe(1);
    expect(first.rotation).toBe(live.rotation);
    const later = pool.sample(0, 1200 + MISS_DIM_MS, approach, false)!;
    notePosition(live.note, 1200 + MISS_DIM_MS, approach, expected);
    expect(later).toBe(first);
    expect(later.position).toEqual(expected);
    expect(later.brightness).toBe(TERMINAL_DIM_FACTOR);
    expect(later.redMix).toBe(0);
    expect(JSON.stringify(live)).toBe(before);
  });

  it('keeps a late Normal miss culled rather than pulling it back for a fabricated fade', () => {
    const pool = new TerminalNoteVisuals(),
      live = terminal();
    pool.prepare([live]);
    pool.resolve(live.note, 'miss', 1250);
    notePosition(live.note, 1250, APPROACH_MS.normal, expected);
    expect(expected.z).toBeGreaterThan(DESPAWN_Z);
    expect(pool.sample(0, 1250, APPROACH_MS.normal, false)).toBeNull();
    expect(pool.sample(0, 5000, APPROACH_MS.normal, false)).toBeNull();
    expect(live.state).toBe('missed');
  });

  it('uses one smooth backwards spring for Bad Cut, then dims, with a fixed alternative in Calm', () => {
    const pool = new TerminalNoteVisuals(),
      live = terminal(0, 'smash', 'badcut'),
      approach = 10000;
    pool.prepare([live]);
    expect(pool.resolve(live.note, 'badcut', 1000)).toBe(true);
    const start = pool.sample(0, 1000, approach, false)!;
    expect(start.redMix).toBe(1);
    const halfTime = 1000 + BADCUT_MS / 2,
      half = pool.sample(0, halfTime, approach, false)!;
    notePosition(live.note, halfTime, approach, expected);
    expect(half.position.z).toBeCloseTo(expected.z - LANE_DIRECTION.z * BADCUT_PUSHBACK_M);
    expect(half.position.y).toBeCloseTo(expected.y - LANE_DIRECTION.y * BADCUT_PUSHBACK_M);
    expect(half.redMix).toBeCloseTo(0.5);
    const calm = pool.sample(0, halfTime, approach, true)!;
    expect(calm.position).toEqual(expected);
    const end = pool.sample(0, 1000 + BADCUT_MS, approach, false)!;
    notePosition(live.note, 1000 + BADCUT_MS, approach, expected);
    expect(end.position).toEqual(expected);
    expect(end.redMix).toBe(0);
    expect(end.brightness).toBe(1);
    expect(pool.sample(0, 1000 + BADCUT_MS + MISS_DIM_MS, approach, false)!.brightness).toBe(
      TERMINAL_DIM_FACTOR,
    );
  });

  it('retains the first terminal latch across repeated or conflicting events, including after despawn', () => {
    const pool = new TerminalNoteVisuals(),
      live = terminal(0, 'slash', 'badcut');
    pool.prepare([live]);
    expect(pool.resolve(live.note, 'badcut', 1000)).toBe(true);
    expect(pool.resolve(live.note, 'badcut', 1100)).toBe(false);
    expect(pool.sample(0, 1110, 10000, false)!.redMix).toBeCloseTo(0.5);
    live.state = 'missed'; // Even a faulty consumer cannot restart the existing visual.
    expect(pool.resolve(live.note, 'miss', 1110)).toBe(false);
    expect(pool.sample(0, 1110, 10000, false)!.redMix).toBeCloseTo(0.5);
    expect(pool.sample(0, 10000, 10000, false)).toBeNull();
    expect(pool.resolve(live.note, 'miss', 10000)).toBe(false);
    expect(live.state).toBe('missed');
  });

  it('latches first-draw terminal state, rejects unrelated data and clears latches between charts', () => {
    const pool = new TerminalNoteVisuals(),
      old = terminal(),
      next = terminal();
    pool.prepare([old]);
    expect(pool.resolve(next.note, 'miss', 1000)).toBe(false);
    expect(pool.sample(-1, 1000, 10000, false)).toBeNull();
    expect(pool.sample(0, Infinity, 10000, false)).toBeNull();
    expect(pool.sample(0, 1000, 0, false)).toBeNull();
    expect(pool.sample(0, 1100, 10000, false)!.brightness).toBe(1);
    expect(pool.sample(0, 1100 + MISS_DIM_MS, 10000, false)!.brightness).toBe(TERMINAL_DIM_FACTOR);
    pool.reset();
    expect(pool.sample(0, 1100, 10000, false)).toBeNull();
    pool.prepare([next]);
    expect(pool.resolve(next.note, 'miss', 1100)).toBe(true);
    expect(pool.sample(0, 1100, 10000, false)!.brightness).toBe(1);
  });

  it('lets a missed beam escape upward, fades in place for Calm and releases at the exact deadline', () => {
    const pool = new TerminalNoteVisuals(),
      live = terminal(0, 'beam', 'escaped');
    pool.prepare([live]);
    pool.resolve(live.note, 'miss', 1250);
    const hover = LANE_Y[live.note.row] + BEAM_HOVER_Y_OFFSET,
      midTime = 1250 + BEAM_ESCAPE_VISUAL_MS / 2,
      rise = pool.sample(0, midTime, APPROACH_MS.normal, false)!;
    expect(rise.position.y).toBeCloseTo(hover + BEAM_ESCAPE_RISE_M / 2);
    expect(rise.position.z).toBe(BEAM_HOVER_Z);
    expect(rise.brightness).toBeCloseTo(TERMINAL_DIM_FACTOR / 2);
    expect(pool.sample(0, midTime, APPROACH_MS.normal, true)!.position.y).toBe(hover);
    expect(pool.sample(0, 1250 + BEAM_ESCAPE_VISUAL_MS - 1, APPROACH_MS.normal, false)).not.toBeNull();
    expect(pool.sample(0, 1250 + BEAM_ESCAPE_VISUAL_MS, APPROACH_MS.normal, false)).toBeNull();
    expect(live.state).toBe('escaped');
  });
});
