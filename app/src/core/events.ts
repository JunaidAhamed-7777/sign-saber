import type { MusicEvent, Note, Obstacle } from '../beatmap/types';
import type { GameState } from './stateMachine';
import type { Gesture, Hand, Plane, SessionStats, Vec3 } from './types';
export { TypedEmitter } from '../utils/emitter';
export interface GameEvents {
  'state:change': { prev: GameState; next: GameState };
  'note:spawn': { note: Note };
  'note:hit': {
    note: Note;
    judgement: 'perfect' | 'great' | 'good';
    timingErrorMs: number;
    hand: Hand;
    cutPlane?: Plane;
    impactPos: Vec3;
    impactVel: Vec3;
    scoreDelta: number;
    combo: number;
    multiplier: number;
  };
  'note:miss': { note: Note };
  'note:badcut': { note: Note; hand: Hand; gesture: Gesture };
  'beam:fire': { hand: Hand; from: Vec3; to: Vec3; note: Note | null };
  'obstacle:spawn': { obstacle: Obstacle };
  'obstacle:hit': { obstacle: Obstacle };
  'obstacle:dodged': { obstacle: Obstacle; scoreDelta: number };
  'combo:change': { combo: number; multiplier: number; broke: boolean };
  'music:event': MusicEvent;
  'song:progress': { songTimeMs: number; durationMs: number };
  'highlight:capture': { songTimeMs: number };
  'session:end': SessionStats;
}
