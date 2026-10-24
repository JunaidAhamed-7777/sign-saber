import type { Difficulty } from '../beatmap/types';
import { DATASET_CAMERA_HOLD_MAX_MS, DATASET_CAMERA_HOLD_MIN_MS, DATASET_CAMERA_HOLD_MS } from './constants';
export interface RuntimeFlags {
  readonly replay: string | null;
  readonly speed: number;
  readonly stats: boolean;
  readonly tier: 'low' | 'medium' | 'high';
  readonly contrast: boolean;
  readonly difficulty: Difficulty;
  /** `?camera=dataset` feeds the labelled dataset camera through the unchanged live camera path. */
  readonly camera: 'webcam' | 'dataset';
  /** Dataset-camera reel clock: `song` holds the calibration photo until song time 0; `sweep` cycles by stream time. */
  readonly reel: 'song' | 'sweep';
  readonly reelHoldMs: number;
  /** 0 keeps the prepared manifest order; any other value deterministically reorders non-calibration photos. */
  readonly reelSeed: number;
}
export function readFlags(search: string, development: boolean): Readonly<RuntimeFlags> {
  const p = new URLSearchParams(search);
  const replay = development && p.get('replay') === 'synthetic-open' ? 'synthetic-open' : null;
  const tier = p.get('tier');
  const difficulty = p.get('difficulty');
  const speed = Number(p.get('speed') ?? 1);
  const hold = Number(p.get('reelHold') ?? DATASET_CAMERA_HOLD_MS);
  const seed = Number(p.get('reelSeed') ?? 0);
  return Object.freeze({
    replay,
    speed: replay && [0.25, 0.5, 1].includes(speed) ? speed : 1,
    stats: p.get('stats') === '1',
    tier: tier === 'low' || tier === 'high' ? tier : 'medium',
    contrast: p.get('contrast') === '1',
    difficulty: difficulty === 'easy' || difficulty === 'hard' ? difficulty : 'normal',
    camera: p.get('camera') === 'dataset' ? 'dataset' : 'webcam',
    reel: p.get('reel') === 'sweep' ? 'sweep' : 'song',
    reelHoldMs:
      Number.isInteger(hold) && hold >= DATASET_CAMERA_HOLD_MIN_MS && hold <= DATASET_CAMERA_HOLD_MAX_MS
        ? hold
        : DATASET_CAMERA_HOLD_MS,
    reelSeed: Number.isInteger(seed) && seed >= 0 && seed <= 0x7fffffff ? seed : 0,
  });
}
