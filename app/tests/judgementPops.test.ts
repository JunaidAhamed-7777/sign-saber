import { describe, expect, it } from 'vitest';
import { JudgementPopQueue } from '../src/core/judgementPops';
import { MAX_POPS, POP_LIFETIME_MS } from '../src/core/constants';
describe('judgement pop queue', () => {
  it('reuses MAX_POPS slots, keeps timing only for great/good and retires after the lifetime', () => {
    const queue = new JudgementPopQueue();
    for (let i = 0; i < MAX_POPS + 2; i++)
      queue.push(i % 2 ? 'great' : 'perfect', { x: i, y: 1, z: 0 }, i, 12);
    const live = queue.list();
    expect(live).toHaveLength(MAX_POPS);
    expect(live[0]!.id).toBe(2);
    expect(live.find((pop) => pop.judgement === 'perfect')!.timingMs).toBeNull();
    expect(live.find((pop) => pop.judgement === 'great')!.timingMs).toBe(12);
    expect(queue.prune(POP_LIFETIME_MS + 2)).toBe(true);
    expect(queue.list().map((pop) => pop.id)).toEqual([3, 4, 5, 6, 7]);
    queue.clear();
    expect(queue.list()).toEqual([]);
    expect(queue.prune(1e9)).toBe(false);
  });
});
