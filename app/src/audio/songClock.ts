/**
 * Sign Saber — audio/songClock.ts
 *
 * Responsibility: Master clock from AudioContext.currentTime; scheduled start, suspend/resume bookkeeping.
 * Spec: docs/15-audio-playback-sync.md §SongClock
 * Inputs: AudioContext
 * Outputs: songTime()
 *
 * Implemented for the first playable spine. Replay/unit evidence is separate from live-camera acceptance.
 */
import { SONG_START_LEAD_S } from '../core/constants';

export interface ClockContext {
  readonly currentTime: number;
  readonly baseLatency?: number;
  readonly outputLatency?: number;
  readonly state: string;
  getOutputTimestamp?: () => { contextTime?: number; performanceTime?: number };
  suspend(): Promise<void>;
  resume(): Promise<void>;
}
interface Segment {
  begin: number;
  end: number;
  anchorPerf: number;
  anchorSong: number;
}

export class SongClock {
  private startTime = NaN;
  private pausedSong = NaN;
  private segments: Segment[] = [];
  private status: 'idle' | 'running' | 'paused' | 'ended' = 'idle';
  private lifecycle = 0;
  timingSource: 'output-timestamp' | 'latency-estimate' = 'latency-estimate';
  constructor(
    private readonly ctx: ClockContext,
    private readonly perfNow: () => number = () => performance.now(),
  ) {}
  get state(): 'idle' | 'running' | 'paused' | 'ended' {
    return this.status;
  }
  get scheduledContextTime(): number {
    return this.startTime;
  }
  scheduleStart(leadS = SONG_START_LEAD_S): number {
    if (!Number.isFinite(leadS) || leadS < 0)
      throw new RangeError('Start lead must be finite and nonnegative');
    if (this.ctx.state !== 'running') throw new Error('Enable sound before scheduling playback');
    this.lifecycle++;
    this.startTime = this.ctx.currentTime + leadS;
    const now = this.perfNow();
    this.segments = [{ begin: now, end: Infinity, anchorPerf: now, anchorSong: -leadS * 1000 }];
    this.status = 'running';
    this.refresh();
    return this.startTime;
  }
  private refresh(): void {
    if (this.status !== 'running' && this.status !== 'ended') return;
    const segment = this.segments[this.segments.length - 1];
    if (!segment) return;
    const now = this.perfNow();
    const timestamp = this.ctx.getOutputTimestamp?.();
    if (
      timestamp &&
      Number.isFinite(timestamp.contextTime) &&
      Number.isFinite(timestamp.performanceTime) &&
      timestamp.contextTime! > 0 &&
      timestamp.performanceTime! >= segment.begin &&
      timestamp.performanceTime! <= now &&
      timestamp.contextTime! <= this.ctx.currentTime
    ) {
      segment.anchorPerf = timestamp.performanceTime!;
      segment.anchorSong = (timestamp.contextTime! - this.startTime) * 1000;
      this.timingSource = 'output-timestamp';
      return;
    }
    const base = Number.isFinite(this.ctx.baseLatency) ? this.ctx.baseLatency! : 0;
    const output = Number.isFinite(this.ctx.outputLatency) ? this.ctx.outputLatency! : 0;
    segment.anchorPerf = now;
    segment.anchorSong = (this.ctx.currentTime - this.startTime - Math.max(0, base + output)) * 1000;
    if (this.segments.length > 1) segment.anchorSong = Math.max(this.pausedSong, segment.anchorSong);
    this.timingSource = 'latency-estimate';
  }
  fromPerformanceTime(tPerf: number): number {
    if (!Number.isFinite(tPerf) || this.status === 'idle') return NaN;
    this.refresh();
    for (let index = this.segments.length - 1; index >= 0; index--) {
      const segment = this.segments[index]!;
      if (tPerf >= segment.begin && tPerf <= segment.end)
        return segment.anchorSong + tPerf - segment.anchorPerf;
    }
    return NaN;
  }
  now(): number {
    return this.status === 'paused' ? this.pausedSong : this.fromPerformanceTime(this.perfNow());
  }
  async pause(): Promise<void> {
    if (this.status !== 'running' && this.status !== 'ended') return;
    const epoch = this.lifecycle;
    this.refresh();
    const segment = this.segments[this.segments.length - 1];
    if (segment) segment.end = this.perfNow();
    this.status = 'paused';
    this.pausedSong = segment ? segment.anchorSong + segment.end - segment.anchorPerf : NaN;
    await this.ctx.suspend();
    if (epoch !== this.lifecycle) return;
    this.pausedSong = (this.ctx.currentTime - this.startTime) * 1000;
  }
  async resume(): Promise<void> {
    if (this.status !== 'paused') return;
    const epoch = this.lifecycle;
    await this.ctx.resume();
    if (epoch !== this.lifecycle) return;
    if (this.ctx.state !== 'running') throw new Error('Audio output is unavailable. Enable sound to resume.');
    const now = this.perfNow();
    this.segments.push({ begin: now, end: Infinity, anchorPerf: now, anchorSong: this.pausedSong });
    this.status = 'running';
    this.refresh();
  }
  end(): void {
    if (this.status === 'running') this.status = 'ended';
  }
  reset(): void {
    this.lifecycle++;
    this.status = 'idle';
    this.startTime = NaN;
    this.pausedSong = NaN;
    this.segments = [];
  }
}
