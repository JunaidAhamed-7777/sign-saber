/** Pure HUD presentation helpers derived from authoritative session aggregates. */
import { HUD_COMBO_MILESTONES, MULTIPLIER_LADDER } from '../core/constants';
export interface MultiplierProgress {
  multiplier: number;
  /** 0..1 progress from the current ladder rung to the next; 1 at the top rung. */
  progress: number;
  /** Combo count needed for the next multiplier, or null at the top rung. */
  nextAt: number | null;
}
export function multiplierProgress(combo: number): MultiplierProgress {
  const value = Number.isFinite(combo) ? Math.max(0, Math.floor(combo)) : 0;
  let rung = 0;
  for (let i = 0; i < MULTIPLIER_LADDER.length; i++) if (value >= MULTIPLIER_LADDER[i]![0]) rung = i;
  const [from, multiplier] = MULTIPLIER_LADDER[rung]!;
  const next = MULTIPLIER_LADDER[rung + 1];
  if (!next) return { multiplier, progress: 1, nextAt: null };
  return { multiplier, progress: Math.min(1, (value - from) / (next[0] - from)), nextAt: next[0] };
}
/** Highest milestone reached by the current unbroken combo, or null below the first. */
export function comboMilestone(combo: number): (typeof HUD_COMBO_MILESTONES)[number] | null {
  let reached: (typeof HUD_COMBO_MILESTONES)[number] | null = null;
  for (const milestone of HUD_COMBO_MILESTONES) if (combo >= milestone) reached = milestone;
  return reached;
}
