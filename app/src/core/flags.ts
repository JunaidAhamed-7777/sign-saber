import type { Difficulty } from '../beatmap/types';
export interface RuntimeFlags {
  readonly replay: string | null;
  readonly speed: number;
  readonly stats: boolean;
  readonly tier: 'low' | 'medium' | 'high';
  readonly contrast: boolean;
  readonly difficulty: Difficulty;
}
export function readFlags(search: string, development: boolean): Readonly<RuntimeFlags> {
  const p = new URLSearchParams(search);
  const replay = development && p.get('replay') === 'synthetic-open' ? 'synthetic-open' : null;
  const tier = p.get('tier');
  const difficulty = p.get('difficulty');
  const speed = Number(p.get('speed') ?? 1);
  return Object.freeze({
    replay,
    speed: replay && [0.25, 0.5, 1].includes(speed) ? speed : 1,
    stats: p.get('stats') === '1',
    tier: tier === 'low' || tier === 'high' ? tier : 'medium',
    contrast: p.get('contrast') === '1',
    difficulty: difficulty === 'easy' || difficulty === 'hard' ? difficulty : 'normal',
  });
}
