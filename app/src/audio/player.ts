/**
 * Sign Saber — audio/player.ts
 *
 * Responsibility: Buffer-source playback of the song, start scheduling, pause/resume, end detection.
 * Spec: docs/15-audio-playback-sync.md
 * Inputs: AudioBuffer
 * Outputs: song:ended
 *
 * Implemented for the first playable spine. Replay/unit evidence is separate from live-camera acceptance.
 */
import type { BeatmapV1 } from '../beatmap/types';
import {
  BEAM_LEAD_MS,
  COUNTDOWN_STEPS,
  SONG_START_LEAD_S,
  START_COUNTDOWN_MS,
  MASTER_GAIN_DEFAULT,
  DUCK_DB,
  DUCK_ATTACK_S,
  DUCK_RELEASE_S,
} from '../core/constants';
import { MusicAnalyser } from './analyser';
import { SongClock } from './songClock';
import { clamp } from '../utils/math';

export function computePrerollMs(map: BeatmapV1, confidentTempo = true): number {
  const step = confidentTempo ? 60000 / map.song.bpm : START_COUNTDOWN_MS / COUNTDOWN_STEPS;
  let earliest = 0;
  for (const note of map.notes)
    earliest = Math.min(earliest, note.t - (note.type === 'beam' ? BEAM_LEAD_MS : map.approachMs));
  for (const obstacle of map.obstacles) earliest = Math.min(earliest, obstacle.t - map.approachMs);
  return Math.max(START_COUNTDOWN_MS, COUNTDOWN_STEPS * step, -earliest + SONG_START_LEAD_S * 1000);
}
export const computeStartLead = computePrerollMs;

/** Owns one music source, including preview. The caller supplies an explicitly unlocked context. */
export class AudioPlayer {
  readonly clock: SongClock;
  readonly analyser: MusicAnalyser;
  readonly master: GainNode;
  readonly musicGain: GainNode;
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  private sourceEpoch = 0;
  constructor(readonly context: AudioContext) {
    this.clock = new SongClock(context);
    this.analyser = new MusicAnalyser(context);
    this.master = context.createGain();
    this.master.gain.value = MASTER_GAIN_DEFAULT;
    this.musicGain = context.createGain();
    this.analyser.node.connect(this.musicGain).connect(this.master).connect(context.destination);
  }
  prepare(buffer: AudioBuffer): void {
    this.stop();
    this.buffer = buffer;
  }
  start(leadMs: number): number {
    if (!this.buffer) throw new Error('Load the selected music before starting.');
    this.stop();
    const epoch = this.sourceEpoch;
    const at = this.clock.scheduleStart(leadMs / 1000);
    const source = this.makeSource(this.buffer);
    source.onended = () => {
      source.disconnect();
      if (epoch === this.sourceEpoch) {
        this.clock.end();
        this.source = null;
      }
    };
    try {
      source.start(at);
    } catch (error) {
      this.stop();
      throw error;
    }
    return at;
  }
  preview(buffer: AudioBuffer, startMs: number, durationMs: number, onEnded?: () => void): void {
    if (this.context.state !== 'running')
      throw new Error('Enable sound with a mouse or keyboard action first.');
    if (
      !Number.isFinite(startMs) ||
      !Number.isFinite(durationMs) ||
      startMs < 0 ||
      durationMs <= 0 ||
      startMs + durationMs > buffer.duration * 1000 + 1
    ) {
      throw new Error('The preview segment is outside the selected song.');
    }
    this.stop();
    const epoch = this.sourceEpoch;
    const source = this.makeSource(buffer);
    source.onended = () => {
      source.disconnect();
      if (epoch === this.sourceEpoch) {
        this.source = null;
        onEnded?.();
      }
    };
    try {
      source.start(this.context.currentTime, startMs / 1000, durationMs / 1000);
    } catch (error) {
      this.stop();
      throw error;
    }
  }
  private makeSource(buffer: AudioBuffer): AudioBufferSourceNode {
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser.node);
    this.source = source;
    return source;
  }
  pause(): Promise<void> {
    return this.clock.pause();
  }
  resume(): Promise<void> {
    return this.clock.resume();
  }
  stop(): void {
    this.sourceEpoch++;
    if (this.source) {
      this.source.onended = null;
      try {
        this.source.stop();
      } catch {
        /* It may already have ended. */
      }
      this.source.disconnect();
      this.source = null;
    }
    this.clock.reset();
    this.analyser.reset();
  }
  setVolume(value: number): void {
    if (Number.isFinite(value)) this.master.gain.value = clamp(value, 0, 1);
  }
  duck(): void {
    const at = this.context.currentTime;
    this.musicGain.gain.cancelScheduledValues(at);
    this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, at);
    this.musicGain.gain.linearRampToValueAtTime(10 ** (DUCK_DB / 20), at + DUCK_ATTACK_S);
    this.musicGain.gain.linearRampToValueAtTime(1, at + DUCK_ATTACK_S + DUCK_RELEASE_S);
  }
  dispose(): void {
    this.stop();
    this.buffer = null;
    this.analyser.dispose();
    this.musicGain.disconnect();
    this.master.disconnect();
  }
}
