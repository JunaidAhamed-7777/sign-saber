/**
 * Sign Saber — audio/sfx.ts
 *
 * Responsibility: SFX bus: scheduled one-shot voices, stereo placement, polyphony/voice stealing,
 * safety limiting, pause-aware silencing and disposal.
 * Spec: docs/15-audio-playback-sync.md §6 SFX bus
 * Inputs: Sound ids with timing/pan/gain options (from audio/sfxDirector.ts)
 * Outputs: Sound on the shared master gain
 *
 * Graph: source → voice gain → (stereo panner) → bus input → limiter → bus output → master.
 * Sounds are original synthesized buffers (audio/sfxSynth.ts). SFX never feed back into judgement.
 */
import {
  SFX_GAIN_DEFAULT,
  SFX_LIMITER,
  SFX_LIMITER_LOOKAHEAD_S,
  SFX_MAX_VOICES,
  SFX_PITCH_JITTER_CENTS,
  SFX_POLYPHONY,
  SFX_SEED,
  SFX_STOP_RAMP_S,
  SFX_VOICE_LIMITS,
} from '../core/constants';
import { clamp, seededRandom } from '../utils/math';
import { DEFAULT_VOICING, SFX_IDS, SFX_TONAL } from './sfxSynth';
import type { SfxId, SfxVoicing } from './sfxSynth';
import { SfxBank } from './sfxBank';
import type { SfxRenderer } from './sfxBank';

export type { SfxId } from './sfxSynth';
export interface PlayOptions {
  /** AudioContext time to start; clamped to now. */
  at?: number;
  /** −1 (left) … 1 (right). */
  pan?: number;
  /** Extra gain in dB on top of the baked level. */
  gainDb?: number;
  /** Playback-rate multiplier (judgement, ladder transposition). */
  rate?: number;
  /** Apply seeded cosmetic pitch jitter (±SFX_PITCH_JITTER_CENTS). */
  jitter?: boolean;
  /** Seconds into the buffer to begin at (e.g. a partially charged beam, a late wall warning). */
  offset?: number;
}
interface Voice {
  handle: number;
  name: SfxId;
  source: AudioBufferSourceNode;
  gain: GainNode;
  panner: StereoPannerNode | null;
  startAt: number;
}

/** Spec makeup gain of a hard-knee DynamicsCompressorNode: (1 / curve(0 dBFS))^0.6, in dB. */
export function limiterMakeupDb(thresholdDb = SFX_LIMITER.thresholdDb, ratio = SFX_LIMITER.ratio): number {
  return 0.6 * -thresholdDb * (1 - 1 / ratio);
}
export const voiceLimit = (name: SfxId): number => SFX_VOICE_LIMITS[name] ?? SFX_POLYPHONY;

export class SfxBus {
  /** Voices sum here (before the limiter). */
  readonly input: GainNode;
  /** Bus level after the limiter; connected to the destination. */
  readonly output: GainNode;
  readonly bank: SfxBank;
  private readonly limiter: DynamicsCompressorNode | null;
  private readonly trim: number;
  private readonly voices: Voice[] = [];
  /** Voices fading out after stealing/release; still connected until their end callback or `stop`. */
  private readonly fading = new Set<Voice>();
  private voicing: SfxVoicing = { ...DEFAULT_VOICING };
  private random = seededRandom(SFX_SEED);
  private handles = 0;
  private disposed = false;
  /** Plays started per sound since construction (diagnostic and browser verification). */
  readonly plays: Partial<Record<SfxId, number>> = {};
  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode = ctx.destination,
    renderer?: SfxRenderer,
  ) {
    this.bank = new SfxBank(ctx, renderer);
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.limiter = typeof ctx.createDynamicsCompressor === 'function' ? ctx.createDynamicsCompressor() : null;
    if (this.limiter) {
      this.limiter.threshold.value = SFX_LIMITER.thresholdDb;
      this.limiter.knee.value = SFX_LIMITER.kneeDb;
      this.limiter.ratio.value = SFX_LIMITER.ratio;
      this.limiter.attack.value = SFX_LIMITER.attackS;
      this.limiter.release.value = SFX_LIMITER.releaseS;
      this.input.connect(this.limiter).connect(this.output);
    } else this.input.connect(this.output);
    // Cancel the compressor's automatic makeup gain so baked levels stay calibrated.
    this.trim = this.limiter ? 10 ** (-limiterMakeupDb() / 20) : 1;
    this.output.gain.value = SFX_GAIN_DEFAULT * this.trim;
    this.output.connect(destination);
  }
  /** Delay the limiter adds; future-scheduled cues subtract it so they land on their target time. */
  get latencyS(): number {
    return this.limiter ? SFX_LIMITER_LOOKAHEAD_S : 0;
  }
  get currentVoicing(): Readonly<SfxVoicing> {
    return this.voicing;
  }
  /** Change calm/tonal root. Missing renders for the new voicing are prepared in the background. */
  setVoicing(patch: Partial<SfxVoicing>): void {
    const next = { ...this.voicing, ...patch };
    const calmChanged = next.calm !== this.voicing.calm,
      rootChanged = next.rootHz !== this.voicing.rootHz;
    this.voicing = next;
    if (calmChanged) void this.bank.warm(SFX_IDS, next);
    else if (rootChanged) void this.bank.warm([...SFX_TONAL], next);
  }
  /** Prepare a set of sounds for the current voicing (priority order). */
  warm(ids: readonly SfxId[] = SFX_IDS): Promise<void> {
    return this.bank.warm(ids, this.voicing);
  }
  /** Restart the cosmetic jitter sequence (stable audiovisual comparisons across retries). */
  reseed(seed = SFX_SEED): void {
    this.random = seededRandom(seed);
  }
  /** Start a one-shot. Returns a handle for `release`, or null when silent (locked context, past end). */
  play(name: SfxId, options: PlayOptions = {}): number | null {
    if (this.disposed || this.ctx.state !== 'running') return null;
    const buffer = this.bank.resolve(name, this.voicing);
    const offset = clamp(options.offset ?? 0, 0, buffer.duration);
    if (buffer.duration - offset < SFX_STOP_RAMP_S) return null;
    const now = this.ctx.currentTime;
    const startAt = Math.max(now, Number.isFinite(options.at) ? options.at! : now);
    this.makeRoom(name);
    const source = this.ctx.createBufferSource(),
      gain = this.ctx.createGain();
    const panner = typeof this.ctx.createStereoPanner === 'function' ? this.ctx.createStereoPanner() : null;
    source.buffer = buffer;
    const jitter = options.jitter ? 2 ** (((this.random() * 2 - 1) * SFX_PITCH_JITTER_CENTS) / 1200) : 1;
    const rate = clamp((options.rate ?? 1) * jitter, 0.25, 4);
    source.playbackRate.value = rate;
    gain.gain.value = 10 ** (clamp(options.gainDb ?? 0, -60, 6) / 20);
    if (panner) {
      panner.pan.value = clamp(Number.isFinite(options.pan) ? options.pan! : 0, -1, 1);
      source.connect(gain).connect(panner).connect(this.input);
    } else source.connect(gain).connect(this.input);
    const voice: Voice = { handle: ++this.handles, name, source, gain, panner, startAt };
    this.voices.push(voice);
    source.onended = () => this.retire(voice);
    source.start(startAt, offset);
    this.plays[name] = (this.plays[name] ?? 0) + 1;
    return voice.handle;
  }
  /** Steal the oldest voice of this sound at its limit, then the oldest overall at the global cap. */
  private makeRoom(name: SfxId): void {
    let count = 0,
      oldest: Voice | undefined;
    for (const voice of this.voices)
      if (voice.name === name) {
        count++;
        oldest ??= voice;
      }
    if (oldest && count >= voiceLimit(name)) this.fade(oldest, SFX_STOP_RAMP_S);
    if (this.voices.length >= SFX_MAX_VOICES) this.fade(this.voices[0]!, SFX_STOP_RAMP_S);
  }
  /** Fade a voice out and stop it; it is removed from the active list immediately. */
  private fade(voice: Voice, seconds: number): void {
    const index = this.voices.indexOf(voice);
    if (index === -1) return;
    this.voices.splice(index, 1);
    const now = this.ctx.currentTime;
    if (voice.startAt > now) {
      // Never started: cancel outright.
      this.disconnect(voice);
      return;
    }
    const parameter = voice.gain.gain;
    parameter.cancelScheduledValues(now);
    parameter.setValueAtTime(parameter.value, now);
    parameter.linearRampToValueAtTime(0, now + seconds);
    this.fading.add(voice);
    voice.source.onended = () => this.disconnect(voice);
    try {
      voice.source.stop(now + seconds);
    } catch {
      this.disconnect(voice);
    }
  }
  private retire(voice: Voice): void {
    const index = this.voices.indexOf(voice);
    if (index !== -1) this.voices.splice(index, 1);
    this.disconnect(voice);
  }
  private disconnect(voice: Voice): void {
    this.fading.delete(voice);
    voice.source.onended = null;
    try {
      voice.source.stop();
    } catch {
      /* Already stopped or never started. */
    }
    voice.source.disconnect();
    voice.gain.disconnect();
    voice.panner?.disconnect();
  }
  /** Fade one voice by handle (e.g. a cancelled beam charge). */
  release(handle: number | null, seconds = SFX_STOP_RAMP_S): void {
    if (handle === null) return;
    const voice = this.voices.find((candidate) => candidate.handle === handle);
    if (voice) this.fade(voice, seconds);
  }
  isActive(handle: number | null): boolean {
    return handle !== null && this.voices.some((voice) => voice.handle === handle);
  }
  /**
   * Pause boundary: stop everything already sounding, keep cues scheduled in the future. The context
   * clock freezes while suspended, so those cues still land on their song time after resume.
   */
  silenceSounding(): void {
    const now = this.ctx.currentTime;
    for (const voice of [...this.voices]) if (voice.startAt <= now) this.fade(voice, SFX_STOP_RAMP_S);
  }
  /** Stop and disconnect every voice, including future-scheduled and fading ones. */
  stop(): void {
    for (const voice of this.voices.splice(0)) this.disconnect(voice);
    for (const voice of [...this.fading]) this.disconnect(voice);
  }
  setVolume(value: number): void {
    if (Number.isFinite(value)) this.output.gain.value = clamp(value, 0, 1) * this.trim;
  }
  get activeVoices(): number {
    return this.voices.length;
  }
  countOf(name: SfxId): number {
    let count = 0;
    for (const voice of this.voices) if (voice.name === name) count++;
    return count;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
    this.bank.dispose();
    this.input.disconnect();
    this.limiter?.disconnect();
    this.output.disconnect();
  }
}
