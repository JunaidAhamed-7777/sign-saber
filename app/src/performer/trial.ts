/**
 * Sign Saber — performer/trial.ts
 *
 * Responsibility: a labelled trial source that feeds the synthetic performer's planned frames into the
 * runtime on the session's song clock, through the same tracking consumer as live and dataset input.
 * Spec: docs/17-testing-and-qa.md §Synthetic performer
 * Inputs: BeatmapV1, performance clock, song-time mapping
 * Outputs: TrackingFrames at TRACK_TARGET_HZ
 *
 * Synthetic logic replay only: it shows the whole game playing, not camera or recognition behaviour.
 */
import type { BeatmapV1 } from '../beatmap/types';
import type { TrackingFrame } from '../core/types';
import { DATASET_TRIAL_MAX_CATCHUP_FRAMES, TRACK_TARGET_HZ } from '../core/constants';
import { Choreography } from './choreography';
import { PerformerFrameSynthesizer } from './synthesize';

export class PerformerTrial {
  readonly choreography: Choreography;
  private readonly synthesizer = new PerformerFrameSynthesizer();
  private readonly performance = Choreography.frame();
  private nextAt: number;
  private sequence = 0;
  private lastDelivered = -Infinity;
  private static clock(now: number): void {
    if (!Number.isFinite(now) || now < 0 || now > Number.MAX_SAFE_INTEGER / 2)
      throw new RangeError('Invalid performer clock timestamp.');
  }
  constructor(
    readonly map: BeatmapV1,
    now: number,
  ) {
    PerformerTrial.clock(now);
    this.choreography = new Choreography(map);
    this.nextAt = now;
  }
  get unplayable(): number {
    return this.choreography.plan.unplayable.length;
  }
  rebase(now: number): void {
    PerformerTrial.clock(now);
    if (now < this.lastDelivered) throw new RangeError('Performer clock cannot run backwards.');
    this.nextAt = now;
  }
  advance(
    now: number,
    songAt: (t: number) => number,
    consume: (frame: TrackingFrame, arrival: number, changed: boolean) => void,
  ): void {
    PerformerTrial.clock(now);
    if (((now - this.nextAt) * TRACK_TARGET_HZ) / 1000 >= DATASET_TRIAL_MAX_CATCHUP_FRAMES)
      throw new RangeError('Performer timeline stalled; return to Songs and restart the trial.');
    while (this.nextAt <= now) {
      const time = this.nextAt;
      const songTime = songAt(time);
      this.choreography.sample(Number.isFinite(songTime) ? songTime : 0, this.performance);
      const frame = this.synthesizer.synthesize(this.performance, this.sequence++, time);
      this.lastDelivered = time;
      consume(frame, time, false);
      this.nextAt += 1000 / TRACK_TARGET_HZ;
    }
  }
}
