import { describe, expect, it } from 'vitest';
import fixture from '../public/assets/fixtures/coco-upper-body-trial.json';
import { DatasetTrial, validateDatasetTrial, datasetPose } from '../src/tracking/datasetTrial';
import { InputPipeline } from '../src/tracking/pipeline';
import { DATASET_TRIAL_HOLD_MS } from '../src/core/constants';
describe('real static annotation trial, explicitly not recorded motion', () => {
  it('validates actual licensed metadata and keeps fingers, lower limbs and depth absent', () => {
    const data = validateDatasetTrial(fixture);
    expect(data.samples).toHaveLength(8);
    expect(fixture.temporalRecording).toBe(false);
    const pose = datasetPose(data.samples[0]!);
    expect(Array.from(pose.landmarks.slice(25 * 4))).toEqual(new Array(32).fill(0));
    expect(pose.worldLandmarks.every((value) => value === 0)).toBe(true);
    expect(pose.landmarks[0]).toBeGreaterThan(0);
    expect(pose.landmarks[0]).toBeLessThan(1);
    expect(() => validateDatasetTrial({ ...fixture, temporalRecording: true })).toThrow();
  });
  it('passes annotated upper bodies through the same pipeline without granting camera calibration', () => {
    const source = new DatasetTrial(validateDatasetTrial(fixture), 1000);
    const pipeline = new InputPipeline();
    let accepted = 0;
    source.advance(
      1200,
      (t) => t - 1000,
      (frame, arrival) => {
        const result = pipeline.process(frame, arrival, 'replay');
        expect(result).not.toBeNull();
        expect(result!.hands.every((hand) => !hand.present)).toBe(true);
        expect(frame.hands).toHaveLength(0);
        expect(frame.mask).toBeNull();
        accepted++;
      },
    );
    expect(accepted).toBeGreaterThan(0);
    expect(pipeline.calibrate('not-a-camera')).toBeNull();
  });
  it('delivers identical ordered captures across render schedules and a stall', () => {
    const run = (hz: number, stall = false) => {
      const source = new DatasetTrial(validateDatasetTrial(fixture), 0);
      const log: number[][] = [];
      for (let now = 0; now < 2000; now += 1000 / hz) {
        if (stall && now > 500 && now < 950) continue;
        source.advance(
          now,
          (t) => t,
          (frame) => log.push([frame.seq, frame.tCapture]),
        );
      }
      source.advance(
        2000,
        (t) => t,
        (frame) => log.push([frame.seq, frame.tCapture]),
      );
      return log;
    };
    expect(run(30)).toEqual(run(60));
    expect(run(30)).toEqual(run(120));
    expect(run(30)).toEqual(run(60, true));
  });
  it('does not interpolate unrelated photo subjects or accumulate pause backlog', () => {
    const source = new DatasetTrial(validateDatasetTrial(fixture), 0);
    const changes: number[] = [];
    for(let now=0;now<=DATASET_TRIAL_HOLD_MS+20;now+=20)source.advance(
      now,
      (t) => t,
      (_frame, _arrival, changed) => {
        if (changed) changes.push(source.sampleIndex);
      },
    );
    expect(changes).toEqual([1]);
    source.rebase(60000);
    let count = 0;
    source.advance(
      60000,
      () => DATASET_TRIAL_HOLD_MS,
      () => count++,
    );
    expect(count).toBe(1);
  });
  it('rejects long catch-up before delivering an unbounded backlog',()=>{const source=new DatasetTrial(validateDatasetTrial(fixture),0);let callbacks=0;expect(()=>source.advance(60000,t=>t,()=>callbacks++)).toThrow(/stalled/);expect(callbacks).toBe(0);});
});
