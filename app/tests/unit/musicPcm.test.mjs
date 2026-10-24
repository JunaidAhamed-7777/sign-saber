import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { readITunSmpb } from '../../../scripts/music-pcm.mjs';
describe('canonical source sample zero', () => {
  it.each([
    ['pamgaea', 528, 2009, 7431319],
    ['electro-cabello', 528, 1887, 8412945],
    ['cipher', 528, 2208, 10195920],
  ])(
    'reads exact encoded iTunes gapless counts from %s without changing original bytes',
    (slug, start, end, count) => {
      const bytes = readFileSync(
        new URL('../../public/assets/tracks/' + slug + '/audio.mp3', import.meta.url),
      );
      expect(readITunSmpb(bytes)).toEqual({
        encoderDelaySamples: start,
        endPaddingSamples: end,
        originalSampleCount: count,
      });
    },
  );
  it('does not invent trim metadata for an ordinary absent/invalid ID3 record', () => {
    expect(readITunSmpb(Buffer.from('no ID3 header'))).toBeNull();
    const unsupported = Buffer.from([73, 68, 51, 8, 0, 0, 0, 0, 0, 0]);
    expect(() => readITunSmpb(unsupported)).toThrow('Unsupported ID3');
  });
});
