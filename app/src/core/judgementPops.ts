/**
 * Bounded queue of recent terminal judgements for the HUD (docs14 §Judgement pops).
 * Fixed MAX_POPS slots are reused; the display copy is produced only when the queue changes.
 */
import { MAX_POPS, POP_LIFETIME_MS } from './constants';
import type { Vec3 } from './types';
export type PopJudgement = 'perfect' | 'great' | 'good' | 'miss' | 'badcut';
export interface JudgementPop {
  /** Monotonic id; the UI keys animation restarts on it. Slot = id % MAX_POPS. */
  id: number;
  judgement: PopJudgement;
  /** World-space position (impact point for hits, hit-plane note position otherwise). */
  x: number;
  y: number;
  z: number;
  /** Signed timing error for Great/Good, otherwise null. */
  timingMs: number | null;
  bornAt: number;
}
export class JudgementPopQueue {
  private readonly slots: JudgementPop[] = [];
  private next = 0;
  push(judgement: PopJudgement, pos: Vec3, now: number, timingMs: number | null = null): void {
    const id = this.next++;
    const index = id % MAX_POPS;
    const slot =
      this.slots[index] ?? (this.slots[index] = { id, judgement, x: 0, y: 0, z: 0, timingMs, bornAt: now });
    slot.id = id;
    slot.judgement = judgement;
    slot.x = pos.x;
    slot.y = pos.y;
    slot.z = pos.z;
    slot.timingMs = judgement === 'great' || judgement === 'good' ? timingMs : null;
    slot.bornAt = now;
  }
  /** Retires pops older than POP_LIFETIME_MS; returns true when the visible set changed. */
  prune(now: number): boolean {
    let changed = false;
    for (const slot of this.slots)
      if (slot.bornAt !== -Infinity && now - slot.bornAt >= POP_LIFETIME_MS) {
        slot.bornAt = -Infinity;
        changed = true;
      }
    return changed;
  }
  /** Live pops, oldest first, as plain copies safe to keep in display state. */
  list(): JudgementPop[] {
    return this.slots
      .filter((slot) => slot.bornAt !== -Infinity)
      .sort((a, b) => a.id - b.id)
      .map((slot) => ({ ...slot }));
  }
  clear(): void {
    for (const slot of this.slots) slot.bornAt = -Infinity;
  }
}
