import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { applyGaplessTrim, mp3SampleRate, readITunSmpb } from '../../src/audio/gapless';
import { readITunSmpb as canonicalTrim } from '../../../scripts/music-pcm.mjs';

const SLUGS = ['pamgaea', 'electro-cabello', 'cipher'];
const bytesOf = (slug) =>
  new Uint8Array(readFileSync(new URL('../../public/assets/tracks/' + slug + '/audio.mp3', import.meta.url)));

/** Minimal AudioBuffer stand-in whose samples equal their index, so trims are observable. */
function fakeBuffer(length, sampleRate, channels = 2) {
  const data = Array.from({ length: channels }, (_, c) => {
    const samples = new Float32Array(length);
    for (let i = 0; i < length; i++) samples[i] = i + c * 0.5;
    return samples;
  });
  return {
    length,
    sampleRate,
    numberOfChannels: channels,
    duration: length / sampleRate,
    getChannelData: (channel) => data[channel],
    copyToChannel: (source, channel) => data[channel].set(source),
  };
}
const create = (channels, length, rate) => fakeBuffer(length, rate, channels);

describe('browser gapless normalization', () => {
  it.each(SLUGS)('matches the canonical build-time iTunSMPB parse for %s', (slug) => {
    const bytes = bytesOf(slug);
    expect(readITunSmpb(bytes)).toEqual(canonicalTrim(Buffer.from(bytes)));
    expect(mp3SampleRate(bytes)).toBe(44100);
  });
  it('trims an untrimmed decode to exactly the original samples', () => {
    const bytes = bytesOf('pamgaea');
    const trim = readITunSmpb(bytes);
    const untrimmed = trim.originalSampleCount + trim.encoderDelaySamples + trim.endPaddingSamples;
    const result = applyGaplessTrim(fakeBuffer(untrimmed, 44100), bytes, create);
    expect(result.length).toBe(trim.originalSampleCount);
    expect(result.getChannelData(0)[0]).toBe(trim.encoderDelaySamples);
    expect(result.getChannelData(1)[0]).toBe(trim.encoderDelaySamples + 0.5);
  });
  it('trims proportionally when the decoder resampled to another rate', () => {
    const bytes = bytesOf('pamgaea');
    const trim = readITunSmpb(bytes);
    // The embedded Chromium decoder produced exactly this untrimmed length at 22050 Hz.
    const result = applyGaplessTrim(fakeBuffer(3716928, 22050, 1), bytes, create);
    expect(result.length).toBe(Math.round(trim.originalSampleCount / 2));
    expect(result.getChannelData(0)[0]).toBe(Math.round(trim.encoderDelaySamples / 2));
  });
  it('never trims a buffer the decoder already trimmed, or one of unexplained length', () => {
    const bytes = bytesOf('cipher');
    const trim = readITunSmpb(bytes);
    const trimmed = fakeBuffer(trim.originalSampleCount, 44100);
    expect(applyGaplessTrim(trimmed, bytes, create)).toBe(trimmed);
    const odd = fakeBuffer(trim.originalSampleCount + 1000, 44100);
    expect(applyGaplessTrim(odd, bytes, create)).toBe(odd);
  });
  it('ignores files without iTunSMPB metadata', () => {
    const plain = new Uint8Array(Buffer.from('RIFF....WAVEfmt ', 'latin1'));
    const buffer = fakeBuffer(100, 44100);
    expect(readITunSmpb(plain)).toBeNull();
    expect(applyGaplessTrim(buffer, plain, create)).toBe(buffer);
  });
});
