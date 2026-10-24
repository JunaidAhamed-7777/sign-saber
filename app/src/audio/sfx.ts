/**
 * Sign Saber — audio/sfx.ts
 *
 * Responsibility: SFX bus: 9 one-shot sounds, random pitch, per-sound gain, music ducking.
 * Spec: docs/15-audio-playback-sync.md §SFX bus
 * Inputs: Game events
 * Outputs: Sound
 *
 * Implemented for the first playable spine. Replay/unit evidence is separate from live-camera acceptance.
 */
import {
  SFX_SYNTH_DURATION_S,
  SFX_SYNTH_GAIN,
  SFX_SYNTH_FREQUENCIES,
  SFX_POLYPHONY,
  SFX_GAIN_DEFAULT,
  SFX_STOP_RAMP_S,
  SFX_JUDGEMENT_RATE,
} from '../core/constants';
import type { Judgement } from '../game/judge';
import { clamp, seededRandom } from '../utils/math';

export type SfxName = keyof typeof SFX_SYNTH_FREQUENCIES;
interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
  name: SfxName;
  order: number;
  released: boolean;
}

/** Original procedural fallback sounds, prepared once. No external recording or implied OGG readiness. */
export class SfxBus {
  readonly gain: GainNode;
  private readonly buffers: Record<SfxName, AudioBuffer>;
  private readonly voices: Voice[] = [];
  private order = 0;
  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode = ctx.destination,
  ) {
    this.gain = ctx.createGain();
    this.gain.gain.value = SFX_GAIN_DEFAULT;
    this.gain.connect(destination);
    this.buffers = {} as Record<SfxName, AudioBuffer>;
    for (const name of Object.keys(SFX_SYNTH_FREQUENCIES) as SfxName[]) {
      const buffer = ctx.createBuffer(1, Math.ceil(SFX_SYNTH_DURATION_S * ctx.sampleRate), ctx.sampleRate);
      const samples = buffer.getChannelData(0);
      const frequency = SFX_SYNTH_FREQUENCIES[name];
      const random = seededRandom(frequency);
      for (let index = 0; index < samples.length; index++) {
        const fraction = index / samples.length;
        const envelope = (1 - fraction) ** 2;
        // Equal blend of deterministic noise and a descending tone; bounded peak headroom.
        const noise = random() * 2 - 1;
        const phase = ((2 * Math.PI * frequency * index) / ctx.sampleRate) * (1 - fraction / 2);
        samples[index] = ((Math.sin(phase) + noise) / 2) * envelope * SFX_SYNTH_GAIN;
      }
      this.buffers[name] = buffer;
    }
  }
  play(name: SfxName, judgement?: Judgement, at = this.ctx.currentTime): void {
    if (this.ctx.state !== 'running') return;
    let count = 0;
    let oldest: Voice | undefined;
    for (const voice of this.voices)
      if (voice.name === name && !voice.released) {
        count++;
        if (!oldest || voice.order < oldest.order) oldest = voice;
      }
    if (count >= SFX_POLYPHONY && oldest) this.release(oldest, true);
    const source = this.ctx.createBufferSource(),
      gain = this.ctx.createGain();
    source.buffer = this.buffers[name];
    source.playbackRate.value = judgement ? SFX_JUDGEMENT_RATE[judgement] : 1;
    source.connect(gain).connect(this.gain);
    const voice: Voice = { source, gain, name, order: this.order++, released: false };
    this.voices.push(voice);
    source.onended = () => this.release(voice, false);
    source.start(Math.max(this.ctx.currentTime, at));
  }
  private release(voice: Voice, fade: boolean): void {
    if (voice.released) return;
    voice.released = true;
    if (fade) {
      const now = this.ctx.currentTime;
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
      voice.gain.gain.linearRampToValueAtTime(0, now + SFX_STOP_RAMP_S);
      voice.source.stop(now + SFX_STOP_RAMP_S);
      voice.source.onended = () => {
        voice.source.disconnect();
        voice.gain.disconnect();
      };
    } else {
      voice.source.onended = null;
      voice.source.disconnect();
      voice.gain.disconnect();
    }
    const index = this.voices.indexOf(voice);
    if (index !== -1) this.voices.splice(index, 1);
  }
  setVolume(value: number): void {
    if (Number.isFinite(value)) this.gain.gain.value = clamp(value, 0, 1);
  }
  stop(): void {
    for (let index = this.voices.length - 1; index >= 0; index--) {
      const voice = this.voices[index]!;
      try {
        voice.source.stop();
      } catch {
        /* Already ended. */
      }
      this.release(voice, false);
    }
  }
  dispose(): void {
    this.stop();
    this.gain.disconnect();
  }
  get activeVoices(): number {
    return this.voices.length;
  }
}
