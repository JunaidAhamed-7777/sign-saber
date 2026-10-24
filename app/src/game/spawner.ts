/**
 * Sign Saber — game/spawner.ts
 *
 * Responsibility: Makes notes/obstacles live at t − approachMs (beams at t − BEAM_LEAD_MS); emits music:event.
 * Spec: docs/07-hit-detection-and-scoring.md §Spawner
 * Inputs: BeatmapV1, songTime
 * Outputs: Live objects
 *
 * Implemented for the first playable spine. Replay/unit evidence is separate from live-camera acceptance.
 */
import type { BeatmapV1, Note, Obstacle, MusicEvent } from '../beatmap/types';
import { BEAM_LEAD_MS } from '../core/constants';

export class Spawner {
  private readonly noteOrder: number[];
  private noteIndex = 0;
  private obstacleIndex = 0;
  private eventIndex = 0;
  constructor(readonly map: BeatmapV1) {
    this.noteOrder = map.notes
      .map((_, index) => index)
      .sort((a, b) => {
        const first = map.notes[a]!,
          second = map.notes[b]!;
        return (
          first.t -
            (first.type === 'beam' ? BEAM_LEAD_MS : map.approachMs) -
            (second.t - (second.type === 'beam' ? BEAM_LEAD_MS : map.approachMs)) ||
          first.t - second.t ||
          first.id - second.id
        );
      });
  }
  advance(
    songTimeMs: number,
    onNote: (note: Note, index: number) => void,
    onObstacle: (obstacle: Obstacle, index: number) => void,
    onMusic: (event: MusicEvent) => void,
  ): void {
    while (this.noteIndex < this.map.notes.length) {
      const index = this.noteOrder[this.noteIndex]!;
      const note = this.map.notes[index]!;
      const lead = note.type === 'beam' ? BEAM_LEAD_MS : this.map.approachMs;
      if (note.t - lead > songTimeMs) break;
      this.noteIndex++;
      onNote(note, index);
    }
    while (
      this.obstacleIndex < this.map.obstacles.length &&
      this.map.obstacles[this.obstacleIndex]!.t - this.map.approachMs <= songTimeMs
    ) {
      const index = this.obstacleIndex++;
      onObstacle(this.map.obstacles[index]!, index);
    }
    while (this.eventIndex < this.map.events.length && this.map.events[this.eventIndex]!.t <= songTimeMs)
      onMusic(this.map.events[this.eventIndex++]!);
  }
  reset(): void {
    this.noteIndex = this.obstacleIndex = this.eventIndex = 0;
  }
}
