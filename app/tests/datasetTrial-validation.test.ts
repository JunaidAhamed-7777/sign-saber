/** Static annotation input boundaries. These are not webcam or gesture evidence. */
import { describe, expect, it, vi } from 'vitest';
import fixture from '../public/assets/fixtures/coco-upper-body-trial.json';
import { DatasetTrial, validateDatasetTrial } from '../src/tracking/datasetTrial';
import { InputPipeline } from '../src/tracking/pipeline';

const first = fixture.samples[0]!;
const single = (sample: unknown) => ({ ...fixture, samples: [sample] });
const changedNose = (patch: Record<string, unknown>) =>
  single({
    ...first,
    keypoints: first.keypoints.map((point) => (point.name === 'nose' ? { ...point, ...patch } : point)),
  });

describe('dataset trial validation boundaries', () => {
  it.each(fixture.samples)('retains a usable labelled upper body for $sampleId', (sample) => {
    const source = new DatasetTrial(validateDatasetTrial(single(sample)), 0);
    const pipeline = new InputPipeline();
    source.advance(
      0,
      () => 0,
      (frame, arrival) => {
        const result = pipeline.process(frame, arrival, 'replay')!;
        expect(result.body.present).toBe(true);
        expect(result.body.lean).toBe('center');
        expect(result.body.torsoSpeed).toBe(0);
        expect(result.calibrationReady).toBe(false);
        expect(frame.pose!.landmarks.every((value) => Number.isFinite(value))).toBe(true);
        expect(frame.hands).toHaveLength(0);
        expect(frame.mask).toBeNull();
      },
    );
  });

  it('rejects empty and duplicate sample identities', () => {
    expect(() => validateDatasetTrial(single({ ...first, sampleId: '' }))).toThrow();
    expect(() => validateDatasetTrial({ ...fixture, samples: [first, first] })).toThrow();
  });

  it.each(['__proto__', 'constructor', 'toString'])('rejects inherited joint name %s', (name) => {
    const sample = {
      ...first,
      keypoints: first.keypoints.map((point) => (point.name === 'left_eye' ? { ...point, name } : point)),
    };
    expect(() => validateDatasetTrial(single(sample))).toThrow();
  });

  it.each(['2', true, false, null, -1, 3, Number.NaN])(
    'requires a numeric COCO visibility label: %s',
    (visibility) => {
      expect(() => validateDatasetTrial(changedNose({ visibility }))).toThrow();
    },
  );

  it.each([
    { x: -1 },
    { x: first.width + 1 },
    { y: -1 },
    { y: first.height + 1 },
    { x: Number.MAX_VALUE },
    { y: Number.POSITIVE_INFINITY },
  ])('rejects labelled joints outside their source image: %o', (coordinates) => {
    expect(() => validateDatasetTrial(changedNose({ ...coordinates, visibility: 2 }))).toThrow();
  });

  it('rejects duplicate topology and zero-area visible crops', () => {
    expect(() =>
      validateDatasetTrial(single({ ...first, keypoints: first.keypoints.map(() => first.keypoints[0]!) })),
    ).toThrow();
    expect(() =>
      validateDatasetTrial(
        single({
          ...first,
          keypoints: first.keypoints.map((point) => ({ ...point, x: 1, y: 1, visibility: 2 })),
        }),
      ),
    ).toThrow();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_VALUE])(
    'rejects unusable constructor and rebase timestamps: %s',
    (time) => {
      const data = validateDatasetTrial(fixture);
      expect(() => new DatasetTrial(data, time)).toThrow();
      const source = new DatasetTrial(data, 0);
      expect(() => source.rebase(time)).toThrow();
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.MAX_VALUE])(
    'rejects unusable advance timestamps before invoking consumers: %s',
    (time) => {
      const source = new DatasetTrial(validateDatasetTrial(fixture), 0);
      // A sentinel prevents a faulty unbounded loop from hanging the test runner.
      const songAt = vi.fn(() => {
        throw new Error('UNVALIDATED_INPUT');
      });
      const consume = vi.fn();
      expect(() => source.advance(time, songAt, consume)).toThrow(/timestamp|time|clock|finite/i);
      expect(songAt).not.toHaveBeenCalled();
      expect(consume).not.toHaveBeenCalled();
    },
  );

  it('copies the callback-scoped upper-body pose before its source buffer can be reused', () => {
    const source = new DatasetTrial(validateDatasetTrial(fixture), 0);
    const pipeline = new InputPipeline();
    source.advance(
      0,
      () => 0,
      (frame, arrival) => {
        const result = pipeline.process(frame, arrival, 'replay')!;
        const pose = result.pose!;
        const expected = pose.landmarks[0];
        expect(pose.landmarks).not.toBe(frame.pose!.landmarks);
        frame.pose!.landmarks[0] = 0;
        expect(pose.landmarks[0]).toBe(expected);
        expect(Array.from(pose.landmarks.slice(25 * 4))).toEqual(new Array(32).fill(0));
        expect(pose.worldLandmarks.every((value) => value === 0)).toBe(true);
        expect(result.hands.every((hand) => !hand.present)).toBe(true);
        expect(pipeline.calibrate('dataset-is-not-a-camera')).toBeNull();
      },
    );
  });
});
