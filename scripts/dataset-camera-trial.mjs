#!/usr/bin/env node
/**
 * Dataset-camera trials: drive the real Sign Saber UI with attributed COCO photos as camera input.
 *
 * Lanes (each in a fresh isolated Chrome profile against the prepared production build):
 *   in-app       ?camera=dataset — the app's labelled canvas MediaStream ("Dataset camera — not a webcam"),
 *                photo reel synchronized to heard song time; per-photo MediaPipe-vs-annotation evaluation.
 *   sweep        ?camera=dataset&reel=sweep — setup preview only, every photo cycled by stream time.
 *   performer    ?camera=dataset&reel=performer — the skinned avatar rendered (natural material) on the song
 *                clock from the chart choreography; lane dataset-camera-synthetic-performer (synthetic).
 *   fake-webcam  Chrome --use-file-for-fake-video-capture=<reel>.y4m: the page's own unmodified
 *                getUserMedia sees the photo reel as a webcam. No app flag; the app cannot know.
 *
 * Every lane goes through the same video element, rVFC, ImageBitmap crop, worker, MediaPipe hands+pose,
 * calibration, gestures and capture-time judgement. Still photos contain no swings: expect misses.
 * None of this is webcam, human, latency or release evidence.
 *
 * Usage (from the repository root):
 *   node scripts/prepare-dataset-camera.mjs --coco <dir>       # once; writes ignored app/public/dataset-camera
 *   node scripts/dataset-camera-trial.mjs [--lanes in-app,sweep,fake-webcam] [--headless] [--no-build]
 *        [--song pamgaea] [--date YYYY-MM-DD] [--browser <chrome>]
 * Requires Chrome (or BROWSER_BINARY), ffmpeg for the fake-webcam lane, and prepared local models.
 */
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir, cpus, totalmem, release, platform } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createStaticHandler } from "./serve.mjs";
import {
  launchChrome,
  PageSession,
  defaultBrowser,
  delay,
} from "./cdp-client.mjs";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const appDir = path.join(root, "app");
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] !== undefined
    ? args[index + 1]
    : fallback;
};
const lanes = option("lanes", "in-app,sweep,fake-webcam")
  .split(",")
  .map((lane) => lane.trim())
  .filter(Boolean);
for (const lane of lanes)
  if (!["in-app", "sweep", "fake-webcam", "performer"].includes(lane))
    throw new Error(`Unknown lane ${lane}`);
const headless = args.includes("--headless");
const song = option("song", "pamgaea");
const localDate = new Date(Date.now() - new Date().getTimezoneOffset() * 60000)
  .toISOString()
  .slice(0, 10);
const date = option("date", localDate);
const outDir = path.resolve(option("out", path.join(root, "docs", "evidence")));
const browserBinary = option("browser", defaultBrowser());
const fakeFirstHoldMs = Number(option("fake-first-hold-ms", 45000));
const holdMs = Number(option("hold-ms", 5000));
const sweepHoldMs = Number(option("sweep-hold-ms", 4000));
const [fakeWidth, fakeHeight] = option("fake-size", "640x360")
  .split("x")
  .map(Number);
const fakeFps = 30;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const tag = option("tag", "");
if (tag && !/^[a-z0-9-]{1,32}$/.test(tag))
  throw new Error("--tag must be lowercase letters, digits or dashes");
const prefix = `${date}-dataset-camera${tag ? `-${tag}` : ""}`;

/** Whole-machine CPU busy fraction between two samples (includes Chrome and every other process). */
function cpuTimes() {
  return cpus().reduce(
    (sum, cpu) => {
      const t = cpu.times;
      sum.idle += t.idle;
      sum.total += t.user + t.nice + t.sys + t.idle + t.irq;
      return sum;
    },
    { idle: 0, total: 0 },
  );
}
const cpuBusy = (a, b) =>
  b.total > a.total ? 1 - (b.idle - a.idle) / (b.total - a.total) : null;

function round(value) {
  if (Array.isArray(value)) return value.map(round);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, round(entry)]),
    );
  return typeof value === "number" && !Number.isInteger(value)
    ? Number(value.toFixed(3))
    : value;
}
function percentiles(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const q = (p) =>
    sorted.length
      ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]
      : null;
  return round({
    count: sorted.length,
    p50: q(0.5),
    p95: q(0.95),
    p99: q(0.99),
    max: q(1),
  });
}

async function buildApp() {
  const require = createRequire(path.join(appDir, "package.json"));
  const { build } = await import(pathToFileURL(require.resolve("vite")).href);
  await build({
    root: appDir,
    configFile: path.join(appDir, "vite.config.ts"),
    logLevel: "warn",
  });
}

/** Y4M for Chrome's fake capture device: calibration photo first, then each photo for `holdMs`. */
async function makeY4m(manifest, reelDir, temp) {
  const lines = [];
  manifest.items.forEach((item, index) => {
    lines.push(`file '${path.join(reelDir, item.file).replace(/\\/g, "/")}'`);
    lines.push(`duration ${(index === 0 ? fakeFirstHoldMs : holdMs) / 1000}`);
  });
  lines.push(
    `file '${path.join(reelDir, manifest.items.at(-1).file).replace(/\\/g, "/")}'`,
  );
  const list = path.join(temp, "reel.txt");
  await writeFile(list, lines.join("\n") + "\n");
  const output = path.join(temp, "dataset-camera-reel.y4m");
  await run(
    process.env.FFMPEG || "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      list,
      "-vf",
      `scale=${fakeWidth}:${fakeHeight}:flags=lanczos,fps=${fakeFps},format=yuv420p`,
      "-f",
      "yuv4mpegpipe",
      "-y",
      output,
    ],
    { maxBuffer: 1 << 20 },
  );
  const info = await stat(output);
  const schedule = [];
  let at = 0;
  manifest.items.forEach((item, index) => {
    const duration = index === 0 ? fakeFirstHoldMs : holdMs;
    schedule.push({ id: item.id, fromMs: at, toMs: at + duration });
    at += duration;
  });
  return {
    path: output,
    bytes: info.size,
    width: fakeWidth,
    height: fakeHeight,
    fps: fakeFps,
    loopMs: at,
    schedule,
  };
}

class Lane {
  constructor(name, page, browser) {
    this.name = name;
    this.page = page;
    this.browser = browser;
    this.started = Date.now();
    this.steps = [];
    this.failures = [];
    this.samples = [];
    this.screenshots = [];
  }
  log(name, data = {}) {
    const entry = { atMs: Date.now() - this.started, step: name, ...data };
    this.steps.push(entry);
    console.log(
      `[${this.name}] ${(entry.atMs / 1000).toFixed(1)}s ${name}${data.note ? ` — ${data.note}` : ""}`,
    );
  }
  fail(name, error, snapshot) {
    const message = error instanceof Error ? error.message : String(error);
    this.failures.push({
      atMs: Date.now() - this.started,
      step: name,
      message,
      snapshot: round(snapshot ?? null),
    });
    console.log(`[${this.name}] FAIL ${name}: ${message}`);
  }
  snapshot() {
    return this.page.evaluate(
      "window.__signSaberDiagnostics ? window.__signSaberDiagnostics.snapshot() : null",
    );
  }
  /** Polls the read-only snapshot; also records a bounded presence/gesture sample stream. */
  async waitFor(label, predicate, timeoutMs, pollMs = 250) {
    const end = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < end) {
      last = await this.snapshot();
      if (last) this.sample(last);
      if (last && predicate(last)) return last;
      await delay(pollMs);
    }
    const error = new Error(
      `Timed out after ${timeoutMs} ms waiting for ${label}`,
    );
    error.snapshot = last;
    throw error;
  }
  sample(s) {
    if (this.samples.length >= 20000) return;
    this.samples.push({
      atMs: Date.now() - this.started,
      state: s.state,
      songTimeMs: s.songTimeMs,
      figure: s.figureAvailable,
      tracking: s.trackingReady,
      calibrationReady: s.calibrationReady,
      left: s.hud.leftPresent ? s.hud.left : null,
      right: s.hud.rightPresent ? s.hud.right : null,
      score: s.hud.score,
      judgement: s.hud.judgement || null,
    });
  }
  async present(id) {
    return !(await this.page.targetBox(id)).missing;
  }
  /** Pages the real rail pagers until a control is on screen. */
  async reveal(id) {
    if (await this.present(id)) return;
    for (const pager of ["right", "left", "compact"]) {
      for (
        let i = 0;
        i < 25 && (await this.present(`ui:${pager}:previous`));
        i++
      ) {
        if (await this.present(id)) return;
        const box = await this.page.targetBox(`ui:${pager}:previous`);
        if (box.disabled) break;
        await this.page.click(`ui:${pager}:previous`);
        await delay(120);
      }
      for (let i = 0; i < 25 && (await this.present(`ui:${pager}:next`)); i++) {
        if (await this.present(id)) return;
        const box = await this.page.targetBox(`ui:${pager}:next`);
        if (box.disabled) break;
        await this.page.click(`ui:${pager}:next`);
        await delay(120);
      }
      if (await this.present(id)) return;
    }
    throw new Error(`Could not find UI control ${id} on any rail page`);
  }
  async click(id) {
    await this.reveal(id);
    await this.page.click(id);
    this.log(`click ${id}`);
  }
  /** Saves the dataset camera's own current frame (synthetic/dataset pixels only) for inspection. */
  async datasetFrame(step) {
    const url = await this.page.evaluate(
      "window.__signSaberDiagnostics && window.__signSaberDiagnostics.datasetFrame ? window.__signSaberDiagnostics.datasetFrame() : null",
    );
    if (!url) return;
    const file = `${prefix}-${this.name}-camera-${step}.jpg`;
    await writeFile(
      path.join(outDir, file),
      Buffer.from(url.split(",")[1], "base64"),
    );
    this.screenshots.push(file);
    this.log(`camera frame ${step}`, { file });
  }
  async screenshot(step) {
    const file = `${prefix}-${this.name}-${step}.jpg`;
    await writeFile(path.join(outDir, file), await this.page.screenshot());
    this.screenshots.push(file);
    this.log(`screenshot ${step}`, { file });
  }
  /** Exports diagnostics through the real Settings → Export diagnostics button (a browser download). */
  async exportThroughUi(downloadDir) {
    await mkdir(downloadDir, { recursive: true });
    await this.browser.send("Browser.setDownloadBehavior", {
      behavior: "allowAndName",
      downloadPath: downloadDir,
      eventsEnabled: true,
    });
    const done = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error("Diagnostics download did not complete"));
      }, 20000);
      const off = this.browser.on((message) => {
        if (
          message.method === "Browser.downloadProgress" &&
          ["completed", "canceled"].includes(message.params.state)
        ) {
          clearTimeout(timer);
          off();
          if (message.params.state === "completed")
            resolve(message.params.guid);
          else reject(new Error("Diagnostics download was cancelled"));
        }
      });
    });
    await this.click("evidence");
    const guid = await done;
    const evidence = JSON.parse(
      await readFile(path.join(downloadDir, guid), "utf8"),
    );
    this.log("diagnostics exported through UI", {
      bytes: JSON.stringify(evidence).length,
    });
    return evidence;
  }
  async hideTab(ms) {
    const { targetId } = await this.browser.send("Target.createTarget", {
      url: "about:blank",
    });
    await this.browser.send("Target.activateTarget", { targetId });
    const hidden = await this.page.evaluate("document.visibilityState");
    await delay(ms);
    await this.browser.send("Target.activateTarget", {
      targetId: this.page.targetId,
    });
    await this.browser.send("Target.closeTarget", { targetId });
    await delay(300);
    const visible = await this.page.evaluate("document.visibilityState");
    return { hiddenState: hidden, restoredState: visible };
  }
}

/**
 * Clicks a real control whenever it is enabled until `done(snapshot)` holds — like a person pressing a
 * button again after a guarded action was refused. Returns the attempt count; throws on timeout.
 */
async function clickUntil(
  lane,
  id,
  done,
  { timeoutMs = 30000, settleMs = 1500, label = id } = {},
) {
  const end = Date.now() + timeoutMs;
  let attempts = 0;
  let last = null;
  while (Date.now() < end) {
    last = await lane.snapshot();
    lane.sample(last);
    if (done(last)) return { attempts, snapshot: last };
    if (
      last.camera?.state === "error" &&
      id !== "camera" &&
      id !== "camera-dataset"
    ) {
      const error = new Error(
        `Camera error while waiting for ${label}: ${last.camera.error}`,
      );
      error.snapshot = last;
      throw error;
    }
    const box = await lane.page.targetBox(id);
    if (!box.missing && !box.disabled && box.width > 0) {
      try {
        await lane.click(id);
      } catch (error) {
        // The guard can flip between the check and the click (e.g. freshness); treat as not yet clickable.
        if (!/disabled|not on the current page|not visible/.test(error.message))
          throw error;
        await delay(150);
        continue;
      }
      attempts++;
      const settle = Date.now() + settleMs;
      while (Date.now() < settle) {
        last = await lane.snapshot();
        lane.sample(last);
        if (done(last)) return { attempts, snapshot: last };
        await delay(150);
      }
    } else await delay(150);
  }
  const error = new Error(
    `Timed out after ${timeoutMs} ms (${attempts} clicks) waiting for ${label}`,
  );
  error.snapshot = last;
  throw error;
}

/** Camera setup with up to `maxAttempts` user retries after a reported setup error. */
async function setupCamera(lane, control, maxAttempts = 3) {
  const attempts = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const start = Date.now();
    await lane.reveal(control);
    await lane.click(control);
    const preview = await lane.waitFor(
      "first tracking result",
      (s) =>
        s.camera.state === "error" ||
        (s.camera.mode === "camera-setup" &&
          s.tracking.returned > 0 &&
          /preview|Preparing/.test(s.cameraStage)),
      90000,
    );
    if (preview.camera.state !== "error") {
      attempts.push({ attempt, firstResultMs: Date.now() - start, ok: true });
      lane.log("preview", {
        note: `${preview.tracking.delegate} · ${preview.cameraStage}`,
      });
      return { attempts, preview, start };
    }
    attempts.push({
      attempt,
      ok: false,
      error: preview.camera.error,
      tracking: preview.tracking,
    });
    lane.fail(
      `camera setup attempt ${attempt}`,
      new Error(preview.camera.error),
      preview,
    );
    await delay(1000);
  }
  const error = new Error(`Camera setup failed ${maxAttempts} times`);
  error.attempts = attempts;
  throw error;
}

async function exportViaHook(lane) {
  return lane.page.evaluate("window.__signSaberDiagnostics.evidence()");
}

/** Shared full-game flow: song → sound → 80 s cut → camera setup → calibrate → play → results → retry → quit. */
async function playLane(lane, cameraControl, downloadDir) {
  const outcome = { reachedResults: false };
  await lane.waitFor("SELECT", (s) => s.state === "SELECT", 30000);
  await lane.click(`song:${song}`);
  await lane.waitFor("song map", (s) => s.mapReady && !s.loading, 60000);
  await lane.click("audio");
  await lane.waitFor("sound", (s) => s.audioReady, 10000);
  await lane.click("arrange");
  const arranged = await lane.waitFor(
    "80-second cut",
    (s) => s.arrangementReady && !s.loading,
    240000,
    500,
  );
  lane.log("arrangement ready", { note: arranged.status });

  // Setup + calibration; a setup error (e.g. first-result deadline or stall) is retried like a person would.
  outcome.setupAttempts = [];
  for (
    let round = 1;
    round <= 3 && outcome.calibration !== "accepted";
    round++
  ) {
    let setup;
    try {
      setup = await setupCamera(lane, cameraControl, 3);
    } catch (error) {
      outcome.setupAttempts.push(...(error.attempts ?? []));
      throw error;
    }
    outcome.setupAttempts.push(...setup.attempts);
    if (round === 1 && lane.name === "performer")
      await lane.datasetFrame("setup");
    outcome.setup = {
      delegate: setup.preview.tracking.delegate,
      initMs: setup.preview.tracking.initMs,
      cameraSource: setup.preview.cameraSource,
      stage: setup.preview.cameraStage,
    };
    try {
      await lane.waitFor(
        "calibration framing",
        (s) => s.calibrationReady || s.camera.state === "error",
        30000,
      );
      outcome.setup.calibrationReadyMs = Date.now() - setup.start;
      if (round === 1) await lane.screenshot("setup-preview");
      const confirmed = await clickUntil(
        lane,
        "camera-confirm",
        (s) => s.camera.calibrationValid,
        {
          timeoutMs: 30000,
          label: "calibration accepted",
          timeoutMs: 90000,
          settleMs: 300,
        },
      );
      outcome.calibration = "accepted";
      outcome.calibrationConfirmClicks = confirmed.attempts;
      lane.log("calibration accepted", {
        note: `${confirmed.attempts} click(s) · ${confirmed.snapshot.status}`,
      });
    } catch (error) {
      lane.fail(`calibration round ${round}`, error, error.snapshot);
      outcome.calibration = error.snapshot?.calibrationReady
        ? "confirm-not-accepted"
        : "framing-not-ready";
      if (round === 1) await lane.screenshot("setup-not-ready").catch(() => {});
      const s = await lane.snapshot();
      if (s.camera.mode === "camera-setup")
        await lane.click("camera-cancel").catch(() => {});
      if (
        error.snapshot?.calibrationReady === false &&
        !error.snapshot?.camera?.error
      )
        break;
    }
  }
  if (outcome.calibration !== "accepted") {
    outcome.appEvidence = await exportViaHook(lane);
    outcome.appEvidenceVia =
      "read-only diagnostics hook (calibration was not accepted)";
    return outcome;
  }

  try {
    await clickUntil(lane, "start", (s) => s.state === "CALIBRATION", {
      timeoutMs: 30000,
      label: "CALIBRATION",
    });
    const counted = await clickUntil(
      lane,
      "confirm",
      (s) => s.state === "PLAYING",
      {
        timeoutMs: 60000,
        settleMs: 7000,
        label: "count-in to PLAYING",
      },
    );
    outcome.countIn = { completed: true, confirmClicks: counted.attempts };
  } catch (error) {
    lane.fail("count-in", error, error.snapshot);
    outcome.countIn = { completed: false };
    outcome.appEvidence = await exportViaHook(lane);
    outcome.appEvidenceVia =
      "read-only diagnostics hook (count-in did not complete)";
    return outcome;
  }
  lane.log("playing");

  const pauses = [];
  let manualPauseDone = false;
  let playingShot = false;
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    const s = await lane.snapshot();
    lane.sample(s);
    if (s.state === "RESULTS" || s.state === "SELECT") break;
    if (s.state === "PLAYING" && !playingShot && s.songTimeMs > 12000) {
      playingShot = true;
      await lane.screenshot("playing");
      if (lane.name === "performer") await lane.datasetFrame("playing");
    }
    if (s.state === "PLAYING" && !manualPauseDone && s.songTimeMs > 25000) {
      manualPauseDone = true;
      await lane.page.key("Escape", "Escape", 27);
      lane.log("key Escape");
      const paused = await lane.waitFor(
        "manual pause",
        (x) => x.state === "PAUSED",
        5000,
      );
      const entry = {
        reason: paused.pauseReason,
        songTimeMs: paused.songTimeMs,
        manual: true,
      };
      pauses.push(entry);
      await lane.screenshot("paused");
      await delay(1500);
      try {
        const resumed = await clickUntil(
          lane,
          "resume",
          (x) => x.state === "PLAYING",
          {
            timeoutMs: 45000,
            settleMs: 4500,
            label: "resume to PLAYING",
          },
        );
        entry.resumed = true;
        entry.resumeClicks = resumed.attempts;
        lane.log("resumed", { note: `${resumed.attempts} click(s)` });
      } catch (error) {
        entry.resumed = false;
        entry.status = error.snapshot?.status;
        lane.fail("resume", error, error.snapshot);
        await lane.click("songs").catch(() => {});
        outcome.quitAfterRefusedResume = true;
        break;
      }
      continue;
    }
    if (s.state === "PAUSED") {
      const open = pauses.find((p) => !p.manual && p.open);
      if (!open) {
        const entry = {
          reason: s.pauseReason,
          songTimeMs: s.songTimeMs,
          manual: false,
          open: true,
          status: s.status,
        };
        pauses.push(entry);
        lane.log("automatic pause", { note: `${s.pauseReason}: ${s.status}` });
        if (s.pauseReason === "fatal") {
          entry.open = false;
          await lane.screenshot("fatal-pause").catch(() => {});
          await lane.click("songs").catch(() => {});
          outcome.fatalPause = s.status || s.error;
          break;
        }
      } else if (
        open.reason !== "tracking" &&
        Date.now() - (open.triedAt ?? 0) > 6000
      ) {
        // Non-tracking pauses (hidden/audio/manual) need the player's Resume.
        open.triedAt = Date.now();
        await clickUntil(lane, "resume", (x) => x.state === "PLAYING", {
          timeoutMs: 20000,
          settleMs: 4500,
        }).catch(() => {});
      }
    }
    if (s.state === "PLAYING")
      for (const p of pauses)
        if (p.open) {
          p.open = false;
          p.autoResumed = true;
        }
    await delay(250);
  }
  outcome.pauses = pauses;
  const final = await lane.snapshot();
  if (final.state !== "RESULTS") {
    outcome.finalState = final.state;
    lane.fail("results", new Error(`Ended in ${final.state}`), final);
    outcome.appEvidence = await exportViaHook(lane);
    outcome.appEvidenceVia = "read-only diagnostics hook (results not reached)";
    return outcome;
  }
  outcome.reachedResults = true;
  outcome.results = final.results;
  lane.log("results", { note: JSON.stringify(final.results?.counts) });
  await lane.screenshot("results");
  try {
    outcome.appEvidence = await lane.exportThroughUi(downloadDir);
    outcome.appEvidenceVia = "Settings → Export diagnostics (browser download)";
  } catch (error) {
    lane.fail("UI diagnostics export", error);
    outcome.appEvidence = await exportViaHook(lane);
    outcome.appEvidenceVia =
      "read-only diagnostics hook after UI export failure";
  }

  // Retry → count-in → play briefly → pause → Songs (quit).
  try {
    await clickUntil(lane, "retry", (s) => s.state === "CALIBRATION", {
      timeoutMs: 30000,
      label: "retry",
    });
    await clickUntil(lane, "confirm", (s) => s.state === "PLAYING", {
      timeoutMs: 60000,
      settleMs: 7000,
      label: "retry count-in",
    });
    await delay(6000);
    await lane.page.key("Escape", "Escape", 27);
    await lane.waitFor("retry pause", (s) => s.state === "PAUSED", 5000);
    await lane.click("songs");
    const back = await lane.waitFor(
      "quit to SELECT",
      (s) => s.state === "SELECT",
      10000,
    );
    outcome.retry = { completed: true, scoreAtQuit: back.hud.score };
    lane.log("retry played and quit");
  } catch (error) {
    lane.fail("retry/quit", error, error.snapshot);
    outcome.retry = { completed: false };
    const s = await lane.snapshot();
    if (s.state === "CALIBRATION") await lane.click("back").catch(() => {});
    if (s.state === "PAUSED" || s.state === "RESULTS")
      await lane.click("songs").catch(() => {});
    await lane
      .waitFor("SELECT after retry failure", (x) => x.state === "SELECT", 10000)
      .catch(() => {});
  }
  // Camera off, then setup → cancel.
  try {
    const before = await lane.snapshot();
    if (before.camera.calibrationValid) await lane.click("camera-off");
    const off = await lane.waitFor(
      "camera off",
      (s) => s.camera.state !== "ready" && !s.cameraSource,
      5000,
    );
    await lane.click(cameraControl);
    await lane.waitFor(
      "setup again",
      (s) => s.camera.mode === "camera-setup",
      10000,
    );
    await delay(1500);
    await lane.click("camera-cancel");
    const cancelled = await lane.waitFor(
      "setup cancelled",
      (s) =>
        s.camera.state === "not-set-up" &&
        s.camera.mode === "browse" &&
        !s.cameraSource,
      5000,
    );
    await delay(2500);
    const later = await lane.snapshot();
    outcome.teardown = {
      cameraOff: off.camera.state,
      cancelled: cancelled.camera.state,
      trackingPhaseAfterCancel: later.tracking.phase,
      errorAfterCancel: later.error || later.camera.error || null,
    };
    lane.log("camera off and cancel", {
      note: JSON.stringify(outcome.teardown),
    });
  } catch (error) {
    lane.fail("camera off/cancel", error, error.snapshot);
  }
  return outcome;
}

/** Setup-preview only: cycle all photos by stream time and read the in-app evaluation. */
async function sweepLane(lane, count) {
  await lane.waitFor("SELECT", (s) => s.state === "SELECT", 30000);
  const segments = [];
  let setupAttempts = [];
  let hidden = null;
  let cameraErrorAfterHide = null;
  const sweepMs = 20000 + count * sweepHoldMs + 4000;
  const deadline = Date.now() + 3 * (sweepMs + 30000);
  while (Date.now() < deadline) {
    const setup = await setupCamera(lane, "camera-dataset", 3);
    setupAttempts.push(...setup.attempts);
    if (!hidden) {
      await delay(4000);
      hidden = await lane.hideTab(3000);
      const afterHidden = await lane.snapshot();
      cameraErrorAfterHide = afterHidden.camera.error;
      lane.log("tab hidden and restored", {
        note: JSON.stringify({ ...hidden, error: cameraErrorAfterHide }),
      });
    }
    const end = setup.start + sweepMs + (segments.length === 0 ? 3000 : 0);
    let failed = null;
    while (Date.now() < end) {
      const s = await lane.snapshot();
      lane.sample(s);
      if (s.camera.state === "error") {
        failed = s;
        break;
      }
      await delay(500);
    }
    const evidence = await exportViaHook(lane);
    segments.push({
      endedBy: failed
        ? `camera error: ${failed.camera.error}`
        : "sweep duration",
      appEvidence: evidence,
    });
    if (!failed) {
      await lane.click("camera-cancel").catch(() => {});
      await lane
        .waitFor(
          "cancel",
          (x) => x.camera.mode === "browse" && !x.cameraSource,
          5000,
        )
        .catch(() => {});
      break;
    }
    lane.fail("sweep segment", new Error(failed.camera.error), failed);
  }
  const final = segments.at(-1);
  return {
    setupAttempts,
    hidden,
    cameraErrorAfterHide,
    segments: segments.slice(0, -1).map((segment) => ({
      endedBy: segment.endedBy,
      evaluation: segment.appEvidence?.datasetCamera?.evaluation
        ? { ...segment.appEvidence.datasetCamera.evaluation, items: undefined }
        : null,
    })),
    finalSegmentEndedBy: final?.endedBy,
    appEvidence: final?.appEvidence,
    appEvidenceVia:
      "read-only diagnostics hook (setup preview has no Settings export)",
  };
}

function summarizeSamples(samples) {
  const playing = samples.filter((s) => s.state === "PLAYING");
  const count = (list, f) => list.filter(f).length;
  const gestures = { left: {}, right: {} };
  for (const s of playing)
    for (const side of ["left", "right"]) {
      const key = s[side] ?? "absent";
      gestures[side][key] = (gestures[side][key] ?? 0) + 1;
    }
  return {
    samples: samples.length,
    playingSamples: playing.length,
    playingFigureRate: playing.length
      ? count(playing, (s) => s.figure) / playing.length
      : null,
    playingBothHandsRate: playing.length
      ? count(playing, (s) => s.left && s.right) / playing.length
      : null,
    playingAnyHandRate: playing.length
      ? count(playing, (s) => s.left || s.right) / playing.length
      : null,
    playingHudGestures: gestures,
    judgementsSeen: [
      ...new Set(samples.map((s) => s.judgement).filter(Boolean)),
    ],
  };
}
function summarizeAppEvidence(evidence) {
  if (!evidence) return null;
  const samples = evidence.samples ?? {};
  return round({
    lane: evidence.lane,
    cameraSource: evidence.cameraSource,
    camera: evidence.camera,
    tracking: evidence.tracking,
    calibration: evidence.calibration,
    results: evidence.results,
    session: evidence.session,
    judgementTrace: evidence.judgementTrace
      ? {
          count: evidence.judgementTrace.count,
          overflow: evidence.judgementTrace.overflow,
          repeats: evidence.judgementTrace.repeats,
          sha256: evidence.judgementTrace.sha256,
          kinds: evidence.judgementTrace.events.reduce(
            (all, e) => ({ ...all, [e.kind]: (all[e.kind] ?? 0) + 1 }),
            {},
          ),
        }
      : null,
    inferenceMs: percentiles(samples.inferenceMs ?? []),
    inputAgeMs: percentiles(samples.inputAgeMs ?? []),
    frameIntervalMs: percentiles(samples.frameIntervalMs ?? []),
    frameWorkMs: percentiles(samples.frameWorkMs ?? []),
    datasetCamera: evidence.datasetCamera
      ? {
          framesPainted: evidence.datasetCamera.framesPainted,
          streamMs: evidence.datasetCamera.streamMs,
          timelineTransitions: evidence.datasetCamera.timelineTransitions,
          reel: {
            ...evidence.datasetCamera.reel,
            attribution: undefined,
            order: undefined,
          },
          evaluation: {
            ...evidence.datasetCamera.evaluation,
            items: undefined,
          },
        }
      : null,
  });
}

async function main() {
  const reelDir = path.join(appDir, "public", "dataset-camera");
  let manifestBytes;
  try {
    manifestBytes = await readFile(path.join(reelDir, "manifest.json"));
  } catch {
    throw new Error(
      "Prepare the reel first: node scripts/prepare-dataset-camera.mjs --coco <training/data/coco2017>",
    );
  }
  const manifest = JSON.parse(manifestBytes);
  await stat(
    path.join(appDir, "public", "models", "hand_landmarker.task"),
  ).catch(() => {
    throw new Error("Prepare local models first: cd app && npm run models");
  });
  if (!args.includes("--no-build")) {
    console.log("Building the production app…");
    await buildApp();
  }
  const dist = path.join(appDir, "dist");
  const distManifest = await readFile(
    path.join(dist, "dataset-camera", "manifest.json"),
  ).catch(() => null);
  if (!distManifest || sha(distManifest) !== sha(manifestBytes))
    throw new Error(
      "The build does not contain the current reel; rebuild without --no-build.",
    );
  await mkdir(outDir, { recursive: true });
  const temp = await mkdtemp(path.join(tmpdir(), "sign-saber-dataset-camera-"));
  const serve = createStaticHandler({ root: dist });
  const server = createServer(
    (request, response) => void serve(request, response),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const git = (...command) =>
    execFileSync("git", command, { cwd: root, encoding: "utf8" }).trim();
  const report = {
    schema: 1,
    scope:
      "Dataset-camera trials through the live camera path. Still COCO photos are not a webcam, a person, motion or swings; no webcam, human, latency or release claim.",
    recordedAt: new Date().toISOString(),
    gitHead: git("rev-parse", "HEAD"),
    dirtyTree: !!git("status", "--porcelain"),
    environment: {
      node: process.version,
      platform: `${platform()} ${release()}`,
      cpus: cpus()[0]?.model,
      logicalCpus: cpus().length,
      totalMemoryBytes: totalmem(),
      headless,
    },
    commands: {
      prepare:
        "node scripts/prepare-dataset-camera.mjs --coco <training/data/coco2017>",
      trial: `node scripts/dataset-camera-trial.mjs ${args.join(" ")}`.trim(),
    },
    reel: {
      manifestSha256: sha(manifestBytes),
      createdAt: manifest.createdAt,
      generator: {
        scriptSha256: manifest.generator.scriptSha256,
        seed: manifest.generator.seed,
        summary: manifest.generator.summary,
      },
      count: manifest.items.length,
      items: manifest.items.map((item) => ({
        id: item.id,
        role: item.role,
        sha256: item.sha256,
        cocoImageId: item.coco.imageId,
        license: item.license,
        flickrUrl: item.flickrUrl,
        shoulderWidthNorm: item.shoulderWidthNorm,
      })),
    },
    song,
    lanes: {},
  };
  try {
    // One profile for all lanes: the first lane runs with a cold GPU program cache, later lanes warm.
    const profile = path.join(temp, "profile");
    for (const [laneIndex, name] of lanes.entries()) {
      const extra = [`--window-size=1440,960`];
      let fake = null;
      if (name === "fake-webcam") {
        console.log("Encoding the Y4M fake-webcam reel…");
        fake = await makeY4m(manifest, reelDir, temp);
        extra.push(
          "--use-fake-device-for-media-stream",
          "--use-fake-ui-for-media-stream",
          `--use-file-for-fake-video-capture=${fake.path}`,
        );
      }
      const idleStart = cpuTimes();
      await delay(3000);
      const backgroundCpuBusy = cpuBusy(idleStart, cpuTimes());
      const laneStart = cpuTimes();
      const chrome = await launchChrome({
        binary: browserBinary,
        profile,
        args: extra,
        headless,
      });
      const version = await chrome.browser.send("Browser.getVersion");
      report.environment.browser = version.product;
      const system = await chrome.browser
        .send("SystemInfo.getInfo")
        .catch(() => null);
      report.environment.gpuDevices = system?.gpu?.devices?.map((device) => ({
        vendor: device.vendorString,
        device: device.deviceString,
        driver: device.driverVersion,
        active: device.active,
      }));
      const query =
        name === "in-app"
          ? "?camera=dataset&stats=1"
          : name === "performer"
            ? "?camera=dataset&reel=performer&tier=low&stats=1"
            : name === "sweep"
              ? `?camera=dataset&reel=sweep&reelHold=${sweepHoldMs}&stats=1`
              : "?stats=1";
      const page = await PageSession.attach(
        chrome.browser,
        `${origin}/${query}`,
      );
      const lane = new Lane(name, page, chrome.browser);
      const record = {
        harnessLane:
          name === "fake-webcam"
            ? "chrome-fake-webcam-dataset"
            : name === "performer"
              ? "dataset-camera-synthetic-performer"
              : "dataset-camera",
        url: `/${query}`,
        browserArgs: extra.map((arg) => arg.replace(temp, "<temp>")),
        gpuProgramCache:
          laneIndex === 0
            ? "cold (fresh profile)"
            : "reused profile from earlier lanes",
        backgroundCpuBusyBeforeLaunch: backgroundCpuBusy,
      };
      if (fake)
        record.fakeWebcam = { ...fake, path: "<temp>/dataset-camera-reel.y4m" };
      try {
        if (name === "sweep")
          Object.assign(record, await sweepLane(lane, manifest.items.length));
        else
          Object.assign(
            record,
            await playLane(
              lane,
              name === "fake-webcam" ? "camera" : "camera-dataset",
              path.join(temp, `downloads-${name}`),
            ),
          );
      } catch (error) {
        lane.fail("lane", error, error.snapshot);
        await lane.screenshot("failure").catch(() => {});
      }
      record.steps = lane.steps;
      record.failures = lane.failures;
      record.screenshots = lane.screenshots;
      record.uiSamples = summarizeSamples(lane.samples);
      record.console = page.console.slice(0, 200);
      if (record.appEvidence) {
        const rawFile = `${prefix}-${name}-app-evidence.json`;
        await writeFile(
          path.join(outDir, rawFile),
          JSON.stringify(round(record.appEvidence), null, 1) + "\n",
        );
        record.appEvidenceFile = rawFile;
        record.appEvidenceSummary = summarizeAppEvidence(record.appEvidence);
        delete record.appEvidence;
      }
      record.machineCpuBusyDuringLane = cpuBusy(laneStart, cpuTimes());
      report.lanes[name] = record;
      await chrome.close();
    }
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    const resolved = path.resolve(temp);
    if (
      resolved.startsWith(path.resolve(tmpdir()) + path.sep) &&
      path.basename(resolved).startsWith("sign-saber-dataset-camera-")
    )
      await rm(resolved, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 500,
      }).catch((error) =>
        console.warn(`Temp cleanup incomplete: ${error.message}`),
      );
  }
  const reportFile = path.join(outDir, `${prefix}-trial.json`);
  await writeFile(reportFile, JSON.stringify(round(report), null, 2) + "\n");
  console.log(`Wrote ${path.relative(root, reportFile)}`);
  for (const [name, lane] of Object.entries(report.lanes))
    console.log(
      `${name}: failures=${lane.failures.length} results=${lane.reachedResults ?? "n/a"} ` +
        `evaluation=${JSON.stringify(lane.appEvidenceSummary?.datasetCamera?.evaluation?.perJoint?.left_shoulder ?? null)}`,
    );
}

await main();
