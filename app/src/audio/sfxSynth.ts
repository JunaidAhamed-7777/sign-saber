/**
 * Sign Saber — audio/sfxSynth.ts
 *
 * Responsibility: Deterministic synthesis of the original SFX set into plain PCM channels (no Web Audio).
 * Spec: docs/15-audio-playback-sync.md §6 SFX bus
 * Inputs: Sound id, sample rate, voicing (calm flag, tonal root)
 * Outputs: Loudness-normalized Float32Array channels (BS.1770 momentary LUFS, soft-knee peak ceiling)
 *
 * Every sound is generated from code and a fixed seed: no recordings, samples or third-party material.
 * Original MIT work. Recipe numbers are authored sound content (like the samples of a WAV file), pinned
 * by the receipt in assets-src/audio/sfx-receipt.json; externally meaningful levels live in core/constants.
 */
import {
  SFX_LOUDNESS_LUFS,
  SFX_CALM_LOUDNESS_DB,
  SFX_CALM_LOWPASS_HZ,
  SFX_PEAK_CEILING_DBFS,
  SFX_PEAK_KNEE,
  SFX_SEED,
  SFX_DEFAULT_ROOT_HZ,
  SFX_UI_ROOT_HZ,
  SFX_WALL_WARN_LEAD_S,
  BEAM_CHARGE_MS,
} from '../core/constants';
import { seededRandom } from '../utils/math';
import { momentaryLufs } from './sfxMetrics';

export type SfxId = keyof typeof SFX_LOUDNESS_LUFS;
export const SFX_IDS = Object.keys(SFX_LOUDNESS_LUFS) as SfxId[];
export interface SfxVoicing {
  calm: boolean;
  /** Tonal root in Hz for pitched gameplay cues, folded into [SFX_DEFAULT_ROOT_HZ, 2 × SFX_DEFAULT_ROOT_HZ). */
  rootHz: number;
}
export const DEFAULT_VOICING: Readonly<SfxVoicing> = { calm: false, rootHz: SFX_DEFAULT_ROOT_HZ };
/**
 * Gameplay cues heard over the music and tuned to its estimated tonic. Menu and results cues play
 * without the track and keep fixed roots, so they are shared across keys.
 */
export const SFX_TONAL: ReadonlySet<SfxId> = new Set<SfxId>([
  'sparkle',
  'glint',
  'dodge',
  'combo',
  'milestone',
  'charge',
  'resume',
]);

const TAU = Math.PI * 2;
/** Filter-coefficient update interval for swept filters (structural control rate). */
const CONTROL_FRAMES = 8;
const dbToGain = (db: number): number => 10 ** (db / 20);
const semis = (n: number): number => 2 ** (n / 12);

/** Stable cache key for a rendered sound; root-independent sounds ignore the root. */
export function sfxKey(id: SfxId, voicing: SfxVoicing): string {
  const root = SFX_TONAL.has(id) ? `:${foldRoot(voicing.rootHz).toFixed(2)}` : '';
  return `${id}:${voicing.calm ? 'calm' : 'full'}${root}`;
}

/** Fold any positive frequency into one octave starting at `low`. */
export function foldRoot(hz: number, low = SFX_DEFAULT_ROOT_HZ): number {
  if (!Number.isFinite(hz) || hz <= 0) return low;
  let value = hz;
  while (value < low) value *= 2;
  while (value >= low * 2) value /= 2;
  return value;
}

/** FNV-1a 32-bit hash; used to derive a stable per-sound seed. */
export function fnv1a(text: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Zavalishin topology-preserving state-variable filter; stable under per-sample modulation. */
class Svf {
  lp = 0;
  bp = 0;
  hp = 0;
  private ic1 = 0;
  private ic2 = 0;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  private k = 1;
  private lastFc = -1;
  private lastQ = -1;
  constructor(private readonly sr: number) {}
  tune(fc: number, q: number): void {
    if (fc === this.lastFc && q === this.lastQ) return;
    this.lastFc = fc;
    this.lastQ = q;
    const f = Math.min(Math.max(fc, 10), this.sr * 0.45);
    const g = Math.tan((Math.PI * f) / this.sr);
    this.k = 1 / Math.max(q, 0.05);
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }
  tick(v0: number): void {
    const v3 = v0 - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2;
    this.bp = v1;
    this.hp = v0 - this.k * v1 - v2;
  }
}

type Curve = (t: number) => number;
type FilterType = 'lp' | 'bp' | 'hp';
type Wave = 'sine' | 'tri' | 'saw' | 'square';

/** Attack (quarter-sine) then exponential decay. */
const ar =
  (attack: number, tau: number): Curve =>
  (t) =>
    t < attack ? Math.sin((Math.PI / 2) * (t / attack)) : Math.exp(-(t - attack) / tau);
/** Exponential glide from `from` to `to` with time constant `tau`. */
const glide =
  (from: number, to: number, tau: number): Curve =>
  (t) =>
    to + (from - to) * Math.exp(-t / tau);
const polyBlep = (phase: number, dt: number): number => {
  if (phase < dt) {
    const x = phase / dt;
    return x + x - x * x - 1;
  }
  if (phase > 1 - dt) {
    const x = (phase - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
};

interface Layer {
  start?: number;
  dur: number;
  gain: number;
  pan?: number;
  env: Curve;
}

/** One render target plus layer helpers. All randomness comes from the seeded generator. */
class Synth {
  readonly ch: Float32Array[];
  readonly n: number;
  constructor(
    readonly sr: number,
    seconds: number,
    channels: 1 | 2,
    readonly random: () => number,
    readonly calm: boolean,
  ) {
    this.n = Math.max(1, Math.round(seconds * sr));
    this.ch = Array.from({ length: channels }, () => new Float32Array(this.n));
  }
  private span(layer: Layer): [number, number] {
    const begin = Math.max(0, Math.round((layer.start ?? 0) * this.sr));
    return [begin, Math.min(this.n, begin + Math.round(layer.dur * this.sr))];
  }
  /** Equal-power pan gains, unity at centre; mono renders ignore pan. */
  private gains(pan: number): [number, number] {
    if (this.ch.length === 1) return [1, 0];
    const angle = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
    return [Math.cos(angle) * Math.SQRT2, Math.sin(angle) * Math.SQRT2];
  }
  private put(index: number, value: number, gains: readonly [number, number]): void {
    this.ch[0]![index]! += value * gains[0];
    if (this.ch.length === 2) this.ch[1]![index]! += value * gains[1];
  }
  noise = (): number => this.random() * 2 - 1;
  /** Oscillator with a time-varying frequency; optional ring modulation and post filter. */
  tone(
    layer: Layer & {
      f: Curve;
      wave?: Wave;
      detuneCents?: number;
      ring?: { ratio: number; mix: number };
      filter?: { type: FilterType; fc: Curve; q: number };
      drive?: number;
    },
  ): void {
    const [begin, end] = this.span(layer);
    const ratio = semis((layer.detuneCents ?? 0) / 100);
    const filter = layer.filter ? new Svf(this.sr) : null;
    const gains = this.gains(layer.pan ?? 0);
    let phase = 0,
      ringPhase = 0;
    for (let index = begin; index < end; index++) {
      const t = (index - begin) / this.sr;
      const f = layer.f(t) * ratio;
      const dt = Math.min(f / this.sr, 0.45);
      let value: number;
      switch (layer.wave ?? 'sine') {
        case 'sine':
          value = Math.sin(TAU * phase);
          break;
        case 'tri':
          value = 1 - 4 * Math.abs(phase - 0.5);
          break;
        case 'saw':
          value = 2 * phase - 1 - polyBlep(phase, dt);
          break;
        case 'square': {
          value = (phase < 0.5 ? 1 : -1) + polyBlep(phase, dt) - polyBlep((phase + 0.5) % 1, dt);
          break;
        }
      }
      phase += dt;
      if (phase >= 1) phase -= 1;
      if (layer.ring) {
        value = value * (1 - layer.ring.mix) + value * Math.sin(TAU * ringPhase) * layer.ring.mix;
        ringPhase += (f * layer.ring.ratio) / this.sr;
        if (ringPhase >= 1) ringPhase -= 1;
      }
      if (filter) {
        if ((index - begin) % CONTROL_FRAMES === 0) filter.tune(layer.filter!.fc(t), layer.filter!.q);
        filter.tick(value);
        value = filter[layer.filter!.type];
      }
      if (layer.drive) value = Math.tanh(value * layer.drive) / Math.tanh(layer.drive);
      this.put(index, value * layer.env(t) * layer.gain, gains);
    }
  }
  /** Filtered white or pink noise. Stereo layers may decorrelate the right channel. */
  noiseBand(
    layer: Layer & {
      type: FilterType;
      fc: Curve;
      q: number;
      pink?: boolean;
      hold?: number;
      drive?: number;
      wide?: boolean;
    },
  ): void {
    const [begin, end] = this.span(layer);
    const channels = layer.wide && this.ch.length === 2 ? 2 : 1;
    const gains = this.gains(layer.pan ?? 0);
    for (let channel = 0; channel < channels; channel++) {
      const filter = new Svf(this.sr);
      let b0 = 0,
        b1 = 0,
        b2 = 0,
        held = 0;
      for (let index = begin; index < end; index++) {
        const t = (index - begin) / this.sr;
        let white = this.noise();
        if (layer.hold && layer.hold > 1) {
          if ((index - begin) % layer.hold === 0) held = white;
          white = held;
        }
        let value = white;
        if (layer.pink) {
          b0 = 0.99765 * b0 + white * 0.099046;
          b1 = 0.963 * b1 + white * 0.2965164;
          b2 = 0.57 * b2 + white * 1.0526913;
          value = (b0 + b1 + b2 + white * 0.1848) * 0.25;
        }
        if ((index - begin) % CONTROL_FRAMES === 0) filter.tune(layer.fc(t), layer.q);
        filter.tick(value);
        value = filter[layer.type];
        if (layer.drive) value = Math.tanh(value * layer.drive) / Math.tanh(layer.drive);
        const sample = value * layer.env(t) * layer.gain;
        if (channels === 2) this.ch[channel]![index]! += sample;
        else this.put(index, sample, gains);
      }
    }
  }
  /** Pitch-enveloped sine "kick" with optional soft-clip drive. */
  kick(
    layer: Omit<Layer, 'env'> & { f0: number; f1: number; pitchTau: number; tau: number; drive?: number },
  ): void {
    this.tone({
      ...layer,
      f: glide(layer.f0, layer.f1, layer.pitchTau),
      env: ar(this.calm ? 0.004 : 0.0008, layer.tau),
      ...(layer.drive ? { drive: layer.drive } : {}),
    });
  }
  /**
   * Detuned saw pad: every note at one detune/pan position shares a single filter (linear, so this
   * equals filtering each oscillator separately) to keep chords cheap to render.
   */
  pad(
    layer: Layer & {
      notes: readonly number[];
      detuneCents: readonly number[];
      pans: readonly number[];
      fc: Curve;
      q: number;
    },
  ): void {
    const [begin, end] = this.span(layer);
    layer.detuneCents.forEach((detune, voice) => {
      const gains = this.gains(layer.pans[voice] ?? 0);
      const filter = new Svf(this.sr);
      const steps = layer.notes.map((f) => Math.min((f * semis(detune / 100)) / this.sr, 0.45));
      const phases = layer.notes.map(() => this.random());
      for (let index = begin; index < end; index++) {
        const t = (index - begin) / this.sr;
        let value = 0;
        for (let note = 0; note < steps.length; note++) {
          const dt = steps[note]!;
          const phase = phases[note]!;
          value += 2 * phase - 1 - polyBlep(phase, dt);
          phases[note] = phase + dt >= 1 ? phase + dt - 1 : phase + dt;
        }
        if ((index - begin) % CONTROL_FRAMES === 0) filter.tune(layer.fc(t), layer.q);
        filter.tick(value);
        this.put(index, filter.lp * layer.env(t) * layer.gain, gains);
      }
    });
  }
  /** Two-operator FM bell: carrier `f`, modulator `f × ratio`, decaying modulation index. */
  bell(layer: Layer & { f: number; ratio: number; index: number; indexTau: number }): void {
    const [begin, end] = this.span(layer);
    const gains = this.gains(layer.pan ?? 0);
    for (let index = begin; index < end; index++) {
      const t = (index - begin) / this.sr;
      const modulation =
        layer.index * Math.exp(-t / layer.indexTau) * Math.sin(TAU * layer.f * layer.ratio * t);
      this.put(index, Math.sin(TAU * layer.f * t + modulation) * layer.env(t) * layer.gain, gains);
    }
  }
  /** Sparse decaying sinusoid grains (crackle, debris, glitter) with a time-varying rate per second. */
  grains(layer: {
    start?: number;
    dur: number;
    rate: Curve;
    fLo: number;
    fHi: number;
    tauLo: number;
    tauHi: number;
    gain: number;
    spread?: number;
  }): void {
    const begin = Math.round((layer.start ?? 0) * this.sr);
    const end = Math.min(this.n, begin + Math.round(layer.dur * this.sr));
    for (let index = begin; index < end; index++) {
      const t = (index - begin) / this.sr;
      if (this.random() >= layer.rate(t) / this.sr) continue;
      const f = layer.fLo * (layer.fHi / layer.fLo) ** this.random();
      const tau = layer.tauLo + (layer.tauHi - layer.tauLo) * this.random();
      const amplitude = (0.3 + 0.7 * this.random()) * layer.gain * (this.random() < 0.5 ? -1 : 1);
      const gains = this.gains((this.random() * 2 - 1) * (layer.spread ?? 0));
      const length = Math.min(this.n - index, Math.round(tau * 6 * this.sr));
      const decay = Math.exp(-1 / (tau * this.sr));
      let envelope = amplitude;
      for (let k = 0; k < length; k++) {
        this.put(index + k, Math.sin((TAU * f * k) / this.sr) * envelope, gains);
        envelope *= decay;
      }
    }
  }
  /** Karplus-Strong plucked string at `f`. */
  pluck(layer: { start?: number; dur: number; f: number; decay: number; gain: number; pan?: number }): void {
    const begin = Math.round((layer.start ?? 0) * this.sr);
    const end = Math.min(this.n, begin + Math.round(layer.dur * this.sr));
    const period = Math.max(2, Math.round(this.sr / layer.f));
    const line = new Float32Array(period);
    let previous = 0;
    for (let k = 0; k < period; k++) {
      // Low-passed excitation keeps the pluck soft.
      previous = previous * 0.5 + this.noise() * 0.5;
      line[k] = previous;
    }
    const gains = this.gains(layer.pan ?? 0);
    let pointer = 0,
      last = 0;
    for (let index = begin; index < end; index++) {
      const current = line[pointer]!;
      const next = (current + last) * 0.5 * layer.decay;
      last = current;
      line[pointer] = next;
      pointer = (pointer + 1) % period;
      this.put(index, current * layer.gain, gains);
    }
  }
  /** Whole-buffer filter pass. */
  filterAll(type: FilterType, fc: number, q = 0.707): void {
    for (const channel of this.ch) {
      const filter = new Svf(this.sr);
      filter.tune(fc, q);
      for (let index = 0; index < channel.length; index++) {
        filter.tick(channel[index]!);
        channel[index] = filter[type];
      }
    }
  }
  /** Gentle saturation of the whole buffer. */
  saturate(drive: number): void {
    const norm = Math.tanh(drive);
    let peak = 0;
    for (const channel of this.ch) for (const value of channel) peak = Math.max(peak, Math.abs(value));
    if (peak === 0) return;
    for (const channel of this.ch)
      for (let index = 0; index < channel.length; index++)
        channel[index] = (Math.tanh((channel[index]! / peak) * drive) / norm) * peak;
  }
  /**
   * Small Schroeder/Freeverb-style room: four damped combs and two allpasses per channel, mixed in
   * under the dry signal. Stereo renders get decorrelated left/right tails.
   */
  room(mix: number, size = 0.7, feedback = 0.78, damp = 0.35): void {
    if (mix <= 0) return;
    const scale = (this.sr / 44100) * size;
    const input = new Float32Array(this.n);
    for (const channel of this.ch)
      for (let index = 0; index < this.n; index++) input[index]! += channel[index]!;
    const inputGain = 1 / this.ch.length;
    this.ch.forEach((channel, c) => {
      const spread = c * 23;
      const combs = [1116, 1188, 1277, 1356].map((length) => ({
        line: new Float32Array(Math.max(1, Math.round((length + spread) * scale))),
        pointer: 0,
        store: 0,
      }));
      const allpasses = [556, 441].map((length) => ({
        line: new Float32Array(Math.max(1, Math.round((length + spread) * scale))),
        pointer: 0,
      }));
      for (let index = 0; index < this.n; index++) {
        const x = input[index]! * inputGain * 0.25;
        let wet = 0;
        for (const comb of combs) {
          const y = comb.line[comb.pointer]!;
          comb.store = y * (1 - damp) + comb.store * damp;
          comb.line[comb.pointer] = x + comb.store * feedback;
          if (++comb.pointer === comb.line.length) comb.pointer = 0;
          wet += y;
        }
        for (const allpass of allpasses) {
          const buffered = allpass.line[allpass.pointer]!;
          allpass.line[allpass.pointer] = wet + buffered * 0.5;
          if (++allpass.pointer === allpass.line.length) allpass.pointer = 0;
          wet = buffered - wet;
        }
        channel[index]! += wet * mix;
      }
    });
  }
  /** DC block, click-free edges, loudness normalization and the peak ceiling. */
  finish(lufs: number, fadeOutS: number): Float32Array[] {
    const r = Math.exp((-TAU * 20) / this.sr);
    for (const channel of this.ch) {
      let x1 = 0,
        y1 = 0;
      for (let index = 0; index < channel.length; index++) {
        const x = channel[index]!;
        const y = x - x1 + r * y1;
        x1 = x;
        y1 = y;
        channel[index] = y;
      }
      const fadeIn = Math.min(channel.length, Math.max(1, Math.round(0.0005 * this.sr)));
      for (let index = 0; index < fadeIn; index++)
        channel[index]! *= 0.5 - 0.5 * Math.cos((Math.PI * index) / fadeIn);
      const fadeOut = Math.min(channel.length, Math.max(1, Math.round(fadeOutS * this.sr)));
      for (let k = 0; k < fadeOut; k++)
        channel[channel.length - 1 - k]! *= 0.5 - 0.5 * Math.cos((Math.PI * k) / fadeOut);
    }
    const measured = momentaryLufs(this.ch, this.sr);
    if (Number.isFinite(measured)) {
      const gain = dbToGain(lufs - measured);
      for (const channel of this.ch)
        for (let index = 0; index < channel.length; index++) channel[index]! *= gain;
    }
    // Soft knee: identity below the knee, smooth approach to the ceiling above it (never reached).
    const ceiling = dbToGain(SFX_PEAK_CEILING_DBFS),
      knee = ceiling * SFX_PEAK_KNEE,
      room = ceiling - knee;
    for (const channel of this.ch)
      for (let index = 0; index < channel.length; index++) {
        const value = channel[index]!,
          magnitude = Math.abs(value);
        if (magnitude > knee)
          channel[index] = Math.sign(value) * (knee + room * Math.tanh((magnitude - knee) / room));
      }
    return this.ch;
  }
}

interface Recipe {
  seconds: number;
  channels: 1 | 2;
  fadeOutS: number;
  draw(s: Synth, root: number): void;
}
const CHARGE_S = BEAM_CHARGE_MS / 1000;

/** Authored recipes. Gesture identity: slash bright/airy, smash low/crunchy, beam electric. */
const RECIPES: Record<SfxId, Recipe> = {
  slash: {
    seconds: 0.34,
    channels: 1,
    fadeOutS: 0.06,
    draw(s) {
      const top = s.calm ? 4200 : 8400;
      // Swish: band-passed noise swept up through the cut, then settling.
      s.noiseBand({
        dur: 0.3,
        type: 'bp',
        q: s.calm ? 0.8 : 1.1,
        fc: (t) =>
          t < 0.07 ? 1400 * (top / 1400) ** (t / 0.07) : Math.max(2400, top * Math.exp(-(t - 0.07) / 0.12)),
        env: ar(s.calm ? 0.012 : 0.004, 0.06),
        gain: 1,
      });
      // Sizzle: dense bright crackle on the blade edge.
      if (!s.calm)
        s.grains({
          start: 0.006,
          dur: 0.2,
          rate: (t) => 2600 * Math.exp(-t / 0.05),
          fLo: 5000,
          fHi: 9500,
          tauLo: 0.0004,
          tauHi: 0.0012,
          gain: 0.35,
        });
      // Glassy ting where the blade parts the block.
      s.tone({
        start: 0.008,
        dur: 0.2,
        f: () => (s.calm ? 1700 : 2380),
        env: ar(0.001, 0.045),
        gain: s.calm ? 0.12 : 0.28,
      });
      if (!s.calm) s.tone({ start: 0.008, dur: 0.15, f: () => 3610, env: ar(0.001, 0.03), gain: 0.16 });
      // A little body so the cut has weight.
      s.kick({ dur: 0.2, f0: 260, f1: 110, pitchTau: 0.02, tau: 0.035, gain: 0.3 });
      s.room(0.12, 0.6);
    },
  },
  smash: {
    seconds: 0.5,
    channels: 1,
    fadeOutS: 0.08,
    draw(s) {
      s.kick({ dur: 0.45, f0: 190, f1: 46, pitchTau: 0.028, tau: 0.13, drive: s.calm ? 1.2 : 2.2, gain: 1 });
      s.noiseBand({
        dur: 0.02,
        type: 'bp',
        fc: () => 3200,
        q: 1.5,
        env: ar(0.0003, 0.0025),
        gain: s.calm ? 0.15 : 0.5,
      });
      // Crunch: decimated, driven mid noise.
      s.noiseBand({
        dur: 0.25,
        type: 'bp',
        fc: () => 1500,
        q: 0.8,
        ...(s.calm ? {} : { hold: Math.max(1, Math.round(s.sr / 8000)), drive: 3 }),
        env: ar(0.0005, 0.05),
        gain: s.calm ? 0.25 : 0.55,
      });
      // Debris: sparse decaying fragments.
      s.grains({
        start: 0.004,
        dur: 0.35,
        rate: (t) => 600 * Math.exp(-t / 0.09),
        fLo: 700,
        fHi: 3000,
        tauLo: 0.003,
        tauHi: 0.009,
        gain: s.calm ? 0.12 : 0.35,
      });
      s.room(0.1, 0.6);
    },
  },
  zap: {
    seconds: 0.36,
    channels: 1,
    fadeOutS: 0.06,
    draw(s) {
      const f = s.calm ? glide(1300, 200, 0.08) : glide(2560, 260, 0.06);
      for (const detune of [-12, 12])
        s.tone({
          dur: 0.32,
          f,
          wave: 'saw',
          detuneCents: detune,
          ...(s.calm ? {} : { ring: { ratio: 0.71, mix: 0.35 } }),
          filter: { type: 'lp', fc: (t) => Math.min(3.2 * f(t), 12000), q: s.calm ? 1 : 2.5 },
          env: ar(0.002, 0.085),
          gain: s.calm ? 0.3 : 0.38,
        });
      if (!s.calm)
        s.grains({
          dur: 0.2,
          rate: (t) => 3500 * Math.exp(-t / 0.05),
          fLo: 3000,
          fHi: 7000,
          tauLo: 0.0003,
          tauHi: 0.0008,
          gain: 0.3,
        });
      s.kick({ dur: 0.2, f0: 120, f1: 55, pitchTau: 0.03, tau: 0.05, gain: 0.35 });
      s.room(0.14, 0.7);
    },
  },
  poof: {
    seconds: 0.4,
    channels: 1,
    fadeOutS: 0.08,
    draw(s) {
      s.tone({ dur: 0.15, f: glide(1020, 320, 0.012), env: ar(0.0008, 0.03), gain: 0.7 });
      s.noiseBand({
        dur: 0.2,
        type: 'lp',
        fc: glide(2900, 300, 0.06),
        q: 0.7,
        env: ar(0.002, 0.045),
        gain: 0.5,
      });
      // Power-down sweep.
      s.tone({ dur: 0.38, f: glide(710, 90, 0.11), wave: 'tri', env: ar(0.004, 0.12), gain: 0.35 });
      s.room(0.18, 0.7);
    },
  },
  sparkle: {
    seconds: 0.6,
    channels: 2,
    fadeOutS: 0.12,
    draw(s, root) {
      const partials = s.calm
        ? [
            [2, 0, -0.3, 0.2, 0.55],
            [3, 0.03, 0.3, 0.16, 0.4],
          ]
        : [
            [2, 0, -0.5, 0.16, 0.55],
            [3, 0.024, 0.45, 0.13, 0.45],
            [4, 0.048, -0.25, 0.11, 0.4],
            [6, 0.075, 0.6, 0.09, 0.3],
          ];
      for (const [multiple, start, pan, tau, gain] of partials)
        s.bell({
          start: start!,
          dur: 0.5,
          f: root * multiple!,
          ratio: 2,
          index: s.calm ? 0.3 : 0.6,
          indexTau: 0.05,
          env: ar(s.calm ? 0.006 : 0.001, tau!),
          gain: gain!,
          pan: pan!,
        });
      if (!s.calm)
        s.grains({
          dur: 0.4,
          rate: (t) => 900 * Math.exp(-t / 0.12),
          fLo: 7000,
          fHi: 11000,
          tauLo: 0.0005,
          tauHi: 0.0015,
          gain: 0.12,
          spread: 0.8,
        });
      s.room(0.22, 0.8);
    },
  },
  glint: {
    seconds: 0.25,
    channels: 1,
    fadeOutS: 0.06,
    draw(s, root) {
      if (s.calm) {
        s.tone({ dur: 0.22, f: () => root * 2, env: ar(0.004, 0.06), gain: 0.6 });
        return;
      }
      s.tone({ dur: 0.22, f: () => root * 4, env: ar(0.001, 0.05), gain: 0.6 });
      s.tone({ dur: 0.18, f: () => root * 6, env: ar(0.001, 0.035), gain: 0.35 });
    },
  },
  badcut: {
    seconds: 0.42,
    channels: 1,
    fadeOutS: 0.08,
    draw(s) {
      // Struck plate: inharmonic partials with a short pitch-down glide.
      const f0 = 310;
      const plate = [
        [1, 1, 0.2],
        [1.594, 0.75, 0.15],
        [2.136, 0.55, 0.12],
        [2.653, 0.5, 0.1],
        [3.156, 0.35, 0.07],
        [4.18, 0.22, 0.05],
      ];
      for (const [ratio, gain, tau] of plate)
        s.tone({
          dur: 0.4,
          f: (t) => f0 * ratio! * (1 - 0.09 * (1 - Math.exp(-t / 0.12))),
          env: ar(0.0005, tau!),
          gain: gain! * 0.4,
        });
      s.noiseBand({ dur: 0.02, type: 'bp', fc: () => 2200, q: 1.2, env: ar(0.0003, 0.003), gain: 0.45 });
      s.filterAll('lp', s.calm ? 3000 : 5200);
      s.saturate(1.3);
      s.room(0.12, 0.6);
    },
  },
  miss: {
    seconds: 0.2,
    channels: 1,
    fadeOutS: 0.05,
    draw(s) {
      s.tone({ dur: 0.18, f: glide(165, 95, 0.03), env: ar(s.calm ? 0.008 : 0.004, 0.05), gain: 1 });
      s.noiseBand({ dur: 0.08, type: 'lp', fc: () => 700, q: 0.7, env: ar(0.002, 0.02), gain: 0.25 });
    },
  },
  wallWarn: {
    seconds: SFX_WALL_WARN_LEAD_S + 0.12,
    channels: 1,
    fadeOutS: 0.04,
    draw(s) {
      const T = SFX_WALL_WARN_LEAD_S;
      const rise: Curve = (t) => (t < T ? (t / T) ** 2.4 : Math.exp(-(t - T) / 0.03));
      const x = (t: number): number => Math.min(t, T) / T;
      s.noiseBand({
        dur: T + 0.1,
        type: 'bp',
        pink: true,
        fc: (t) => 350 * 6.5 ** x(t),
        q: 1.6,
        env: rise,
        gain: 0.7,
      });
      // Low throb with an accelerating pulse.
      s.tone({
        dur: T + 0.1,
        f: () => 72,
        env: (t) => rise(t) * (0.6 + 0.4 * Math.sin(TAU * (8 * t + (5 * t * t) / T))),
        gain: 0.6,
      });
      if (!s.calm)
        s.tone({
          dur: T + 0.1,
          f: (t) => 220 * 2 ** (0.5 * x(t)),
          wave: 'saw',
          filter: { type: 'lp', fc: () => 1400, q: 0.9 },
          env: rise,
          gain: 0.25,
        });
    },
  },
  wallHit: {
    seconds: 0.55,
    channels: 1,
    fadeOutS: 0.08,
    draw(s) {
      s.kick({ dur: 0.5, f0: 150, f1: 42, pitchTau: 0.03, tau: 0.16, drive: s.calm ? 1.2 : 2.5, gain: 1 });
      // Shield buzz: two saws a fifth apart, driven and band-passed.
      for (const f of [98, 147])
        s.tone({
          dur: 0.45,
          f: () => f,
          wave: 'saw',
          ...(s.calm ? {} : { drive: 2.5 }),
          filter: { type: s.calm ? 'lp' : 'bp', fc: () => (s.calm ? 600 : 900), q: 1 },
          env: ar(0.002, 0.15),
          gain: s.calm ? 0.15 : 0.25,
        });
      s.noiseBand({
        dur: 0.1,
        type: 'bp',
        fc: () => 2500,
        q: 0.9,
        env: ar(0.001, 0.03),
        gain: s.calm ? 0.1 : 0.3,
      });
      s.room(0.1, 0.6);
    },
  },
  dodge: {
    seconds: 0.45,
    channels: 1,
    fadeOutS: 0.08,
    draw(s, root) {
      s.noiseBand({
        dur: 0.42,
        type: 'bp',
        fc: glide(3200, 600, 0.18),
        q: 1.3,
        env: (t) => (t < 0.11 ? Math.sin((Math.PI / 2) * (t / 0.11)) ** 2 : Math.exp(-(t - 0.11) / 0.09)),
        gain: 1,
      });
      s.bell({
        start: 0.09,
        dur: 0.3,
        f: root * (s.calm ? 2 : 4),
        ratio: 2,
        index: 0.4,
        indexTau: 0.04,
        env: ar(0.002, 0.07),
        gain: s.calm ? 0.12 : 0.18,
      });
      s.room(0.16, 0.7);
    },
  },
  combo: {
    seconds: 0.75,
    channels: 2,
    fadeOutS: 0.15,
    draw(s, root) {
      const notes = [
        [1, 0, -0.35, 0.6],
        [1.5, 0.07, 0, 0.55],
        [2, 0.14, 0.35, 0.6],
      ];
      for (const [multiple, start, pan, gain] of notes)
        s.bell({
          start: start!,
          dur: 0.6,
          f: root * multiple!,
          ratio: s.calm ? 2 : 3.5,
          index: s.calm ? 0.6 : 1.8,
          indexTau: 0.05,
          env: ar(s.calm ? 0.004 : 0.001, 0.3),
          gain: gain!,
          pan: pan!,
        });
      s.tone({ start: 0.14, dur: 0.5, f: () => root * 4, env: ar(0.002, 0.2), gain: 0.15, pan: 0.2 });
      s.room(0.25, 0.9);
    },
  },
  milestone: {
    seconds: 1,
    channels: 2,
    fadeOutS: 0.25,
    draw(s, root) {
      // Power-chord pad (no third: consonant in either mode) with an opening filter.
      s.pad({
        dur: 0.95,
        notes: [0.5, 0.75, 1, 1.5].map((multiple) => root * multiple),
        detuneCents: [-9, 0, 9],
        pans: [-0.6, 0, 0.6],
        fc: (t) => 700 + (s.calm ? 1800 : 4200) * Math.sin(Math.PI * Math.min(1, t / 0.6)),
        q: 0.9,
        env: ar(s.calm ? 0.04 : 0.012, 0.35),
        gain: 0.1,
      });
      [2, 3, 4].forEach((multiple, index) =>
        s.bell({
          start: 0.02 + index * 0.07,
          dur: 0.8,
          f: root * multiple,
          ratio: 2,
          index: 0.8,
          indexTau: 0.06,
          env: ar(0.002, 0.25),
          gain: 0.35,
          pan: (index - 1) * 0.5,
        }),
      );
      if (!s.calm) {
        s.grains({
          dur: 0.7,
          rate: (t) => 1200 * Math.exp(-t / 0.25),
          fLo: 6000,
          fHi: 11000,
          tauLo: 0.0006,
          tauHi: 0.002,
          gain: 0.1,
          spread: 0.9,
        });
        s.kick({ dur: 0.6, f0: 110, f1: 55, pitchTau: 0.04, tau: 0.2, gain: 0.35 });
      }
      s.room(0.28, 0.95);
    },
  },
  comboBreak: {
    seconds: 0.38,
    channels: 1,
    fadeOutS: 0.08,
    draw(s) {
      s.tone({
        dur: 0.36,
        f: glide(410, 110, 0.09),
        wave: 'saw',
        filter: { type: 'lp', fc: () => 900, q: 0.9 },
        env: ar(0.006, 0.12),
        gain: 0.7,
      });
      s.noiseBand({ dur: 0.1, type: 'lp', fc: () => 500, q: 0.7, env: ar(0.003, 0.04), gain: 0.2 });
    },
  },
  drop: {
    seconds: 1.1,
    channels: 2,
    fadeOutS: 0.3,
    draw(s) {
      s.kick({ dur: 1, f0: 70, f1: 36, pitchTau: 0.06, tau: 0.42, drive: s.calm ? 1 : 1.6, gain: 1 });
      s.noiseBand({
        dur: 1,
        type: 'hp',
        fc: () => 2500,
        q: 0.7,
        wide: true,
        env: ar(0.002, 0.32),
        gain: s.calm ? 0.12 : 0.35,
      });
      if (!s.calm)
        s.noiseBand({
          dur: 1,
          type: 'bp',
          fc: (t) => 3000 * 2 ** (1.5 * t),
          q: 4,
          wide: true,
          env: ar(0.03, 0.4),
          gain: 0.2,
        });
      s.room(0.2, 0.95);
    },
  },
  count: {
    seconds: 0.14,
    channels: 1,
    fadeOutS: 0.04,
    draw(s, root) {
      // Tuned woodblock: fundamental on the tonic, one short inharmonic partial and a click.
      s.tone({ dur: 0.13, f: () => root * 2, env: ar(0.0005, s.calm ? 0.035 : 0.028), gain: 0.8 });
      s.tone({ dur: 0.06, f: () => root * 2 * 2.76, env: ar(0.0005, 0.012), gain: s.calm ? 0.1 : 0.25 });
      if (!s.calm)
        s.noiseBand({ dur: 0.01, type: 'bp', fc: () => 3500, q: 1, env: ar(0.0002, 0.002), gain: 0.3 });
    },
  },
  countGo: {
    seconds: 0.3,
    channels: 1,
    fadeOutS: 0.06,
    draw(s, root) {
      s.tone({ dur: 0.28, f: () => root * 4, env: ar(0.0005, 0.07), gain: 0.8 });
      s.tone({ dur: 0.16, f: () => root * 6, env: ar(0.0005, 0.04), gain: s.calm ? 0.1 : 0.25 });
      if (!s.calm)
        s.noiseBand({ dur: 0.01, type: 'bp', fc: () => 4200, q: 1, env: ar(0.0002, 0.002), gain: 0.3 });
      s.room(0.12, 0.6);
    },
  },
  countNeutral: {
    seconds: 0.1,
    channels: 1,
    fadeOutS: 0.03,
    draw(s) {
      // Unpitched: no musical claim about the track's tempo or key.
      s.noiseBand({
        dur: 0.05,
        type: 'bp',
        fc: () => 2600,
        q: 3,
        env: ar(0.0003, s.calm ? 0.01 : 0.007),
        gain: 1,
      });
      s.noiseBand({ dur: 0.08, type: 'bp', fc: () => 1200, q: 2, env: ar(0.0003, 0.012), gain: 0.5 });
    },
  },
  charge: {
    seconds: CHARGE_S + 0.12,
    channels: 1,
    fadeOutS: 0.04,
    draw(s, root) {
      const C = CHARGE_S;
      const x = (t: number): number => Math.min(t, C) / C;
      const env: Curve = (t) =>
        t < C
          ? (0.25 + 0.75 * x(t) ** 1.5) * (0.75 + 0.25 * Math.sin(TAU * (6 * t + (11 * t * t) / C)))
          : Math.exp(-(t - C) / 0.02);
      const filter = { type: 'lp' as const, fc: (t: number) => 500 * 8 ** x(t), q: s.calm ? 1 : 3.5 };
      s.tone({ dur: C + 0.1, f: (t) => 170 * 4 ** x(t), wave: 'saw', filter, env, gain: 0.6 });
      s.tone({ dur: C + 0.1, f: (t) => 170 * 4 ** x(t), wave: 'square', filter, env, gain: 0.15 });
      // "Ready" ping exactly at full charge.
      s.bell({
        start: C,
        dur: 0.11,
        f: root * 4,
        ratio: 2,
        index: 0.5,
        indexTau: 0.03,
        env: ar(0.001, 0.05),
        gain: 0.5,
      });
    },
  },
  resultsHigh: {
    seconds: 2.4,
    channels: 2,
    fadeOutS: 0.6,
    draw(s) {
      const root = SFX_DEFAULT_ROOT_HZ;
      s.pad({
        dur: 2.3,
        notes: [0.5, 0.75, 1, semis(4), 1.5].map((multiple) => root * multiple),
        detuneCents: [-7, 0, 7],
        pans: [-0.7, 0, 0.7],
        fc: (t) => 600 + (s.calm ? 1400 : 3000) * (1 - Math.exp(-t / 0.35)) * Math.exp(-t / 1.4),
        q: 0.8,
        env: ar(0.09, 0.9),
        gain: 0.06,
      });
      [2, 3, 4, 6].forEach((multiple, index) =>
        s.bell({
          start: 0.1 + index * 0.12,
          dur: 1.8,
          f: root * multiple,
          ratio: 2,
          index: 0.7,
          indexTau: 0.08,
          env: ar(0.002, 0.4),
          gain: s.calm ? 0.18 : 0.3,
          pan: index % 2 ? 0.45 : -0.45,
        }),
      );
      s.kick({ dur: 1.2, f0: 90, f1: 45, pitchTau: 0.05, tau: 0.5, gain: s.calm ? 0.2 : 0.45 });
      if (!s.calm)
        s.grains({
          dur: 1.6,
          rate: (t) => 600 * Math.exp(-t / 0.6),
          fLo: 6000,
          fHi: 11000,
          tauLo: 0.0008,
          tauHi: 0.003,
          gain: 0.08,
          spread: 0.9,
        });
      s.room(0.3, 1);
    },
  },
  resultsLow: {
    seconds: 2.2,
    channels: 2,
    fadeOutS: 0.6,
    draw(s) {
      // Open fifths, no third: a calm close that neither celebrates nor scolds.
      const root = SFX_DEFAULT_ROOT_HZ;
      s.pad({
        dur: 2.1,
        notes: [0.5, 0.75, 1, 1.5].map((multiple) => root * multiple),
        detuneCents: [-6, 6],
        pans: [-0.6, 0.6],
        fc: (t) => 400 + 1200 * Math.sin(Math.PI * Math.min(1, t / 1.6)),
        q: 0.7,
        env: ar(0.15, 0.8),
        gain: 0.08,
      });
      s.bell({
        start: 0.2,
        dur: 1.6,
        f: root * 2,
        ratio: 2,
        index: 0.4,
        indexTau: 0.08,
        env: ar(0.004, 0.5),
        gain: 0.2,
      });
      s.room(0.3, 1);
    },
  },
  resume: {
    seconds: 0.32,
    channels: 1,
    fadeOutS: 0.05,
    draw(s, root) {
      const env: Curve = (t) => (t < 0.18 ? (t / 0.18) ** 1.5 : Math.exp(-(t - 0.18) / 0.04));
      s.noiseBand({
        dur: 0.28,
        type: 'bp',
        fc: (t) => 500 * 6 ** Math.min(1, t / 0.22),
        q: 1.2,
        env,
        gain: 0.7,
      });
      s.tone({ dur: 0.28, f: (t) => root * 2 ** Math.min(1, t / 0.2), env, gain: 0.25 });
    },
  },
  uiHover: {
    seconds: 0.06,
    channels: 1,
    fadeOutS: 0.02,
    draw(s) {
      s.tone({
        dur: 0.06,
        f: () => SFX_UI_ROOT_HZ * (s.calm ? 1.5 : 2),
        env: ar(0.001, s.calm ? 0.015 : 0.012),
        gain: 1,
      });
      if (!s.calm)
        s.noiseBand({ dur: 0.01, type: 'hp', fc: () => 6000, q: 0.7, env: ar(0.0003, 0.002), gain: 0.15 });
    },
  },
  uiConfirm: {
    seconds: 0.22,
    channels: 1,
    fadeOutS: 0.05,
    draw(s) {
      s.tone({ dur: 0.12, f: () => SFX_UI_ROOT_HZ, wave: 'tri', env: ar(0.001, 0.05), gain: 0.6 });
      s.tone({
        start: 0.045,
        dur: 0.16,
        f: () => SFX_UI_ROOT_HZ * 1.5,
        wave: 'tri',
        env: ar(0.001, 0.055),
        gain: 0.6,
      });
      s.room(0.1, 0.5);
    },
  },
  uiBack: {
    seconds: 0.24,
    channels: 1,
    fadeOutS: 0.05,
    draw(s) {
      s.tone({ dur: 0.12, f: () => SFX_UI_ROOT_HZ * 1.5, wave: 'tri', env: ar(0.001, 0.05), gain: 0.5 });
      s.tone({
        start: 0.045,
        dur: 0.16,
        f: () => SFX_UI_ROOT_HZ,
        wave: 'tri',
        env: ar(0.001, 0.05),
        gain: 0.5,
      });
      s.room(0.1, 0.5);
    },
  },
  uiSelect: {
    seconds: 0.18,
    channels: 1,
    fadeOutS: 0.05,
    draw(s) {
      s.pluck({ dur: 0.18, f: SFX_UI_ROOT_HZ, decay: s.calm ? 0.985 : 0.992, gain: 1 });
      if (s.calm) s.filterAll('lp', 2500);
    },
  },
  uiArm: {
    seconds: 0.16,
    channels: 1,
    fadeOutS: 0.04,
    draw(s) {
      s.tone({
        dur: 0.15,
        f: (t) => SFX_UI_ROOT_HZ * (0.75 + 0.25 * Math.min(1, t / 0.1)),
        env: ar(0.008, 0.05),
        gain: 0.8,
      });
    },
  },
  uiEnable: {
    seconds: 0.7,
    channels: 2,
    fadeOutS: 0.15,
    draw(s) {
      [1, semis(4), 1.5].forEach((multiple, index) =>
        s.bell({
          start: index * 0.08,
          dur: 0.6,
          f: SFX_UI_ROOT_HZ * multiple,
          ratio: 2,
          index: s.calm ? 0.3 : 0.6,
          indexTau: 0.05,
          env: ar(0.002, 0.25),
          gain: 0.5,
          pan: (index - 1) * 0.4,
        }),
      );
      s.room(0.25, 0.8);
    },
  },
};

/** Duration (s) and channel count of a sound, without rendering it. */
export function sfxShape(id: SfxId): { seconds: number; channels: 1 | 2 } {
  const recipe = RECIPES[id];
  return { seconds: recipe.seconds, channels: recipe.channels };
}

/** Momentary loudness (LUFS) a rendered sound is normalized to for a voicing. */
export function sfxLoudness(id: SfxId, calm: boolean): number {
  return SFX_LOUDNESS_LUFS[id] + (calm ? SFX_CALM_LOUDNESS_DB : 0);
}

/**
 * Render one sound. Deterministic for (id, sampleRate, voicing): the seed depends only on the id and
 * calm flag, so the tonal root changes pitch without changing noise textures. Typical cost is a few
 * milliseconds per cue; the bank renders off the main thread when a Worker is available.
 */
export function renderSfx(
  id: SfxId,
  sampleRate: number,
  voicing: SfxVoicing = DEFAULT_VOICING,
): Float32Array[] {
  const recipe = RECIPES[id];
  if (!recipe) throw new Error(`Unknown sound: ${String(id)}`);
  if (!Number.isFinite(sampleRate) || sampleRate < 8000)
    throw new RangeError('SFX sample rate must be at least 8 kHz');
  const random = seededRandom(fnv1a(`${id}:${voicing.calm ? 'calm' : 'full'}`, SFX_SEED));
  const synth = new Synth(sampleRate, recipe.seconds, recipe.channels, random, voicing.calm);
  recipe.draw(synth, foldRoot(SFX_TONAL.has(id) ? voicing.rootHz : SFX_DEFAULT_ROOT_HZ));
  if (voicing.calm) synth.filterAll('lp', SFX_CALM_LOWPASS_HZ);
  return synth.finish(sfxLoudness(id, voicing.calm), recipe.fadeOutS);
}
