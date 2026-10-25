import { describe, expect, it } from 'vitest';
import { GameSession } from '../src/game/session';
import type { GameEventHandler, SessionInput } from '../src/game/session';
import type { BeatmapV1, Note } from '../src/beatmap/types';
import type { BodyState, HandCursor } from '../src/core/types';
import { LANE_X, LANE_Y } from '../src/core/constants';

const note = (id: number, time: number, type: Note['type'] = 'slash', col: Note['col'] = 2): Note => ({
  id,
  t: time,
  type,
  col,
  row: 1,
  dir: 'any',
  strength: 1,
});
function map(notes: Note[], obstacles: BeatmapV1['obstacles'] = []): BeatmapV1 {
  return {
    version: 1,
    generatorVersion: 1,
    song: {
      title: 'Synthetic correctness fixture',
      artist: 'Sign Saber tests',
      durationMs: 5000,
      bpm: 120,
      beatOffsetMs: 0,
      sourceHash: '0'.repeat(64),
      source: 'upload',
    },
    difficulty: 'normal',
    approachMs: 2000,
    notes,
    obstacles,
    events: [],
    analysis: { beats: [], onsets: [], energy: [] },
  };
}
function cursor(time: number, x: number = LANE_X[2], hand: HandCursor['hand'] = 'right'): HandCursor {
  return {
    hand,
    present: true,
    tCapture: time,
    gesture: 'open',
    gestureConfidence: 1,
    gestureHeldMs: 1000,
    pos: { x, y: LANE_Y[1], z: 0 },
    vel: { x: 4, y: 0, z: 0 },
    speed: 4,
    tip: { x, y: LANE_Y[1], z: 0 },
    pointDir: { x: 0, y: 1 },
    bladeActive: false,
    bladeLength: 0,
    charge: 0,
    history: [],
  };
}
function body(time: number, lean: BodyState['lean'] = 'center'): BodyState {
  return {
    present: true,
    tCapture: time,
    centerX: 0.5,
    leanX: lean === 'right' ? 1 : lean === 'left' ? -1 : 0,
    lean,
    tilt: 0,
    duck: false,
    torsoSpeed: 0,
  };
}
function fixture(chart: BeatmapV1) {
  let now = 0;
  const events: unknown[][] = [];
  const onEvent: GameEventHandler = (type, payload) => {
    if (
      type === 'note:hit' ||
      type === 'note:miss' ||
      type === 'note:badcut' ||
      type === 'beam:fire' ||
      type === 'obstacle:hit' ||
      type === 'obstacle:dodged' ||
      type === 'session:end'
    )
      events.push([type, JSON.parse(JSON.stringify(payload))]);
  };
  const session = new GameSession(chart, {
    songClock: { now: () => now, fromPerformanceTime: (time) => time },
    epoch: 7,
    onEvent,
  });
  let seq = 0;
  return {
    session,
    events,
    tick(time: number) {
      now = time;
      session.tick(time);
    },
    consume(time: number, hands: HandCursor[], bodyState: BodyState | null = body(time), arrival = time) {
      now = arrival;
      return session.consume({ seq: seq++, epoch: 7, tCapture: time, hands, body: bodyState }, arrival);
    },
  };
}

describe('capture-only deterministic session', () => {
  it('scores a swept hit once, including late delivery, and rejects duplicates and old epochs', () => {
    const run = fixture(map([note(0, 1000)]));
    run.consume(980, [cursor(980, -0.4)]);
    run.tick(1230);
    expect(run.session.stats.counts.miss).toBe(0);
    run.consume(1020, [cursor(1020, LANE_X[2] + 1)], body(1020), 1240);
    expect(run.session.stats.counts.perfect).toBe(1);
    expect(run.session.score).toBe(100);
    const duplicate: SessionInput = {
      seq: 1,
      epoch: 7,
      tCapture: 1020,
      hands: [cursor(1020)],
      body: body(1020),
    };
    expect(run.session.consume(duplicate, 1240)).toBe(false);
    expect(run.session.consume({ ...duplicate, seq: 4, epoch: 6, tCapture: 1030 }, 1240)).toBe(false);
    run.tick(6500);
    expect(run.session.finished).toBe(true);
    expect(run.events.filter(([kind]) => kind === 'note:hit')).toHaveLength(1);
    expect(Object.isFrozen(run.session.stats)).toBe(true);
    expect(run.session.consume({ ...duplicate, seq: 5 }, 1240)).toBe(false);
  });
  it('prefers the valid simultaneous hand over a bad cut and breaks exact ties by hand identity', () => {
    const run = fixture(map([note(0, 1000)]));
    const bad = cursor(1000, LANE_X[2], 'left');
    bad.gesture = 'fist';
    run.consume(1000, [bad, cursor(1000)]);
    expect(run.session.stats.counts.perfect).toBe(1);
    expect(run.session.stats.counts.badcut).toBe(0);
    const reverse = fixture(map([note(0, 1000)]));
    reverse.consume(1000, [cursor(1000), cursor(1000, LANE_X[2], 'left')]);
    const event = reverse.events.find(([kind]) => kind === 'note:hit')!;
    expect(event[1]).toMatchObject({ hand: 'left' });
  });
  it('does not sweep through loss/reacquisition, does not score pre-roll, and rejects over-age input', () => {
    const run = fixture(map([note(0, 1000)]));
    run.consume(-10, [cursor(-10)]);
    expect(run.session.score).toBe(0);
    run.consume(970, [cursor(970, LANE_X[2] - 1)]);
    run.consume(990, []);
    run.consume(1020, [cursor(1020, LANE_X[2] + 1)]);
    expect(run.session.score).toBe(0);
    expect(run.consume(1050, [cursor(1050)], body(1050), 1301)).toBe(false);
    run.tick(1451);
    expect(run.session.stats.counts.miss).toBe(1);
  });
  it('clips a fast crossing to the timing window and rejects malformed coordinates', () => {
    const run = fixture(map([note(0, 1000)]));
    const bad = cursor(1000);
    bad.pos.x = NaN;
    expect(run.consume(1000, [bad])).toBe(false);
    run.consume(750, [cursor(750, LANE_X[2] - 3.6)]);
    run.consume(950, [cursor(950, LANE_X[2] + 1.4)]);
    expect(run.session.stats.counts.good).toBe(1);
    expect(run.session.stats.counts.perfect).toBe(0);
  });
  it('ignores every stale field of an absent hand instead of rejecting the fresh frame', () => {
    const run = fixture(map([note(0, 1000)]));
    const absent = cursor(1, 0, 'left');
    absent.present = false;
    absent.pos.x = NaN;
    absent.speed = NaN;
    expect(run.consume(1000, [absent, cursor(1000)])).toBe(true);
    expect(run.session.stats.counts.perfect).toBe(1);
  });
  it('auto-aims a charged point at the next visible beam target and never doubles it', () => {
    const beam = note(0, 1000, 'beam');
    const run = fixture(map([beam]));
    // Aim is irrelevant: the hand points anywhere.
    const point = (time: number, hand: HandCursor['hand'] = 'right'): HandCursor => ({
      ...cursor(time, LANE_X[0], hand),
      gesture: 'point',
      charge: 1,
      speed: 0,
    });
    run.consume(800, [point(800), point(800, 'left')]);
    expect(run.events.filter(([kind]) => kind === 'beam:fire')).toHaveLength(1);
    expect(run.session.stats.counts.good).toBe(1);
    run.consume(1000, [point(1000)]);
    expect(run.events.filter(([kind]) => kind === 'note:hit')).toHaveLength(1);
  });
  it('evaluates wall samples once and never pauses or rewards an unobserved wall', () => {
    const wall = { id: 0, t: 1000, durationMs: 600, kind: 'wallLeft' as const };
    const safe = fixture(map([], [wall]));
    for (let time = 1120; time <= 1600; time += 80) safe.consume(time, [], body(time, 'right'));
    safe.consume(1640, [], body(1640, 'right'));
    expect(safe.session.stats.counts.obstaclesDodged).toBe(1);
    expect(safe.session.stats.accuracy).toBe(1);
    const hit = fixture(map([], [wall]));
    hit.consume(1100, [], body(1100));
    expect(hit.session.stats.counts.obstaclesHit).toBe(0);
    hit.consume(1120, [], body(1120));
    hit.consume(1150, [], body(1150));
    expect(hit.session.stats.counts.obstaclesHit).toBe(1);
    const absent = fixture(map([], [wall]));
    absent.consume(1120, [], null);
    absent.tick(1900);
    expect(absent.session.stats.counts.obstaclesDodged).toBe(0);
    expect(absent.session.stats.counts.obstaclesHit).toBe(0);
    expect(absent.session.needsTrackingPause).toBeNull();
  });
  it('drops paused inputs and resets the sweep and capture epoch boundary at resume', () => {
    const run = fixture(map([note(0, 1000)]));
    run.consume(970, [cursor(970, LANE_X[2] - 1)]);
    run.session.pause();
    run.session.freezeAt(1010);
    expect(run.session.latestTime).toBe(1010);
    expect(run.session.notes[0]!.pos.z).toBeGreaterThan(0);
    expect(run.session.score).toBe(0);
    expect(run.consume(990, [cursor(990)])).toBe(false);
    run.session.resume(1000);
    expect(run.consume(995, [cursor(995)])).toBe(false);
    run.consume(1020, [cursor(1020, LANE_X[2] + 1)]);
    expect(run.session.score).toBe(0);
  });
  it('replays identical captures at 30/60/120 Hz and across a render stall with identical ordered results', () => {
    const chart = map([note(0, 1000), note(1, 2000, 'smash', 1), note(2, 3000)]);
    const replay = (hz: number, stall: boolean): unknown => {
      const run = fixture(chart);
      const samples = [
        { time: 980, hand: cursor(980, -0.4) },
        { time: 1020, hand: cursor(1020, LANE_X[2] + 1) },
        { time: 1980, hand: { ...cursor(1980, -1.6), gesture: 'fist' as const } },
        { time: 2020, hand: { ...cursor(2020, 0.4), gesture: 'fist' as const } },
        { time: 2980, hand: cursor(2980, -0.4) },
        { time: 3020, hand: cursor(3020, 1.6) },
      ];
      let index = 0;
      for (let time = 0; time <= 6600; time += 1000 / hz) {
        while (index < samples.length && samples[index]!.time <= time) {
          const sample = samples[index++]!;
          run.consume(sample.time, [sample.hand]);
        }
        if (!stall || time < 900 || time > 1500) run.tick(time);
      }
      run.tick(6600);
      return { events: run.events, stats: run.session.stats };
    };
    const baseline = replay(60, false);
    expect(replay(30, false)).toEqual(baseline);
    expect(replay(120, false)).toEqual(baseline);
    expect(replay(60, true)).toEqual(baseline);
  });
});
