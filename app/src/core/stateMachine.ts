/** Single lifecycle owner. Rejected guards leave the current state intact. docs/04. */
import { TypedEmitter } from '../utils/emitter';
import type { GameEvents } from './events';
export type GameState = 'BOOT' | 'SELECT' | 'CALIBRATION' | 'PLAYING' | 'PAUSED' | 'RESULTS';
export type PauseReason = 'manual' | 'tracking' | 'hidden' | 'audio' | 'fatal';
export type MachineEvent = 'boot:ready' | 'boot:error' | 'camera:setup' | 'camera:ready' | 'camera:error' | 'camera:cancel' | 'select:start' | 'calib:back' | 'calib:complete' | 'track:lost' | 'pause:request' | 'track:regained' | 'pause:resume' | 'tracking:stalled' | 'tracking:fatal' | 'audio:interrupted' | 'pause:quit' | 'song:ended' | 'results:retry' | 'results:songs';
const transitions: Record<GameState, Partial<Record<MachineEvent, GameState>>> = {
  BOOT: { 'boot:ready': 'SELECT', 'boot:error': 'BOOT' },
  SELECT: { 'camera:setup': 'SELECT', 'camera:ready': 'SELECT', 'camera:error': 'SELECT', 'camera:cancel': 'SELECT', 'select:start': 'CALIBRATION' },
  CALIBRATION: { 'calib:back': 'SELECT', 'calib:complete': 'PLAYING' },
  PLAYING: { 'track:lost': 'PAUSED', 'pause:request': 'PAUSED', 'tracking:stalled': 'PAUSED', 'tracking:fatal': 'PAUSED', 'audio:interrupted': 'PAUSED', 'song:ended': 'RESULTS' },
  PAUSED: { 'track:regained': 'PLAYING', 'pause:resume': 'PLAYING', 'pause:quit': 'SELECT' },
  RESULTS: { 'results:retry': 'CALIBRATION', 'results:songs': 'SELECT' },
};
export function assertTransition(state: GameState, event: MachineEvent): GameState {
  const next = transitions[state][event];
  if (!next) throw new Error(`Illegal transition: ${state} / ${event}`);
  return next;
}
export interface TransitionGuard { ready?: boolean; epoch?: number; reason?: PauseReason; }
const requiresReady = new Set<MachineEvent>(['boot:ready','camera:ready','select:start','calib:complete','track:regained','pause:resume','song:ended','results:retry']);
export class StateMachine {
  state: GameState = 'BOOT';
  epoch = 0;
  pauseReason: PauseReason | null = null;
  constructor(readonly events = new TypedEmitter<GameEvents>()) {}
  transition(event: MachineEvent, guard: TransitionGuard = {}): boolean {
    if (guard.epoch !== undefined && guard.epoch !== this.epoch) return false;
    const next = assertTransition(this.state, event);
    if (requiresReady.has(event) && guard.ready !== true) return false;
    if (event === 'track:regained' && this.pauseReason !== 'tracking') return false;
    const prev = this.state;
    if (next === 'PAUSED') this.pauseReason = guard.reason ?? (event === 'track:lost' ? 'tracking' : event === 'audio:interrupted' ? 'audio' : event.startsWith('tracking:') ? 'fatal' : 'manual');
    else this.pauseReason = null;
    this.state = next;
    this.epoch++;
    this.events.emit('state:change', { prev, next });
    return true;
  }
}
