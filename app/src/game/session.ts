/**
 * Sign Saber — game/session.ts
 *
 * Responsibility: SessionStats accumulation and highlight:capture trigger at new peak combo.
 * Spec: docs/02-architecture.md §SessionStats; docs/07
 * Inputs: Events
 * Outputs: SessionStats
 *
 * Implemented for the first playable spine. Replay/unit evidence is separate from live-camera acceptance.
 */
import type { BeatmapV1 } from '../beatmap/types';
import type { BodyState, Gesture, Hand, HandCursor, SessionStats, Vec3 } from '../core/types';
import type { GameEvents } from '../core/events';
import {
  BEAM_CHARGE_MS,
  BEAM_LEAD_MS,
  BEAM_REFIRE_LOCK_MS,
  GESTURE_CONFIDENCE_MIN,
  HIGHLIGHT_DEBOUNCE_MS,
  HIGHLIGHT_MIN_COMBO,
  INPUT_MAX_AGE_MS,
  INPUT_OFFSET_DEFAULT_MS,
  MAX_LIVE_NOTES,
  OBSTACLE_GRACE_MS,
  SONG_TAIL_MS,
  WINDOW_GOOD_MS,
  WINDOW_SCALE,
} from '../core/constants';
import { finite3, clamp, lerp } from '../utils/math';
import { contactOutcome, judgeTiming, timingError } from './judge';
import type { ContactOutcome } from './judge';
import {
  beamAimTarget,
  beamAimed,
  makeCutPlane,
  obstacleSafe,
  sweptBladeContact,
  sweptPalmContact,
} from './hit';
import { createLiveNote, createLiveObstacle, updateLiveNote, updateLiveObstacle } from './liveObjects';
import type { LiveNote, LiveObstacle } from './liveObjects';
import { ScoreState, rankFor } from './score';
import { KineticMeter } from './kinetic';
import { Spawner } from './spawner';

export type GameEventHandler = <K extends keyof GameEvents>(event: K, payload: GameEvents[K]) => void;
export interface SessionInput {
  seq: number;
  epoch?: number;
  tCapture: number;
  hands: readonly HandCursor[];
  body: BodyState | null;
}
export interface SessionOptions {
  songClock: { fromPerformanceTime(time: number): number; now(): number };
  inputOffsetMs?: number;
  windowScale?: number;
  epoch?: number;
  physicalScale?: number;
  onEvent?: GameEventHandler;
}
interface HandMemory {
  present: boolean;
  tCapture: number;
  songTime: number;
  gesture: Gesture;
  pos: Vec3;
  vel: Vec3;
  bladeActive: boolean;
  bladeLength: number;
}
interface Candidate {
  live: LiveNote;
  cursor: HandCursor;
  outcome: ContactOutcome;
  songTime: number;
  alpha: number;
  perfTime: number;
}
const HAND_ORDER = ['left', 'right'] as const;
const compareCandidates = (a: Candidate, b: Candidate): number =>
  a.perfTime - b.perfTime || a.live.note.t - b.live.note.t || a.live.note.id - b.live.note.id;
const handMemory = (): HandMemory => ({
  present: false,
  tCapture: -Infinity,
  songTime: -Infinity,
  gesture: 'none',
  pos: { x: 0, y: 0, z: 0 },
  vel: { x: 0, y: 0, z: 0 },
  bladeActive: false,
  bladeLength: 0,
});

/** Capture samples are the sole source of contacts; tick only spawns, draws and closes bounded deadlines. */
export class GameSession {
  readonly notes: LiveNote[];
  readonly obstacles: LiveObstacle[];
  readonly stats: SessionStats;
  readonly diagnostics = { accepted: 0, duplicate: 0, stale: 0, invalid: 0, wrongEpoch: 0 };
  needsTrackingPause: string | null = null;
  latestTime = -Infinity;
  finished = false;
  private paused = false;
  private lastSequence = -1;
  private lastCapture = -Infinity;
  private captureWatermark = -Infinity;
  private acceptAfterPerf = -Infinity;
  private bodyLastSong = -Infinity;
  private readonly hands = { left: handMemory(), right: handMemory() };
  private readonly beamLocks = { left: -Infinity, right: -Infinity };
  private readonly beamReady = { left: -Infinity, right: -Infinity };
  private readonly inputOffsetMs: number;
  private readonly windowScale: number;
  private readonly onEvent: GameEventHandler;
  private readonly scoring: ScoreState;
  private readonly kinetic: KineticMeter;
  private readonly spawner: Spawner;
  private readonly candidates: Candidate[] = [];
  private readonly candidatePool: Candidate[];
  private readonly scratch = {
    a: { x: 0, y: 0, z: 0 },
    b: { x: 0, y: 0, z: 0 },
    tip0: { x: 0, y: 0, z: 0 },
    tip1: { x: 0, y: 0, z: 0 },
    aim: { x: 0, y: 0, z: 0 },
  };
  private lastHighlight = -Infinity;
  private peakComboSongTime = 0;
  private readonly progress = { songTimeMs: 0, durationMs: 0 };
  readonly epoch: number;
  constructor(
    readonly map: BeatmapV1,
    private readonly options: SessionOptions,
  ) {
    this.epoch = options.epoch ?? 0;
    this.inputOffsetMs = options.inputOffsetMs ?? INPUT_OFFSET_DEFAULT_MS;
    this.windowScale = options.windowScale ?? WINDOW_SCALE;
    if (!Number.isFinite(this.inputOffsetMs) || !Number.isFinite(this.windowScale) || this.windowScale <= 0)
      throw new Error('Invalid session timing configuration');
    this.notes = map.notes.map(createLiveNote);
    this.obstacles = map.obstacles.map(createLiveObstacle);
    this.spawner = new Spawner(map);
    this.scoring = new ScoreState(map);
    this.stats = this.scoring.snapshot();
    this.progress.durationMs = map.song.durationMs;
    this.kinetic = new KineticMeter(options.physicalScale ?? 0);
    this.onEvent = options.onEvent ?? (() => undefined);
    this.candidatePool = this.notes.map((live) => ({
      live,
      cursor: null as unknown as HandCursor,
      outcome: 'ignore',
      songTime: 0,
      alpha: 0,
      perfTime: 0,
    }));
  }
  get combo(): number {
    return this.scoring.combo;
  }
  get score(): number {
    return this.scoring.score;
  }
  get multiplier(): number {
    return this.scoring.multiplier;
  }
  get liveAccuracy(): number | null {
    return this.scoring.liveAccuracy;
  }
  /** Settle the frozen scene at the actual suspended audio position without judging paused input. */
  freezeAt(songTimeMs: number): void {
    if (!Number.isFinite(songTimeMs) || this.finished) return;
    this.latestTime = songTimeMs;
    for (const live of this.notes)
      if (live.spawned && live.state === 'live') updateLiveNote(live, songTimeMs, this.map.approachMs);
    for (const live of this.obstacles)
      if (live.spawned && live.state === 'live') updateLiveObstacle(live, songTimeMs, this.map.approachMs);
  }
  private readonly onSpawnNote = (_note: BeatmapV1['notes'][number], index: number): void => {
    const live = this.notes[index]!;
    live.spawned = true;
    this.onEvent('note:spawn', { note: live.note });
  };
  private readonly onSpawnObstacle = (_obstacle: BeatmapV1['obstacles'][number], index: number): void => {
    const live = this.obstacles[index]!;
    live.spawned = true;
    this.onEvent('obstacle:spawn', { obstacle: live.obstacle });
  };
  private readonly onMusic = (event: BeatmapV1['events'][number]): void => {
    this.onEvent('music:event', event);
  };
  private spawn(songTimeMs: number): void {
    this.spawner.advance(songTimeMs, this.onSpawnNote, this.onSpawnObstacle, this.onMusic);
  }
  tick(songTimeMs = this.options.songClock.now()): void {
    if (this.finished || this.paused || !Number.isFinite(songTimeMs)) return;
    this.latestTime = songTimeMs;
    this.spawn(songTimeMs);
    let unresolved = 0;
    for (const live of this.notes) {
      if (!live.spawned || live.state !== 'live') continue;
      unresolved++;
      updateLiveNote(live, songTimeMs, this.map.approachMs);
    }
    if (unresolved > MAX_LIVE_NOTES) {
      this.needsTrackingPause = 'This chart exceeds the active note capacity. Choose another map.';
      return;
    }
    for (const live of this.obstacles)
      if (live.spawned && live.state === 'live') {
        updateLiveObstacle(live, songTimeMs, this.map.approachMs);
        if (
          songTimeMs >= live.obstacle.t + OBSTACLE_GRACE_MS &&
          songTimeMs <= live.obstacle.t + live.obstacle.durationMs &&
          songTimeMs - this.bodyLastSong > INPUT_MAX_AGE_MS
        )
          this.needsTrackingPause = 'Body tracking is needed to judge this wall. Step back into frame.';
      }
    this.expire(songTimeMs);
    this.progress.songTimeMs = songTimeMs;
    this.onEvent('song:progress', this.progress);
    if (
      songTimeMs >= this.map.song.durationMs + SONG_TAIL_MS &&
      this.notes.every((note) => note.state !== 'live') &&
      this.obstacles.every((obstacle) => obstacle.state !== 'live')
    ) {
      this.finished = true;
      this.syncStats();
      Object.freeze(this.stats.counts);
      Object.freeze(this.stats);
      this.onEvent('session:end', this.stats);
    }
  }
  consume(input: SessionInput, arrivalPerf = performance.now()): boolean {
    if (this.finished || this.paused) return false;
    if ((input.epoch ?? this.epoch) !== this.epoch) {
      this.diagnostics.wrongEpoch++;
      return false;
    }
    if (
      !Number.isInteger(input.seq) ||
      input.seq <= this.lastSequence ||
      input.tCapture <= this.lastCapture
    ) {
      this.diagnostics.duplicate++;
      return false;
    }
    if (
      !Number.isFinite(arrivalPerf) ||
      !Number.isFinite(input.tCapture) ||
      input.tCapture > arrivalPerf ||
      input.tCapture < this.acceptAfterPerf ||
      input.hands.length > 2
    ) {
      this.diagnostics.invalid++;
      return false;
    }
    if (arrivalPerf - input.tCapture > INPUT_MAX_AGE_MS) {
      this.diagnostics.stale++;
      return false;
    }
    const songTime = this.options.songClock.fromPerformanceTime(input.tCapture);
    if (!Number.isFinite(songTime)) {
      this.diagnostics.invalid++;
      return false;
    }
    let left = false,
      right = false;
    for (const cursor of input.hands) {
      if ((cursor.hand !== 'left' && cursor.hand !== 'right') || (cursor.hand === 'left' ? left : right)) {
        this.diagnostics.invalid++;
        return false;
      }
      if (
        cursor.present &&
        (cursor.tCapture !== input.tCapture ||
          !finite3(cursor.pos) ||
          !finite3(cursor.vel) ||
          !finite3(cursor.tip) ||
          !Number.isFinite(cursor.speed) ||
          cursor.speed < 0 ||
          !Number.isFinite(cursor.charge) ||
          cursor.charge < 0 ||
          cursor.charge > 1 ||
          !Number.isFinite(cursor.bladeLength) ||
          cursor.bladeLength < 0 ||
          !Number.isFinite(cursor.gestureConfidence))
      ) {
        this.diagnostics.invalid++;
        return false;
      }
      if (cursor.hand === 'left') left = true;
      else right = true;
    }
    this.lastSequence = input.seq;
    this.lastCapture = input.tCapture;
    this.diagnostics.accepted++;
    if (songTime < 0) {
      this.resetHistories();
      return true;
    }
    this.spawn(songTime);
    this.candidates.length = 0;
    for (let index = 0; index < this.notes.length; index++) {
      const live = this.notes[index]!;
      if (live.state !== 'live' || !live.spawned || live.note.type === 'beam') continue;
      const candidate = this.candidatePool[index]!;
      candidate.outcome = 'ignore';
      for (const cursor of input.hands) {
        if (!cursor.present || cursor.gestureConfidence < GESTURE_CONFIDENCE_MIN) continue;
        const outcome = contactOutcome(live.note.type, cursor.gesture, cursor.speed);
        if (outcome === 'ignore') continue;
        const memory = this.hands[cursor.hand];
        const sweepValid =
          memory.present &&
          memory.gesture === cursor.gesture &&
          cursor.tCapture - memory.tCapture <= INPUT_MAX_AGE_MS;
        const previousSong = sweepValid ? memory.songTime : songTime;
        const delta = songTime - previousSong;
        const begin = live.note.t - WINDOW_GOOD_MS * this.windowScale - this.inputOffsetMs;
        const end = live.note.t + WINDOW_GOOD_MS * this.windowScale - this.inputOffsetMs;
        if (songTime < begin || previousSong > end) continue;
        const alphaMin = delta > 0 ? clamp((begin - previousSong) / delta, 0, 1) : 0;
        const alphaMax = delta > 0 ? clamp((end - previousSong) / delta, 0, 1) : 1;
        const previousPos = sweepValid ? memory.pos : cursor.pos;
        this.interpolate(previousPos, cursor.pos, alphaMin, this.scratch.a);
        this.interpolate(previousPos, cursor.pos, alphaMax, this.scratch.b);
        let fraction = sweptPalmContact(this.scratch.a, this.scratch.b, live.target);
        if (cursor.bladeActive) {
          const oldLength = sweepValid ? (memory.bladeActive ? memory.bladeLength : 0) : cursor.bladeLength;
          const oldVel = sweepValid && memory.bladeActive ? memory.vel : cursor.vel;
          const oldSpeed = Math.hypot(oldVel.x, oldVel.y);
          const currentSpeed = Math.hypot(cursor.vel.x, cursor.vel.y);
          this.scratch.tip0.x = previousPos.x + (oldSpeed > 0 ? (oldVel.x / oldSpeed) * oldLength : 0);
          this.scratch.tip0.y = previousPos.y + (oldSpeed > 0 ? (oldVel.y / oldSpeed) * oldLength : 0);
          this.scratch.tip1.x =
            cursor.pos.x + (currentSpeed > 0 ? (cursor.vel.x / currentSpeed) * cursor.bladeLength : 0);
          this.scratch.tip1.y =
            cursor.pos.y + (currentSpeed > 0 ? (cursor.vel.y / currentSpeed) * cursor.bladeLength : 0);
          // Clip both blade endpoints to the eligible part of this measured sweep.
          const oldTipX = this.scratch.tip0.x,
            oldTipY = this.scratch.tip0.y;
          this.scratch.tip0.x = lerp(oldTipX, this.scratch.tip1.x, alphaMin);
          this.scratch.tip0.y = lerp(oldTipY, this.scratch.tip1.y, alphaMin);
          this.scratch.tip1.x = lerp(oldTipX, this.scratch.tip1.x, alphaMax);
          this.scratch.tip1.y = lerp(oldTipY, this.scratch.tip1.y, alphaMax);
          const blade = sweptBladeContact(
            this.scratch.a,
            this.scratch.tip0,
            this.scratch.b,
            this.scratch.tip1,
            live.target,
          );
          if (blade !== null) fraction = fraction === null ? blade : Math.min(fraction, blade);
        }
        if (fraction === null) continue;
        const alpha = lerp(alphaMin, alphaMax, fraction);
        const contactSong = lerp(previousSong, songTime, alpha);
        if (!judgeTiming(timingError(contactSong, live.note.t, this.inputOffsetMs), this.windowScale))
          continue;
        const contactPerf = sweepValid ? lerp(memory.tCapture, cursor.tCapture, alpha) : cursor.tCapture;
        if (
          candidate.outcome === 'ignore' ||
          (outcome === 'hit' && candidate.outcome !== 'hit') ||
          (outcome === candidate.outcome &&
            (contactPerf < candidate.perfTime ||
              (contactPerf === candidate.perfTime && cursor.hand === 'left')))
        ) {
          candidate.cursor = cursor;
          candidate.outcome = outcome;
          candidate.songTime = contactSong;
          candidate.alpha = alpha;
          candidate.perfTime = contactPerf;
        }
      }
      if (candidate.outcome !== 'ignore') this.candidates.push(candidate);
    }
    this.candidates.sort(compareCandidates);
    for (const candidate of this.candidates) this.resolveContact(candidate);
    this.resolveBeams(input.hands, songTime);
    this.resolveObstacles(input.body, songTime);
    this.kinetic.update(input.hands, input.body);
    this.stats.kineticJoules = this.kinetic.joules;
    this.stats.kcal = this.kinetic.kcal;
    for (const cursor of input.hands) this.remember(cursor, songTime);
    if (!left) this.hands.left.present = false;
    if (!right) this.hands.right.present = false;
    this.captureWatermark = Math.max(this.captureWatermark, songTime);
    this.expire(this.options.songClock.fromPerformanceTime(arrivalPerf));
    return true;
  }
  private interpolate(a: Vec3, b: Vec3, alpha: number, out: Vec3): void {
    out.x = lerp(a.x, b.x, alpha);
    out.y = lerp(a.y, b.y, alpha);
    out.z = lerp(a.z, b.z, alpha);
  }
  private resolveContact(candidate: Candidate): void {
    const { live, cursor } = candidate;
    if (live.state !== 'live') return;
    if (candidate.outcome === 'badcut') {
      live.state = 'badcut';
      this.scoring.badcut();
      this.syncStats();
      this.onEvent('note:badcut', { note: live.note, hand: cursor.hand, gesture: cursor.gesture });
      this.comboEvent(true);
    } else {
      const memory = this.hands[cursor.hand];
      const impactPoint = { ...cursor.pos };
      if (
        memory.present &&
        memory.gesture === cursor.gesture &&
        cursor.tCapture - memory.tCapture <= INPUT_MAX_AGE_MS
      )
        this.interpolate(memory.pos, cursor.pos, candidate.alpha, impactPoint);
      this.hit(live, cursor, candidate.songTime, impactPoint);
    }
  }
  private hit(live: LiveNote, cursor: HandCursor, songTime: number, measuredImpact = cursor.pos): void {
    const error = timingError(songTime, live.note.t, this.inputOffsetMs);
    const judgement = judgeTiming(error, this.windowScale);
    if (!judgement || live.state !== 'live') return;
    const oldMax = this.scoring.maxCombo;
    const scoreDelta = this.scoring.hit(judgement);
    live.state = 'hit';
    updateLiveNote(live, songTime, this.map.approachMs);
    const impactPos = {
      x: clamp(measuredImpact.x, live.target.x - live.halfExtents.x, live.target.x + live.halfExtents.x),
      y: clamp(measuredImpact.y, live.target.y - live.halfExtents.y, live.target.y + live.halfExtents.y),
      z: live.pos.z,
    };
    const payload: GameEvents['note:hit'] = {
      note: live.note,
      judgement,
      timingErrorMs: error,
      hand: cursor.hand,
      impactPos,
      impactVel: { ...cursor.vel },
      scoreDelta,
      combo: this.combo,
      multiplier: this.multiplier,
    };
    if (live.note.type === 'slash') payload.cutPlane = makeCutPlane(cursor.vel, impactPos);
    this.onEvent('note:hit', payload);
    this.comboEvent(false);
    if (this.scoring.maxCombo > oldMax && this.combo >= HIGHLIGHT_MIN_COMBO) {
      this.peakComboSongTime = songTime;
      if (songTime - this.lastHighlight >= HIGHLIGHT_DEBOUNCE_MS) {
        this.lastHighlight = songTime;
        this.onEvent('highlight:capture', { songTimeMs: songTime });
      }
    }
    this.syncStats();
  }
  private resolveBeams(hands: readonly HandCursor[], songTime: number): void {
    // Stable hand order resolves exact ties without depending on worker hand-array order.
    for (const hand of HAND_ORDER) {
      let cursor: HandCursor | undefined;
      for (const candidate of hands)
        if (candidate.hand === hand) {
          cursor = candidate;
          break;
        }
      if (
        !cursor?.present ||
        cursor.gesture !== 'point' ||
        cursor.gestureConfidence < GESTURE_CONFIDENCE_MIN ||
        cursor.charge < 1 ||
        songTime < this.beamLocks[hand] ||
        cursor.tCapture < this.beamReady[hand]
      )
        continue;
      let best: LiveNote | null = null,
        bestError = Infinity;
      for (const live of this.notes) {
        if (
          !live.spawned ||
          live.state !== 'live' ||
          live.note.type !== 'beam' ||
          songTime < live.note.t - BEAM_LEAD_MS
        )
          continue;
        const error = Math.abs(timingError(songTime, live.note.t, this.inputOffsetMs));
        if (!judgeTiming(error, this.windowScale)) continue;
        beamAimTarget(live.note, this.scratch.aim);
        if (!beamAimed(cursor.tip, this.scratch.aim)) continue;
        if (
          error < bestError ||
          (error === bestError &&
            best !== null &&
            (live.note.t < best.note.t || (live.note.t === best.note.t && live.note.id < best.note.id)))
        ) {
          best = live;
          bestError = error;
        }
      }
      if (!best) continue;
      updateLiveNote(best, songTime, this.map.approachMs);
      this.beamLocks[hand] = songTime + BEAM_REFIRE_LOCK_MS;
      this.beamReady[hand] = cursor.tCapture + BEAM_CHARGE_MS;
      this.onEvent('beam:fire', { hand, from: { ...cursor.tip }, to: { ...best.pos }, note: best.note });
      this.hit(best, cursor, songTime);
    }
  }
  private resolveObstacles(body: BodyState | null, songTime: number): void {
    const valid =
      body?.present &&
      Number.isFinite(body.tCapture) &&
      Number.isFinite(body.centerX) &&
      Number.isFinite(body.leanX) &&
      Number.isFinite(body.torsoSpeed);
    const previousBodySong = this.bodyLastSong;
    if (valid) this.bodyLastSong = songTime;
    for (const live of this.obstacles) {
      if (!live.spawned || live.state !== 'live') continue;
      const start = live.obstacle.t + OBSTACLE_GRACE_MS,
        end = live.obstacle.t + live.obstacle.durationMs;
      if (
        songTime >= start &&
        previousBodySong < end &&
        Math.min(songTime, end) - Math.max(start, previousBodySong) > INPUT_MAX_AGE_MS
      )
        this.needsTrackingPause =
          'Body observations were interrupted during the wall. Restore tracking to continue.';
      if (songTime < start || songTime > end) continue;
      if (!valid || body.tCapture !== this.lastCapture) {
        this.needsTrackingPause = 'Body tracking is needed to judge this wall. Step back into frame.';
        continue;
      }
      live.entered = true;
      live.bodySamples++;
      if (!obstacleSafe(live.obstacle, body)) {
        live.state = 'hit';
        this.scoring.obstacleHit();
        this.syncStats();
        this.onEvent('obstacle:hit', { obstacle: live.obstacle });
        this.comboEvent(true);
      }
    }
  }
  private expire(songTime: number): void {
    if (!Number.isFinite(songTime)) return;
    for (const live of this.notes) {
      if (!live.spawned || live.state !== 'live') continue;
      const latest = live.note.t + WINDOW_GOOD_MS * this.windowScale - this.inputOffsetMs;
      if (this.captureWatermark > latest || songTime > latest + INPUT_MAX_AGE_MS) {
        live.state = live.note.type === 'beam' ? 'escaped' : 'missed';
        this.scoring.miss();
        this.syncStats();
        this.onEvent('note:miss', { note: live.note });
        this.comboEvent(true);
      }
    }
    for (const live of this.obstacles) {
      if (!live.spawned || live.state !== 'live') continue;
      const end = live.obstacle.t + live.obstacle.durationMs;
      if (this.captureWatermark > end || songTime > end + INPUT_MAX_AGE_MS) {
        if (live.bodySamples === 0 || end - this.bodyLastSong > INPUT_MAX_AGE_MS || this.needsTrackingPause) {
          this.needsTrackingPause = 'The wall needs a valid body observation. Restore tracking to continue.';
          continue;
        }
        live.state = 'dodged';
        const scoreDelta = this.scoring.dodge();
        this.syncStats();
        this.onEvent('obstacle:dodged', { obstacle: live.obstacle, scoreDelta });
      }
    }
  }
  private remember(cursor: HandCursor, songTime: number): void {
    const memory = this.hands[cursor.hand];
    memory.present = cursor.present;
    if (!cursor.present) return;
    memory.tCapture = cursor.tCapture;
    memory.songTime = songTime;
    memory.gesture = cursor.gesture;
    Object.assign(memory.pos, cursor.pos);
    Object.assign(memory.vel, cursor.vel);
    memory.bladeActive = cursor.bladeActive;
    memory.bladeLength = cursor.bladeLength;
  }
  private syncStats(): void {
    this.stats.score = this.scoring.score;
    this.stats.accuracy = this.scoring.finalAccuracy;
    this.stats.rank = rankFor(this.stats.accuracy);
    this.stats.maxCombo = this.scoring.maxCombo;
    Object.assign(this.stats.counts, this.scoring.counts);
    this.stats.peakComboSongTimeMs = this.peakComboSongTime;
    this.stats.kineticJoules = this.kinetic.joules;
    this.stats.kcal = this.kinetic.kcal;
  }
  private comboEvent(broke: boolean): void {
    this.onEvent('combo:change', { combo: this.combo, multiplier: this.multiplier, broke });
  }
  private resetHistories(): void {
    this.hands.left.present = this.hands.right.present = false;
    this.beamLocks.left = this.beamLocks.right = -Infinity;
    this.beamReady.left = this.beamReady.right = -Infinity;
    this.captureWatermark = -Infinity;
    this.bodyLastSong = -Infinity;
    this.kinetic.resetHistory();
  }
  pause(): void {
    this.paused = true;
    this.resetHistories();
  }
  resume(afterPerf = performance.now()): void {
    this.paused = false;
    this.needsTrackingPause = null;
    this.acceptAfterPerf = afterPerf;
    this.resetHistories();
  }
  get handChargeLockedUntil(): Readonly<Record<Hand, number>> {
    return this.beamReady;
  }
}
