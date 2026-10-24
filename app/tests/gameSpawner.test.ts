import { describe, expect, it } from 'vitest';
import { Spawner } from '../src/game/spawner';
import { Pool } from '../src/utils/pool';
import type { BeatmapV1, Note } from '../src/beatmap/types';

describe('spawn order and bounded ownership', () => {
  it('spawns travelling notes before an earlier beam whose shorter lead is not reached', () => {
    const notes: Note[] = [
      { id: 0, t: 1000, col: 0, row: 1, type: 'beam', dir: 'any', strength: 1 },
      { id: 1, t: 1100, col: 2, row: 1, type: 'slash', dir: 'any', strength: 1 },
    ];
    const map = {
      notes,
      approachMs: 2600,
      obstacles: [],
      events: [{ t: 0, kind: 'kick', intensity: 1 }],
    } as unknown as BeatmapV1;
    const spawner = new Spawner(map);
    const spawned: number[] = [];
    const music: number[] = [];
    const onNote = (note: Note): void => {
      spawned.push(note.id);
    };
    const onMusic = (event: BeatmapV1['events'][number]): void => {
      music.push(event.t);
    };
    spawner.advance(-1500, onNote, () => undefined, onMusic);
    expect(spawned).toEqual([1]);
    spawner.advance(-600, onNote, () => undefined, onMusic);
    expect(spawned).toEqual([1, 0]);
    spawner.advance(50, onNote, () => undefined, onMusic);
    spawner.advance(100, onNote, () => undefined, onMusic);
    expect(music).toEqual([0]);
    spawner.reset();
    spawner.advance(100, onNote, () => undefined, onMusic);
    expect(spawned).toEqual([1, 0, 1, 0]);
  });
  it('does not allocate beyond capacity and ignores double release', () => {
    const pool = new Pool(
      2,
      (index) => ({ index, value: 0 }),
      (item) => {
        item.value = 0;
      },
    );
    const first = pool.take()!,
      second = pool.take()!;
    expect(pool.take()).toBeNull();
    expect(pool.occupancy).toBe(2);
    expect(pool.highWater).toBe(2);
    first.value = 2;
    pool.release(first);
    pool.release(first);
    expect(pool.occupancy).toBe(1);
    expect(pool.take()).toBe(first);
    expect(first.value).toBe(0);
    pool.release(second);
    pool.clear();
    expect(pool.occupancy).toBe(0);
  });
});
