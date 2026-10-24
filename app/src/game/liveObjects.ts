/**
 * Sign Saber — game/liveObjects.ts
 *
 * Responsibility: Pooled live note/obstacle records; position as a pure function of songTime along the lane.
 * Spec: docs/02-architecture.md §Lane geometry; docs/07
 * Inputs: songTime
 * Outputs: Positions
 *
 * Implemented for the first playable spine. Replay/unit evidence is separate from live-camera acceptance.
 */
import type { Note, Obstacle } from '../beatmap/types';
import type { Vec3 } from '../core/types';
import {
  LANE_X,
  LANE_Y,
  BLOCK_SIZE,
  LANE_PITCH_DEG,
  SPAWN_DISTANCE,
  BEAM_HOVER_Y_OFFSET,
  BEAM_HOVER_Z,
  PLAY_CENTER_Y,
} from '../core/constants';

const angle = (LANE_PITCH_DEG * Math.PI) / 180;
export const LANE_DIRECTION: Readonly<Vec3> = Object.freeze({
  x: 0,
  y: -Math.sin(angle),
  z: Math.cos(angle),
});
export interface LiveNote {
  note: Note;
  state: 'live' | 'hit' | 'missed' | 'badcut' | 'escaped';
  spawned: boolean;
  pos: Vec3;
  target: Vec3;
  halfExtents: Vec3;
  rotation: number;
}
export interface LiveObstacle {
  obstacle: Obstacle;
  state: 'live' | 'hit' | 'dodged';
  spawned: boolean;
  zFront: number;
  zBack: number;
  colsCovered: [number, number];
  entered: boolean;
  bodySamples: number;
}
export function createLiveNote(note: Note): LiveNote {
  const target = {
    x: LANE_X[note.col],
    y: LANE_Y[note.row] + (note.type === 'beam' ? BEAM_HOVER_Y_OFFSET : 0),
    z: note.type === 'beam' ? BEAM_HOVER_Z : 0,
  };
  return {
    note,
    state: 'live',
    spawned: false,
    pos: { ...target },
    target,
    halfExtents: { x: BLOCK_SIZE / 2, y: BLOCK_SIZE / 2, z: BLOCK_SIZE / 2 },
    rotation: 0,
  };
}
export function createLiveObstacle(obstacle: Obstacle): LiveObstacle {
  return {
    obstacle,
    state: 'live',
    spawned: false,
    zFront: 0,
    zBack: 0,
    colsCovered: obstacle.kind === 'wallLeft' ? [0, 1] : [2, 3],
    entered: false,
    bodySamples: 0,
  };
}
export function notePosition(note: Note, songTimeMs: number, approachMs: number, out: Vec3): Vec3 {
  const targetX = LANE_X[note.col];
  const targetY = LANE_Y[note.row];
  if (note.type === 'beam') {
    out.x = targetX;
    out.y = targetY + BEAM_HOVER_Y_OFFSET;
    out.z = BEAM_HOVER_Z;
  } else {
    const remaining = (note.t - songTimeMs) / approachMs;
    out.x = targetX;
    out.y = targetY - LANE_DIRECTION.y * SPAWN_DISTANCE * remaining;
    out.z = -LANE_DIRECTION.z * SPAWN_DISTANCE * remaining;
  }
  return out;
}
export function updateLiveNote(live: LiveNote, songTimeMs: number, approachMs: number): void {
  notePosition(live.note, songTimeMs, approachMs, live.pos);
}
export function updateLiveObstacle(live: LiveObstacle, songTimeMs: number, approachMs: number): void {
  const speedZ = (SPAWN_DISTANCE * LANE_DIRECTION.z) / approachMs;
  live.zFront = (songTimeMs - live.obstacle.t) * speedZ;
  live.zBack = (songTimeMs - live.obstacle.t - live.obstacle.durationMs) * speedZ;
}
export function obstacleCenterX(obstacle: Obstacle): number {
  return obstacle.kind === 'wallLeft' ? (LANE_X[0] + LANE_X[1]) / 2 : (LANE_X[2] + LANE_X[3]) / 2;
}
export const OBSTACLE_CENTER_Y = PLAY_CENTER_Y;
