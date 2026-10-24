/** Byte-level packaged-fixture checks; no camera or temporal motion is simulated. */
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DATASET_TRIAL_SHA256, DATASET_TRIAL_URL } from '../src/core/constants';
import { DatasetTrial } from '../src/tracking/datasetTrial';

const bytes = readFileSync(
  new globalThis.URL('../public/assets/fixtures/coco-upper-body-trial.json', import.meta.url),
);
const hash = (value) => createHash('sha256').update(value).digest('hex');
afterEach(() => vi.unstubAllGlobals());

describe('packaged dataset annotation integrity', () => {
  it('pins the exact LF bytes that Git and the prepared server distribute', () => {
    expect(bytes.includes(13)).toBe(false);
    expect(hash(bytes)).toBe(DATASET_TRIAL_SHA256);
  });

  it('loads the actual packaged bytes through the production integrity boundary', async () => {
    const fetch = vi.fn(async () => new globalThis.Response(bytes, { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const source = await DatasetTrial.load(0);
    expect(fetch).toHaveBeenCalledWith(DATASET_TRIAL_URL);
    expect(source.fixture.temporalRecording).toBe(false);
    expect(source.fixture.samples).toHaveLength(8);
  });

  it.each([
    ['CRLF conversion', Buffer.from(bytes.toString('utf8').replace(/\n/g, '\r\n'))],
    ['extra valid JSON whitespace', Buffer.concat([bytes, Buffer.from('\n')])],
  ])('rejects changed bytes after %s', async (_label, changed) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new globalThis.Response(changed, { status: 200 })),
    );
    await expect(DatasetTrial.load(0)).rejects.toThrow('Dataset trial integrity check failed.');
  });
});
