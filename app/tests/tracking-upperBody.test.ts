import { describe, expect, it } from 'vitest';
import { copyUpperBodyPose, maskUpperBody, upperBodyHipLine } from '../src/tracking/upperBody';
import { mirrorLandmarks } from '../src/tracking/protocol';
import { InputPipeline } from '../src/tracking/pipeline';
import {
  createAllowlistedReplay,
  parseTrackingFixture,
  ReplaySource,
  TrackingRecorder,
} from '../src/tracking/replay';
import { syntheticFrame, syntheticPose } from './tracking-fixtures';
import { UPPER_BODY_LAST_LANDMARK } from '../src/core/constants';
function legPose() {
  const pose = syntheticPose();
  for (let i = 25; i < 33; i++) {
    for (let a = 0; a < 4; a++) pose.landmarks[i * 4 + a] = 0.9;
    for (let a = 0; a < 3; a++) pose.worldLandmarks[i * 3 + a] = 9;
  }
  return pose;
}
function assertNoLegs(pose: { landmarks: ArrayLike<number>; worldLandmarks: ArrayLike<number> }) {
  expect(pose.landmarks.length).toBe(132);
  expect(pose.worldLandmarks.length).toBe(99);
  for (let i = 25 * 4; i < 132; i++) expect(pose.landmarks[i]).toBe(0);
  for (let i = 25 * 3; i < 99; i++) expect(pose.worldLandmarks[i]).toBe(0);
}
describe('upper-body retention boundary (synthetic only)', () => {
  it('keeps normative buffer sizes but never packs lower-limb coordinates or confidence', () => {
    const source = legPose();
    const target = { landmarks: new Float32Array(132), worldLandmarks: new Float32Array(99) };
    copyUpperBodyPose(source, target);
    assertNoLegs(target);
    expect(target.landmarks[23 * 4]).toBe(source.landmarks[23 * 4]);
    expect(source.landmarks[25 * 4]).not.toBe(0);
    copyUpperBodyPose(source, source);
    assertNoLegs(source);
    const raw = Array.from({ length: 33 }, (_, i) => ({ x: i / 33, y: 0.4, z: 0.2, visibility: 1 }));
    const packed = new Float32Array(132);
    mirrorLandmarks(raw, packed, 4, false, UPPER_BODY_LAST_LANDMARK + 1);
    expect(packed[24 * 4 + 3]).toBe(1);
    expect([...packed.slice(25 * 4)]).toEqual(new Array(32).fill(0));
  });
  it('sanitizes live/replay consumers without mutating the producer sample', () => {
    const source = syntheticFrame(1, 10, undefined, legPose());
    const pipeline = new InputPipeline();
    const result = pipeline.process(source, 40);
    expect(result).not.toBeNull();
    assertNoLegs(result!.pose!);
    expect(source.pose!.landmarks[25 * 4]).not.toBe(0);
    const unused = syntheticFrame(2, 40, undefined, legPose());
    unused.pose!.landmarks[25 * 4] = NaN;
    unused.pose!.worldLandmarks[25 * 3] = Infinity;
    expect(pipeline.process(unused, 60)).not.toBeNull();
    assertNoLegs(pipeline.result.pose!);
  });
  it('clips mask confidence at the hip line with a soft edge entirely above it', () => {
    const pose = syntheticPose();
    pose.landmarks[23 * 4 + 1] = pose.landmarks[24 * 4 + 1] = 0.6;
    const mask = { width: 4, height: 100, data: new Uint8Array(400).fill(255) };
    expect(maskUpperBody(mask, pose.landmarks)).toBe(true);
    expect(mask.data[50 * 4]).toBe(255);
    expect(mask.data[58 * 4]).toBeGreaterThan(0);
    expect(mask.data[58 * 4]).toBeLessThan(255);
    for (let y = 60; y < 100; y++) for (let x = 0; x < 4; x++) expect(mask.data[y * 4 + x]).toBe(0);
  });
  it('follows a tilted hip line and never uses an unrestricted mask when hips disappear', () => {
    const pose = syntheticPose();
    pose.landmarks[23 * 4] = 0.25;
    pose.landmarks[24 * 4] = 0.75;
    pose.landmarks[23 * 4 + 1] = 0.5;
    pose.landmarks[24 * 4 + 1] = 0.7;
    const mask = { width: 4, height: 100, data: new Uint8Array(400).fill(255) };
    expect(maskUpperBody(mask, pose.landmarks)).toBe(true);
    expect(mask.data[55 * 4]).toBe(0);
    expect(mask.data[55 * 4 + 3]).toBe(255);
    pose.landmarks[23 * 4 + 3] = 0;
    expect(upperBodyHipLine(pose.landmarks)).toBeNull();
    mask.data.fill(255);
    expect(maskUpperBody(mask, pose.landmarks)).toBe(false);
    expect(mask.data.every((value) => value === 0)).toBe(true);
    const pipeline = new InputPipeline();
    const result = pipeline.process(syntheticFrame(1, 0, undefined, pose), 20);
    // Hips are optional for body tracking (close/desk play); the mask still never falls back unrestricted.
    expect(result!.body.present).toBe(true);
    expect(result!.calibrationReady).toBe(false);
  });
  it('removes leg data from fixture parsing, replay delivery and explicit recorder export', () => {
    const fixture = createAllowlistedReplay('synthetic-open', 0, true)!.fixture;
    const pose = legPose();
    fixture.frames[0]!.pose = {
      landmarks: Array.from(pose.landmarks),
      worldLandmarks: Array.from(pose.worldLandmarks),
    };
    const parsed = parseTrackingFixture(fixture);
    assertNoLegs(parsed.frames[0]!.pose!);
    const replay = new ReplaySource(fixture, 1000);
    let checked = false;
    replay.advance(1020, (frame) => {
      assertNoLegs(frame.pose!);
      checked = true;
    });
    expect(checked).toBe(true);
    const recorder = new TrackingRecorder(true);
    recorder.start(
      {
        optIn: true,
        consented: true,
        camera: { width: 1280, height: 720, fps: 30 },
        timestampSource: 'capture',
      },
      0,
    );
    expect(recorder.record(syntheticFrame(0, 0, undefined, pose), 30)).toBe(true);
    assertNoLegs(recorder.finish().frames[0]!.pose!);
  });
});
