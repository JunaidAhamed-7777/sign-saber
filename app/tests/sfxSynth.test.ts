/** Offline rendering, loudness and spectral bounds of the original SFX set. Not audible-output evidence. */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VOICING,
  SFX_IDS,
  SFX_TONAL,
  foldRoot,
  renderSfx,
  sfxKey,
  sfxLoudness,
  sfxShape,
} from '../src/audio/sfxSynth';
import type { SfxId } from '../src/audio/sfxSynth';
import { dcAndMaxStep, measureSfx, momentaryLufs, peakDb, spectralCentroidHz } from '../src/audio/sfxMetrics';
import type { SfxMeasurement } from '../src/audio/sfxMetrics';
import { estimateTonalCenter, pitchClassHz } from '../src/audio/tonic';
import receipt from '../../assets-src/audio/sfx-receipt.json';
import {
  SFX_DYNAMICS_DB,
  SFX_LIMITER,
  SFX_PEAK_CEILING_DBFS,
  SFX_CALM_LOUDNESS_DB,
  SFX_DEFAULT_ROOT_HZ,
  SFX_WALL_WARN_LEAD_S,
  BEAM_CHARGE_MS,
} from '../src/core/constants';

const RATE = 48000;
const full = new Map<SfxId, Float32Array[]>();
const calm = new Map<SfxId, Float32Array[]>();
const measured = new Map<string, SfxMeasurement>();
for (const id of SFX_IDS) {
  full.set(id, renderSfx(id, RATE, DEFAULT_VOICING));
  calm.set(id, renderSfx(id, RATE, { ...DEFAULT_VOICING, calm: true }));
  measured.set(id, measureSfx(full.get(id)!, RATE));
  measured.set(`${id}.calm`, measureSfx(calm.get(id)!, RATE));
}
const m = (id: string): SfxMeasurement => measured.get(id)!;
/** SHA-256 of little-endian float32 PCM, channels concatenated (same as scripts/render-sfx.mjs). */
const pcmHash = async (channels: Float32Array[]): Promise<string> => {
  const bytes = new Uint8Array(channels.reduce((total, channel) => total + channel.byteLength, 0));
  let offset = 0;
  for (const channel of channels) {
    bytes.set(new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength), offset);
    offset += channel.byteLength;
  }
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (value) => value.toString(16).padStart(2, '0')).join('');
};

describe('meter calibration', () => {
  it('reads a −20 dBFS 1 kHz sine as about −23 LUFS (BS.1770 reference behaviour)', () => {
    const sine = new Float32Array(RATE);
    for (let index = 0; index < sine.length; index++)
      sine[index] = 0.1 * Math.sin((2 * Math.PI * 1000 * index) / RATE);
    expect(momentaryLufs([sine], RATE)).toBeCloseTo(-23.0, 0);
    expect(peakDb([sine])).toBeCloseTo(-20, 2);
    expect(spectralCentroidHz([sine], RATE)).toBeGreaterThan(950);
    expect(spectralCentroidHz([sine], RATE)).toBeLessThan(1050);
  });
});

describe('original synthesized SFX set', () => {
  it('renders every sound deterministically with the recipe shape', async () => {
    for (const id of SFX_IDS) {
      const again = renderSfx(id, RATE, DEFAULT_VOICING);
      const shape = sfxShape(id);
      const channels = full.get(id)!;
      expect(channels).toHaveLength(shape.channels);
      expect(channels[0]!.length).toBe(Math.round(shape.seconds * RATE));
      expect(await pcmHash(again)).toBe(await pcmHash(channels));
    }
  });
  it('matches the committed 48 kHz receipt hashes (re-run scripts/render-sfx.mjs --receipt after review)', async () => {
    const sounds = receipt.sounds as Record<string, { sha256: string }>;
    expect(receipt.sampleRate).toBe(RATE);
    for (const id of SFX_IDS) {
      expect(sounds[id]?.sha256, id).toBe(await pcmHash(full.get(id)!));
      expect(sounds[`${id}.calm`]?.sha256, `${id}.calm`).toBe(await pcmHash(calm.get(id)!));
    }
  });
  it('normalizes each render to its registered loudness under the peak ceiling, without DC or edge clicks', () => {
    for (const id of SFX_IDS)
      for (const [voicing, channels] of [
        [false, full.get(id)!],
        [true, calm.get(id)!],
      ] as const) {
        expect(momentaryLufs(channels, RATE), id).toBeCloseTo(sfxLoudness(id, voicing), 1);
        expect(peakDb(channels), id).toBeLessThan(SFX_PEAK_CEILING_DBFS);
        const { dc } = dcAndMaxStep(channels);
        expect(Math.abs(dc), id).toBeLessThan(2e-3);
        for (const channel of channels) {
          expect(channel.every(Number.isFinite), id).toBe(true);
          expect(Math.abs(channel[0]!), id).toBeLessThan(1e-3);
          expect(Math.abs(channel[channel.length - 1]!), id).toBeLessThan(1e-3);
        }
      }
  });
  it('keeps any single cue plus swing dynamics under the bus limiter threshold', () => {
    expect(SFX_PEAK_CEILING_DBFS + SFX_DYNAMICS_DB.max).toBeLessThanOrEqual(SFX_LIMITER.thresholdDb - 1);
    expect(SFX_LIMITER.kneeDb).toBe(0); // limiterMakeupDb assumes a hard knee
  });
  it('balances momentary loudness by role (measured BS.1770, LUFS)', () => {
    for (const id of ['slash', 'smash', 'zap', 'badcut', 'wallHit'] as const) {
      expect(m(id).momentaryLufs, id).toBeGreaterThan(-27);
      expect(m(id).momentaryLufs, id).toBeLessThan(-19);
    }
    // The beam's zap and target collapse sound together; the collapse sits under the zap.
    expect(m('poof').momentaryLufs).toBeLessThan(m('zap').momentaryLufs);
    // Judgement layers decorate the gesture sound rather than covering it.
    expect(m('sparkle').momentaryLufs).toBeLessThan(m('slash').momentaryLufs - 1.5);
    expect(m('glint').momentaryLufs).toBeLessThan(m('sparkle').momentaryLufs);
    // Failure feedback must not punish.
    for (const id of ['miss', 'comboBreak'] as const) expect(m(id).momentaryLufs, id).toBeLessThan(-32);
    for (const id of ['combo', 'milestone'] as const) {
      expect(m(id).momentaryLufs, id).toBeGreaterThan(-24);
      expect(m(id).momentaryLufs, id).toBeLessThan(-17);
    }
    for (const id of ['resultsHigh', 'resultsLow'] as const) {
      expect(m(id).momentaryLufs, id).toBeGreaterThan(-21);
      expect(m(id).momentaryLufs, id).toBeLessThan(-14);
    }
    for (const id of ['uiHover', 'uiConfirm', 'uiBack', 'uiSelect', 'uiArm'] as const) {
      expect(m(id).momentaryLufs, id).toBeGreaterThan(-46);
      expect(m(id).momentaryLufs, id).toBeLessThan(-28);
    }
    expect(m('uiHover').momentaryLufs).toBeLessThan(-38);
  });
  it('gives each gesture a distinct spectral identity (bright slash, low smash, electric beam)', () => {
    expect(m('slash').centroidHz).toBeGreaterThan(3500);
    expect(m('zap').centroidHz).toBeGreaterThan(1200);
    expect(m('zap').centroidHz).toBeLessThan(4000);
    expect(m('smash').centroidHz).toBeLessThan(800);
    expect(m('slash').centroidHz).toBeGreaterThan(m('zap').centroidHz * 1.5);
    expect(m('zap').centroidHz).toBeGreaterThan(m('smash').centroidHz * 3);
    expect(m('wallHit').centroidHz).toBeLessThan(m('badcut').centroidHz);
  });
  it('renders a calmer set: quieter and no brighter for every sound', () => {
    expect(SFX_CALM_LOUDNESS_DB).toBeLessThanOrEqual(-2);
    for (const id of SFX_IDS) {
      expect(m(`${id}.calm`).momentaryLufs, id).toBeLessThan(m(id).momentaryLufs - 2);
      expect(m(`${id}.calm`).centroidHz, id).toBeLessThan(m(id).centroidHz * 1.05 + 1);
    }
  });
  it('is consistent across device sample rates', () => {
    for (const id of ['slash', 'smash', 'zap', 'sparkle', 'uiConfirm'] as const) {
      const other = measureSfx(renderSfx(id, 44100, DEFAULT_VOICING), 44100);
      expect(other.peakDb, id).toBeLessThan(SFX_PEAK_CEILING_DBFS);
      expect(Math.abs(other.momentaryLufs - m(id).momentaryLufs), id).toBeLessThan(0.1);
      expect(Math.abs(other.centroidHz / m(id).centroidHz - 1), id).toBeLessThan(0.12);
    }
  });
  it('transposes tonal cues with the root while keeping non-tonal cues and noise identical', async () => {
    const fifth = { ...DEFAULT_VOICING, rootHz: SFX_DEFAULT_ROOT_HZ * 1.5 };
    const shifted = spectralCentroidHz(renderSfx('glint', RATE, fifth), RATE);
    expect(shifted / m('glint').centroidHz).toBeGreaterThan(1.35);
    expect(shifted / m('glint').centroidHz).toBeLessThan(1.65);
    expect(await pcmHash(renderSfx('slash', RATE, fifth))).toBe(await pcmHash(full.get('slash')!));
    expect(sfxKey('slash', fifth)).toBe(sfxKey('slash', DEFAULT_VOICING));
    expect(sfxKey('sparkle', fifth)).not.toBe(sfxKey('sparkle', DEFAULT_VOICING));
    for (const id of ['resultsHigh', 'resultsLow', 'count', 'countGo', 'uiEnable'] as const)
      expect(SFX_TONAL.has(id), id).toBe(false);
    expect(foldRoot(SFX_DEFAULT_ROOT_HZ * 4.2)).toBeGreaterThanOrEqual(SFX_DEFAULT_ROOT_HZ);
    expect(foldRoot(SFX_DEFAULT_ROOT_HZ * 4.2)).toBeLessThan(SFX_DEFAULT_ROOT_HZ * 2);
    expect(foldRoot(Number.NaN)).toBe(SFX_DEFAULT_ROOT_HZ);
  });
  it('times the wall swell peak and the charge ready-ping to their gameplay moments', () => {
    const envelopePeak = (channels: Float32Array[], windowS: number): number => {
      const channel = channels[0]!,
        window = Math.round(windowS * RATE);
      let best = 0,
        at = 0;
      for (let start = 0; start + window <= channel.length; start += window / 4) {
        let sum = 0;
        for (let index = start; index < start + window; index++) sum += channel[index]! ** 2;
        if (sum > best) {
          best = sum;
          at = start + window / 2;
        }
      }
      return at / RATE;
    };
    expect(Math.abs(envelopePeak(full.get('wallWarn')!, 0.02) - SFX_WALL_WARN_LEAD_S)).toBeLessThan(0.03);
    // The ping is the brightest moment of the charge riser: measure where the high band peaks.
    const charge = full.get('charge')![0]!;
    const ping = new Float32Array(charge.length);
    for (let index = 1; index < charge.length; index++) ping[index] = charge[index]! - charge[index - 1]!;
    expect(Math.abs(envelopePeak([ping], 0.01) - BEAM_CHARGE_MS / 1000)).toBeLessThan(0.03);
  });
  it('rejects unknown sounds and unusable sample rates', () => {
    expect(() => renderSfx('nope' as SfxId, RATE)).toThrow('Unknown sound');
    expect(() => renderSfx('slash', 4000)).toThrow('sample rate');
  });
});

describe('tonal-centre estimate (cosmetic tuning only)', () => {
  const source = (frequencies: number[], sampleRate = 22050, seconds = 6) => {
    const data = new Float32Array(sampleRate * seconds);
    for (const f of frequencies)
      for (let index = 0; index < data.length; index++)
        data[index]! += 0.2 * Math.sin((2 * Math.PI * f * index) / sampleRate);
    return { length: data.length, sampleRate, numberOfChannels: 1, getChannelData: () => data };
  };
  it('identifies plain major and minor tonal material', () => {
    expect(estimateTonalCenter(source([110, 220, 261.63, 329.63, 440]))).toMatchObject({
      pitchClass: 9,
      mode: 'minor',
    });
    expect(estimateTonalCenter(source([130.81, 261.63, 329.63, 392, 523.25]))).toMatchObject({
      pitchClass: 0,
      mode: 'major',
    });
  });
  it('returns null for silence, short or malformed input instead of inventing a key', () => {
    expect(estimateTonalCenter(source([]))).toBeNull();
    expect(
      estimateTonalCenter({
        length: 100,
        sampleRate: 22050,
        numberOfChannels: 1,
        getChannelData: () => new Float32Array(100),
      }),
    ).toBeNull();
    expect(
      estimateTonalCenter({ length: 110250, sampleRate: 22050 } as unknown as Parameters<
        typeof estimateTonalCenter
      >[0]),
    ).toBeNull();
  });
  it('folds a pitch class into the requested octave', () => {
    expect(pitchClassHz(9, 523.25)).toBeCloseTo(880, 3);
    expect(pitchClassHz(0, 523.25)).toBeCloseTo(523.25, 2);
    expect(pitchClassHz(4, 523.25)).toBeCloseTo(659.26, 1);
  });
});
