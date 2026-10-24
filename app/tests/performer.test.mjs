/** Synthetic performer logic replay. Plans a performance for real bundled charts and feeds the
 * synthesized frames through the same InputPipeline and GameSession as live input. This proves the
 * choreography satisfies the game's contact rules; it is not webcam, recognition or latency evidence. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { Choreography } from '../src/performer/choreography';
import { PerformerFrameSynthesizer } from '../src/performer/synthesize';
import { InputPipeline } from '../src/tracking/pipeline';
import { GameSession } from '../src/game/session';
import { ClassifierScratch, classify } from '../src/gestures/classifier';
import { handTemplate } from '../src/performer/geometry';
import { TRACK_TARGET_HZ, WINDOW_PERFECT_MS } from '../src/core/constants';

const tracks = new URL('../public/assets/tracks/', import.meta.url);
const slugs = JSON.parse(readFileSync(new URL('manifest.json', tracks), 'utf8')).tracks.map(
  (track) => track.slug,
);
const loadMap = (slug, difficulty) =>
  JSON.parse(readFileSync(new URL(`${slug}/${difficulty}.json`, tracks), 'utf8'));
const FRAME_MS = 1000 / TRACK_TARGET_HZ;
const LATENCY_MS = 45;
const SONG_START_PERF = 10000;

function perform(map) {
  const choreography = new Choreography(map);
  const synth = new PerformerFrameSynthesizer();
  const pipeline = new InputPipeline();
  const performance = Choreography.frame();
  const clock = {
    fromPerformanceTime: (t) => t - SONG_START_PERF,
    now: () => current - SONG_START_PERF,
  };
  let current = 0;
  const events = { hit: [], miss: [], badcut: [], obstacleHit: 0, judgements: {} };
  let session = null;
  let seq = 0;
  const end = SONG_START_PERF + map.song.durationMs + 3000;
  for (let t = 1000; t <= end; t += FRAME_MS) {
    current = t + LATENCY_MS;
    choreography.sample(t - SONG_START_PERF, performance);
    const frame = synth.synthesize(performance, seq++, t);
    const result = pipeline.process(frame, current, 'replay');
    if (!session && result?.calibrationReady && t < SONG_START_PERF - 1000) {
      expect(pipeline.calibrate('synthetic-performer')).not.toBeNull();
      session = new GameSession(map, {
        songClock: clock,
        onEvent: (name, payload) => {
          if (name === 'note:hit') {
            events.hit.push(payload);
            events.judgements[payload.judgement] = (events.judgements[payload.judgement] ?? 0) + 1;
          } else if (name === 'note:miss') events.miss.push(payload.note);
          else if (name === 'note:badcut') events.badcut.push(payload.note);
          else if (name === 'obstacle:hit') events.obstacleHit++;
        },
      });
    }
    if (session && result) {
      session.consume({ seq: frame.seq, tCapture: t, hands: result.hands, body: result.body }, current);
      session.tick(current - SONG_START_PERF);
      expect(session.needsTrackingPause).toBeNull();
    }
  }
  return { choreography, session, events };
}

describe('synthetic performer hand templates', () => {
  it.each([
    ['open', 'open'],
    ['fist', 'fist'],
    ['point', 'point'],
    ['relaxed', 'none'],
  ])('the game classifier reads the %s template as %s', (shape, gesture) => {
    for (const side of [1, -1]) {
      const local = handTemplate(shape, side, new Float32Array(63));
      const landmarks = new Float32Array(63);
      const world = new Float32Array(63);
      for (let j = 0; j < 21; j++) {
        landmarks[j * 3] = 0.5 + local[j * 3] * 0.6;
        landmarks[j * 3 + 1] = 0.5 - (local[j * 3 + 1] * 0.6 * 16) / 9;
        world[j * 3] = local[j * 3];
        world[j * 3 + 1] = -local[j * 3 + 1];
        world[j * 3 + 2] = local[j * 3 + 2];
      }
      const out = { gesture: 'none', confidence: 0, ambiguous: true };
      classify(
        { handedness: 'left', score: 1, landmarks, worldLandmarks: world },
        'none',
        out,
        new ClassifierScratch(),
      );
      expect(out.gesture).toBe(gesture);
    }
  });
});

// Each case replays a full chart at 30 Hz; allow for a busy CI/host CPU.
describe('synthetic performer logic replay on bundled charts', { timeout: 60000 }, () => {
  // Generator v3 budgets each hand's recovery, so every planned chart note is reachable on Easy and
  // Normal; Hard keeps a small allowance for future denser charts.
  const maxUnplayable = { easy: 0, normal: 0, hard: 0.02 };
  it.each(
    slugs.flatMap((slug) =>
      ['easy', 'normal', 'hard'].map((difficulty) => [slug, difficulty, maxUnplayable[difficulty]]),
    ),
  )(
    '%s %s: planned notes are hit on time through the real input pipeline and judge',
    (slug, difficulty, maxUnplayable) => {
      const map = loadMap(slug, difficulty);
      const { choreography, session, events } = perform(map);
      expect(session).not.toBeNull();
      expect(session.finished).toBe(true);
      const unplayable = new Set(choreography.plan.unplayable);
      const playable = map.notes.filter((note) => !unplayable.has(note.id));
      const hitIds = new Set(events.hit.map((hit) => hit.note.id));
      const missedPlayable = playable.filter((note) => !hitIds.has(note.id));
      // Diagnostic summary retained in the test output for the evidence record.
      console.log(
        JSON.stringify({
          slug,
          difficulty,
          notes: map.notes.length,
          unplayable: unplayable.size,
          hits: events.hit.length,
          judgements: events.judgements,
          badcuts: events.badcut.length,
          obstacles: map.obstacles.length,
          obstacleHits: events.obstacleHit,
          missedPlayable: missedPlayable
            .slice(0, 8)
            .map((n) => `${n.id}:${n.type}@${Math.round(n.t)}c${n.col}r${n.row}`),
        }),
      );
      expect(missedPlayable).toEqual([]);
      // Strokes may only clip notes the plan could not assign; planned notes are never bad cuts.
      expect(events.badcut.filter((note) => !unplayable.has(note.id))).toEqual([]);
      expect(events.obstacleHit).toBe(0);
      expect(unplayable.size / map.notes.length).toBeLessThanOrEqual(maxUnplayable);
      // Strokes are planned for Perfect contact; one may occasionally clip a neighbour early.
      const offPerfect = events.hit.filter((hit) => Math.abs(hit.timingErrorMs) > WINDOW_PERFECT_MS);
      expect(offPerfect.length / events.hit.length).toBeLessThanOrEqual(0.02);
    },
  );
});
