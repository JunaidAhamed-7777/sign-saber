import { createHash } from "node:crypto";

export const SCENARIOS = Object.freeze([
  "upload",
  "cancel",
  "invalid",
  "cache",
  "context",
  "cycles",
  "hidden",
  "tiers",
]);
export const CYCLE_COUNT = 20;
export const RETAINED_METRICS = Object.freeze([
  "geometries",
  "textures",
  "runtimeListeners",
  "audioNodes",
  "audioContexts",
  "workers",
  "jsEventListeners",
]);

/** Original deterministic rhythm, never third-party audio or a manufactured chart. */
export function rhythmWav(seconds = 12, sampleRate = 22050, seed = 104) {
  if (
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    seconds > 300 ||
    !Number.isInteger(sampleRate) ||
    sampleRate < 8000 ||
    sampleRate > 48000
  )
    throw new RangeError("Invalid synthetic WAV duration/sample rate");
  const frames = Math.round(seconds * sampleRate);
  const data = Buffer.alloc(44 + frames * 2);
  data.write("RIFF", 0);
  data.writeUInt32LE(data.length - 8, 4);
  data.write("WAVEfmt ", 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(sampleRate, 24);
  data.writeUInt32LE(sampleRate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write("data", 36);
  data.writeUInt32LE(frames * 2, 40);
  let random = seed >>> 0;
  for (let index = 0; index < frames; index++) {
    const time = index / sampleRate;
    const beat = time % 0.5;
    const hat = time % 0.25;
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const noise = (random / 0x100000000) * 2 - 1;
    const kick =
      Math.sin(2 * Math.PI * (70 * beat + 15 * (1 - Math.exp(-beat * 30)))) *
      Math.exp(-beat * 28);
    const tone = Math.sin(2 * Math.PI * 440 * time) * Math.exp(-beat * 18);
    const sample =
      0.62 * kick + 0.18 * tone + 0.16 * noise * Math.exp(-hat * 80);
    data.writeInt16LE(
      Math.round(Math.max(-1, Math.min(1, sample)) * 32767),
      44 + index * 2,
    );
  }
  return data;
}
export const sha256 = (bytes) =>
  createHash("sha256").update(bytes).digest("hex");

/** Compare retained, warmed-up counts; cumulative created counts are intentionally excluded. */
export function retainedGrowth(baseline, samples) {
  const failures = [];
  for (const key of RETAINED_METRICS) {
    if (!Number.isInteger(baseline?.[key]) || baseline[key] < 0) {
      failures.push(`Missing/invalid baseline metric: ${key}`);
      continue;
    }
    for (let index = 0; index < samples.length; index++) {
      const value = samples[index]?.[key];
      if (!Number.isInteger(value) || value < 0)
        failures.push(`Cycle ${index + 1}: missing/invalid ${key}`);
      else if (value > baseline[key])
        failures.push(
          `Cycle ${index + 1}: ${key} grew ${baseline[key]} → ${value}`,
        );
    }
  }
  if (samples.length !== CYCLE_COUNT)
    failures.push(
      `Expected ${CYCLE_COUNT} measured cycles, received ${samples.length}`,
    );
  return failures;
}

export function reportPassed(scenarios) {
  return SCENARIOS.every((name) => {
    const item = scenarios.find((value) => value.name === name);
    return (
      item?.status === "pass" &&
      Array.isArray(item.checks) &&
      item.checks.length > 0 &&
      item.checks.every((check) => check.ok === true)
    );
  });
}
export function markdownReport(report) {
  const summary = (value) =>
    value.length > 240
      ? value.slice(0, 240) + "… (full detail in JSON)"
      : value;
  return [
    `# Lifecycle QA — ${report.date}`,
    "",
    `Source commit: \`${report.gitHead}\`. Dirty working tree: **${report.dirtyTree}**.`,
    `Recorded: ${report.recordedAt}. Browser: ${report.browser?.product ?? "unavailable"}.`,
    "",
    "Synthetic original WAVs and planned performer motion only; no camera, person, recognition, audible-sync or performance acceptance.",
    "The JSON retains exact checks, errors, resource samples, source hashes and environment. Unrun scenarios are never passes.",
    "",
    ...(report.error
      ? [`Harness failure: ${summary(report.error.replaceAll("\n", " "))}`, ""]
      : []),
    ...report.scenarios.flatMap((scenario) => [
      `## ${scenario.name}: ${scenario.status}`,
      "",
      ...(scenario.checks ?? []).map(
        (check) =>
          `- ${check.ok ? "PASS" : "FAIL"}: ${check.name}${check.detail ? ` — ${summary(check.detail)}` : ""}`,
      ),
      ...(scenario.error
        ? [`- Error: ${scenario.error.replaceAll("\n", " ")}`]
        : []),
      ...(scenario.reproduction
        ? ["", `Reproduce: ${scenario.reproduction}`]
        : []),
      "",
    ]),
    `Overall: **${!report.error && reportPassed(report.scenarios) ? "pass" : "fail / incomplete"}**.`,
    "",
  ].join("\n");
}
