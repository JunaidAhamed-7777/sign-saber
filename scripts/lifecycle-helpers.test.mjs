import test from "node:test";
import assert from "node:assert/strict";
import {
  SCENARIOS,
  CYCLE_COUNT,
  rhythmWav,
  sha256,
  retainedGrowth,
  reportPassed,
  markdownReport,
} from "./lifecycle-helpers.mjs";
import { cacheFailureScript } from "./lifecycle-probe.mjs";

test("original WAV has exact PCM geometry, bounded nonsilent samples and deterministic provenance", () => {
  const wav = rhythmWav(6, 22050, 17);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 16), "WAVEfmt ");
  assert.equal(wav.readUInt32LE(4), wav.length - 8);
  assert.equal(wav.readUInt16LE(20), 1);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 22050);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), 6 * 22050 * 2);
  let peak = 0,
    nonzero = 0;
  for (let index = 44; index < wav.length; index += 2) {
    const value = Math.abs(wav.readInt16LE(index));
    peak = Math.max(peak, value);
    if (value) nonzero++;
  }
  assert.ok(peak > 16000 && peak < 32767);
  assert.ok(nonzero > 22050);
  assert.equal(sha256(wav), sha256(rhythmWav(6, 22050, 17)));
  assert.notEqual(sha256(wav), sha256(rhythmWav(6, 22050, 18)));
});

test("invalid fixture geometry is rejected, rather than producing misleading audio", () => {
  for (const duration of [NaN, Infinity, 0, -1, 301])
    assert.throws(() => rhythmWav(duration), RangeError);
  for (const rate of [0, 7999, 48001, 22050.5])
    assert.throws(() => rhythmWav(5, rate), RangeError);
});

const baseline = {
  geometries: 17,
  textures: 8,
  runtimeListeners: 11,
  audioNodes: 5,
  audioContexts: 1,
  workers: 1,
  observers: 9,
  jsEventListeners: 120,
};
test("resource gate requires every metric and all 20 real samples; later growth is never hidden", () => {
  const samples = Array.from({ length: CYCLE_COUNT }, () => ({ ...baseline }));
  assert.deepEqual(retainedGrowth(baseline, samples), []);
  samples[17].audioNodes++;
  assert.deepEqual(retainedGrowth(baseline, samples), [
    "Cycle 18: audioNodes grew 5 → 6",
  ]);
  assert.ok(
    retainedGrowth(baseline, samples.slice(0, 19)).some((value) =>
      value.includes("Expected 20"),
    ),
  );
  const missing = { ...baseline };
  delete missing.textures;
  assert.ok(
    retainedGrowth(missing, samples).some((value) =>
      value.includes("baseline metric: textures"),
    ),
  );
  samples[0].workers = NaN;
  assert.ok(
    retainedGrowth(baseline, samples).some((value) =>
      value.includes("missing/invalid workers"),
    ),
  );
});

test("partial or failed evidence cannot become an overall pass", () => {
  const scenarios = SCENARIOS.map((name) => ({
    name,
    status: "pass",
    checks: [{ name: "actual check", ok: true }],
  }));
  assert.equal(reportPassed(scenarios), true);
  assert.match(
    markdownReport({ scenarios, error: "Browser stopped unexpectedly" }),
    /Overall: \*\*fail \/ incomplete\*\*/,
  );
  assert.equal(reportPassed(scenarios.slice(0, -1)), false);
  assert.equal(
    reportPassed(scenarios.map((value) => ({ ...value, checks: [] }))),
    false,
  );
  scenarios[3].status = "not-run";
  assert.equal(reportPassed(scenarios), false);
  const markdown = markdownReport({
    date: "2026-10-25",
    gitHead: "example-sha",
    dirtyTree: true,
    scenarios,
    recordedAt: "example-time",
  });
  assert.match(markdown, /cache: not-run/);
  assert.match(markdown, /Overall: \*\*fail \/ incomplete\*\*/);
});

test("cache fault injection uses distinct native failure paths and rejects unknown modes", () => {
  assert.match(cacheFailureScript("unavailable"), /SecurityError/);
  assert.match(cacheFailureScript("quota"), /readwrite.*QuotaExceededError/);
  assert.throws(() => cacheFailureScript("fake-success"));
  assert.doesNotThrow(() => new Function(cacheFailureScript("quota")));
  assert.doesNotThrow(() => new Function(cacheFailureScript("unavailable")));
});
