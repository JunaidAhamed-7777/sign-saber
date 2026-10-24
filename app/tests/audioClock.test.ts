import { describe, expect, it } from 'vitest';
import { SongClock } from '../src/audio/songClock';
import type { ClockContext } from '../src/audio/songClock';
import { computeStartLead } from '../src/audio/player';
import type { BeatmapV1 } from '../src/beatmap/types';

class FakeContext implements ClockContext {
  currentTime = 10;
  baseLatency = 0.01;
  outputLatency = 0.04;
  state = 'running';
  timestamp: { contextTime: number; performanceTime: number } | null = null;
  getOutputTimestamp = () => this.timestamp ?? { contextTime: 0, performanceTime: 0 };
  async suspend(): Promise<void> {
    this.state = 'suspended';
  }
  async resume(): Promise<void> {
    this.state = 'running';
  }
}
describe('output-aligned audio master clock', () => {
  it('uses nonzero performance/audio origins and does not double-compensate a timestamp', () => {
    const context = new FakeContext();
    let performanceTime = 50000;
    const clock = new SongClock(context, () => performanceTime);
    expect(clock.now()).toBeNaN();
    expect(clock.scheduleStart(2)).toBe(12);
    expect(clock.now()).toBeCloseTo(-2050);
    context.currentTime = 12.3;
    performanceTime += 2300;
    context.timestamp = { contextTime: 12.25, performanceTime: performanceTime - 5 };
    expect(clock.now()).toBeCloseTo(255);
    expect(clock.fromPerformanceTime(performanceTime - 25)).toBeCloseTo(230);
    expect(clock.timingSource).toBe('output-timestamp');
  });
  it('freezes after actual suspension and rejects paused-segment captures', async () => {
    const context = new FakeContext();
    let performanceTime = 1000;
    const clock = new SongClock(context, () => performanceTime);
    clock.scheduleStart(0);
    context.currentTime = 11;
    performanceTime = 2000;
    await clock.pause();
    expect(clock.now()).toBe(1000);
    performanceTime = 12000;
    expect(clock.now()).toBe(1000);
    expect(clock.fromPerformanceTime(7000)).toBeNaN();
    await clock.resume();
    expect(clock.now()).toBe(1000);
    expect(clock.fromPerformanceTime(7000)).toBeNaN();
    context.currentTime = 11.2;
    performanceTime += 200;
    expect(clock.now()).toBeCloseTo(1150);
    clock.end();
    context.currentTime += 2;
    performanceTime += 2000;
    expect(clock.now()).toBeCloseTo(3150);
    clock.reset();
    expect(clock.now()).toBeNaN();
  });
  it('rejects start before browser audio unlock', () => {
    const context = new FakeContext();
    context.state = 'suspended';
    expect(() => new SongClock(context).scheduleStart()).toThrow('Enable sound');
  });
  it('preserves approach during negative-time pre-roll and extends slow countdown', () => {
    const map = {
      song: { bpm: 120 },
      approachMs: 2600,
      notes: [{ t: 0, type: 'slash' }],
      obstacles: [],
    } as unknown as BeatmapV1;
    expect(computeStartLead(map)).toBe(2750);
    map.song.bpm = 40;
    expect(computeStartLead(map)).toBe(4500);
    expect(computeStartLead(map, false)).toBe(2750);
  });
});
