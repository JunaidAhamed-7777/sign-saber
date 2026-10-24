/** Presentation-only terminal targets. The game retains every authoritative judgement. */
import type { LiveNote } from '../game/liveObjects';
import type { Note } from '../beatmap/types';
import type { Vec3 } from '../core/types';
import { LANE_DIRECTION, notePosition } from '../game/liveObjects';
import {
  BADCUT_MS,
  BADCUT_PUSHBACK_M,
  BEAM_ESCAPE_RISE_M,
  BEAM_ESCAPE_VISUAL_MS,
  DESPAWN_Z,
  MAX_LIVE_NOTES,
  MISS_DIM_MS,
  TERMINAL_DIM_FACTOR,
} from '../core/constants';

export interface TerminalTarget {
  readonly position: Vec3;
  rotation: number;
  brightness: number;
  redMix: number;
}

/** Buffers grow only when a different chart is supplied, normally during negative-time pre-roll.
 * A single reusable output is consumed immediately by the renderer. No note or live state is written. */
export class TerminalNoteVisuals {
  private source: readonly LiveNote[] | null = null;
  private kinds = new Uint8Array(MAX_LIVE_NOTES);
  private births = new Float64Array(MAX_LIVE_NOTES);
  private rotations = new Float64Array(MAX_LIVE_NOTES);
  private readonly view: TerminalTarget = {
    position: { x: 0, y: 0, z: 0 },
    rotation: 0,
    brightness: 1,
    redMix: 0,
  };

  prepare(notes: readonly LiveNote[]): void {
    if (notes === this.source) return;
    if (notes.length > this.kinds.length) {
      this.kinds = new Uint8Array(notes.length);
      this.births = new Float64Array(notes.length);
      this.rotations = new Float64Array(notes.length);
    } else this.kinds.fill(0);
    this.source = notes;
  }

  /** Events can arrive between draws. The first event wins, even after its visual has despawned. */
  resolve(note: Note, kind: 'miss' | 'badcut', time: number): boolean {
    if (!this.source || !Number.isFinite(time)) return false;
    for (let index = 0; index < this.source.length; index++) {
      const live = this.source[index]!;
      if (live.note !== note) continue;
      if (this.kinds[index]) return false;
      if (kind === 'badcut' ? live.state !== 'badcut' : live.state !== 'missed' && live.state !== 'escaped')
        return false;
      this.latch(index, kind === 'badcut' ? 2 : 1, time, live.rotation);
      return true;
    }
    return false;
  }

  sample(index: number, time: number, approachMs: number, calm: boolean): TerminalTarget | null {
    const live = this.source?.[index];
    if (
      !live?.spawned ||
      !Number.isFinite(time) ||
      !Number.isFinite(approachMs) ||
      approachMs <= 0 ||
      (live.state !== 'missed' && live.state !== 'badcut' && live.state !== 'escaped')
    )
      return null;
    if (!this.kinds[index]) this.latch(index, live.state === 'badcut' ? 2 : 1, time, live.rotation);
    const age = Math.max(0, time - this.births[index]!),
      badcut = this.kinds[index] === 2,
      dimAge = badcut ? Math.max(0, age - BADCUT_MS) : age,
      view = this.view;
    notePosition(live.note, time, approachMs, view.position);
    view.rotation = this.rotations[index]!;
    view.brightness = 1 - (1 - TERMINAL_DIM_FACTOR) * Math.min(1, dimAge / MISS_DIM_MS);
    view.redMix = badcut ? Math.max(0, 1 - age / BADCUT_MS) : 0;
    if (live.note.type === 'beam') {
      if (age >= BEAM_ESCAPE_VISUAL_MS) return null;
      const progress = age / BEAM_ESCAPE_VISUAL_MS;
      if (!calm) view.position.y += BEAM_ESCAPE_RISE_M * progress;
      view.brightness *= 1 - progress;
      return view;
    }
    // Late capture-time judgements may arrive after this visual threshold. Never pull them back
    // into the lane merely to make a miss animation visible, or change the scoring coordinates.
    if (view.position.z >= DESPAWN_Z) return null;
    if (badcut && !calm && age < BADCUT_MS) {
      const spring = Math.sin((Math.PI * age) / BADCUT_MS),
        pushback = BADCUT_PUSHBACK_M * spring * spring;
      view.position.x -= LANE_DIRECTION.x * pushback;
      view.position.y -= LANE_DIRECTION.y * pushback;
      view.position.z -= LANE_DIRECTION.z * pushback;
    }
    return view;
  }

  reset(): void {
    this.kinds.fill(0);
    this.source = null;
  }

  private latch(index: number, kind: number, time: number, rotation: number): void {
    this.kinds[index] = kind;
    this.births[index] = time;
    this.rotations[index] = rotation;
  }
}
