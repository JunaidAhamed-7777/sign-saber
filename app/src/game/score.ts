/**
 * Sign Saber — game/score.ts
 *
 * Responsibility: Score, combo, MULTIPLIER_LADDER, maxScore, rank.
 * Spec: docs/07-hit-detection-and-scoring.md §Scoring
 * Inputs: Judgements
 * Outputs: Score state
 *
 * Implemented for the first playable spine. Replay/unit evidence is separate from live-camera acceptance.
 */
import type { BeatmapV1 } from '../beatmap/types';
import type { SessionStats } from '../core/types';
import {
  SCORE_PERFECT,
  SCORE_GREAT,
  SCORE_GOOD,
  SCORE_DODGE,
  MULTIPLIER_LADDER,
  RANK_THRESHOLDS,
} from '../core/constants';
import type { Judgement } from './judge';

export function multiplierFor(combo: number): number {
  let multiplier = 1;
  for (const [threshold, value] of MULTIPLIER_LADDER) if (combo >= threshold) multiplier = value;
  return multiplier;
}
export function rankFor(accuracy: number): SessionStats['rank'] {
  for (const rank of ['SS', 'S', 'A', 'B', 'C'] as const) if (accuracy >= RANK_THRESHOLDS[rank]) return rank;
  return 'D';
}
export function maximumScore(noteCount: number, obstacleCount: number): number {
  let sum = obstacleCount * SCORE_DODGE * MULTIPLIER_LADDER[MULTIPLIER_LADDER.length - 1]![1];
  for (let index = 1; index <= noteCount; index++) sum += SCORE_PERFECT * multiplierFor(index);
  return sum;
}
export class ScoreState {
  score = 0;
  combo = 0;
  multiplier = 1;
  maxCombo = 0;
  earnedBase = 0;
  resolvedBase = 0;
  readonly maxScore: number;
  readonly possibleBase: number;
  readonly counts: SessionStats['counts'] = {
    perfect: 0,
    great: 0,
    good: 0,
    miss: 0,
    badcut: 0,
    obstaclesHit: 0,
    obstaclesDodged: 0,
  };
  constructor(map: Pick<BeatmapV1, 'notes' | 'obstacles'>) {
    this.maxScore = maximumScore(map.notes.length, map.obstacles.length);
    this.possibleBase = map.notes.length * SCORE_PERFECT + map.obstacles.length * SCORE_DODGE;
  }
  hit(judgement: Judgement): number {
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.multiplier = multiplierFor(this.combo);
    const base = judgement === 'perfect' ? SCORE_PERFECT : judgement === 'great' ? SCORE_GREAT : SCORE_GOOD;
    const delta = base * this.multiplier;
    this.score += delta;
    this.earnedBase += base;
    this.resolvedBase += SCORE_PERFECT;
    this.counts[judgement]++;
    return delta;
  }
  breakCombo(): void {
    this.combo = 0;
    this.multiplier = 1;
  }
  miss(): void {
    this.counts.miss++;
    this.resolvedBase += SCORE_PERFECT;
    this.breakCombo();
  }
  badcut(): void {
    this.counts.badcut++;
    this.resolvedBase += SCORE_PERFECT;
    this.breakCombo();
  }
  obstacleHit(): void {
    this.counts.obstaclesHit++;
    this.resolvedBase += SCORE_DODGE;
    this.breakCombo();
  }
  dodge(): number {
    const delta = SCORE_DODGE * this.multiplier;
    this.counts.obstaclesDodged++;
    this.earnedBase += SCORE_DODGE;
    this.resolvedBase += SCORE_DODGE;
    this.score += delta;
    return delta;
  }
  get liveAccuracy(): number | null {
    return this.resolvedBase > 0 ? this.earnedBase / this.resolvedBase : null;
  }
  get finalAccuracy(): number {
    return this.possibleBase > 0 ? this.earnedBase / this.possibleBase : 0;
  }
  snapshot(kineticJoules = 0, kcal = 0, peakComboSongTimeMs = 0): SessionStats {
    return {
      score: this.score,
      maxScore: this.maxScore,
      accuracy: this.finalAccuracy,
      rank: rankFor(this.finalAccuracy),
      maxCombo: this.maxCombo,
      counts: { ...this.counts },
      kineticJoules,
      kcal,
      peakComboSongTimeMs,
    };
  }
}
