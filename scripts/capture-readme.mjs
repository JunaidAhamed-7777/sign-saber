#!/usr/bin/env node
/** Capture the real, camera-free auto-play UI for README media. Requires a running production preview
 * and Chrome. No game state, hit events, clocks or renderer effects are injected. Raw screencast
 * frames remain in a temporary directory; docs/media contains only selected deliverables/receipt.
 * Usage: node scripts/capture-readme.mjs [--url http://127.0.0.1:4186] [--song pamgaea]
 * Then: node scripts/capture-readme.mjs --render <temporary directory printed by the capture>
 * Rendering requires ffmpeg in PATH; selections below are from the documented Pamgaea run.
 */
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { execFile, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { tmpdir, cpus, platform, release } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchChrome, PageSession, delay } from "./cdp-client.mjs";

const args = process.argv.slice(2);
const option = (name, fallback) =>
  args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback;
const root = fileURLToPath(new URL("../", import.meta.url));
const out = path.join(root, "docs", "media");
const run = promisify(execFile);
async function renderMedia(directory) {
  const { frames: rawFrames } = JSON.parse(
    await readFile(path.join(directory, "timeline.json"), "utf8"),
  );
  // CDP can deliver compositor frames out of order. Preserve their capture timestamps, rather than
  // treating message arrival order as presentation time or assigning an invented constant cadence.
  const ordered = [...rawFrames].sort((a, b) => a.timestamp - b.timestamp);
  const frames = ordered.filter(
    (frame, i) => !i || frame.timestamp > ordered[i - 1].timestamp,
  );
  const receiptPath = path.join(out, "capture.json");
  const captured = JSON.parse(await readFile(receiptPath, "utf8"));
  captured.encoding = {
    ordering: "CDP metadata timestamp",
    sameTimestampFramesOmitted: rawFrames.length - frames.length,
    clockSpeed: 1,
  };
  const zero = frames[0].timestamp;
  const frameFile = (frame) => path.join(directory, "frames", frame.filename);
  const nearest = (second) =>
    frames.reduce((best, frame) =>
      Math.abs(frame.timestamp - zero - second) <
      Math.abs(best.timestamp - zero - second)
        ? frame
        : best,
    );
  captured.media = [];
  for (const [filename, second, description] of [
    [
      "slice.png",
      7.91,
      "Open-palm contact: cyan target split into two capped halves, Perfect judged.",
    ],
    [
      "smash.png",
      1.627,
      "Fist contact: magenta target shatters, Perfect judged.",
    ],
    [
      "beam.png",
      6.576,
      "Point/hold release: gold target collapses into particles, Perfect judged.",
    ],
  ]) {
    const frame = nearest(second);
    await run("ffmpeg", [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-i",
      frameFile(frame),
      "-frames:v",
      "1",
      "-compression_level",
      "9",
      path.join(out, filename),
    ]);
    captured.media.push({
      filename,
      frame: frame.filename,
      recordedSecond: frame.timestamp - zero,
      description,
      conversion:
        "Captured JPEG frame losslessly encoded as PNG; no compositing or retouching.",
    });
  }
  for (const [filename, start, end, width, height, description] of [
    [
      "hero.gif",
      50.6,
      54.6,
      720,
      450,
      "Auto-play performer leans around a wall, fires a beam and continues the combo.",
    ],
    [
      "slash.gif",
      7.5,
      10.5,
      560,
      350,
      "Open-palm slice and fist smash with real Perfect judgements.",
    ],
    [
      "beam.gif",
      23.3,
      26.3,
      560,
      350,
      "Point-and-hold charge, gold target collapse and the next smash.",
    ],
  ]) {
    const selected = frames.filter(
      (frame) =>
        frame.timestamp - zero >= start && frame.timestamp - zero < end,
    );
    const concat =
      selected
        .map((frame, i) => {
          const next = selected[i + 1]?.timestamp ?? zero + end;
          return `file '${frameFile(frame).replaceAll("\\", "/")}'\noption framerate 1000\nduration ${(next - frame.timestamp).toFixed(6)}\n`;
        })
        .join("") +
      `file '${frameFile(selected.at(-1)).replaceAll("\\", "/")}'\noption framerate 1000\n`;
    const manifest = path.join(directory, filename + ".txt");
    await writeFile(manifest, concat);
    await run(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        manifest,
        "-filter_complex",
        `[0:v]fps=8,scale=${width}:${height}:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
        "-loop",
        "0",
        path.join(out, filename),
      ],
      { maxBuffer: 4 * 1024 * 1024 },
    );
    captured.media.push({
      filename,
      startRecordedSecond: selected[0].timestamp - zero,
      endRecordedSecond: end,
      description,
      conversion: `Timestamp-preserving excerpt, resized to ${width}×${height}, 8 fps GIF with a generated 64-color palette and Bayer dithering. No interpolation, compositing or retouching.`,
    });
  }
  for (const filename of ["menu.png", "results.png"])
    captured.media.push({
      filename,
      conversion: "Native Chrome full-viewport PNG screenshot.",
    });
  for (const medium of captured.media) {
    const bytes = await readFile(path.join(out, medium.filename));
    medium.bytes = (await stat(path.join(out, medium.filename))).size;
    medium.sha256 = createHash("sha256").update(bytes).digest("hex");
  }
  captured.ffmpegVersion = (await run("ffmpeg", ["-version"])).stdout.split(
    "\n",
  )[0];
  await writeFile(receiptPath, JSON.stringify(captured, null, 2) + "\n");
  console.log(
    JSON.stringify(
      captured.media.map(({ filename, bytes }) => ({ filename, bytes })),
      null,
      2,
    ),
  );
}
if (option("render", null)) {
  await renderMedia(path.resolve(option("render", null)));
  process.exit(0);
}
const url = option("url", "http://127.0.0.1:4186");
const song = option("song", "pamgaea");
const scratch = await mkdtemp(path.join(tmpdir(), "sign-saber-readme-"));
await mkdir(out, { recursive: true });
const frameDir = path.join(scratch, "frames");
await mkdir(frameDir);
const receipt = {
  schema: 1,
  sourceSha: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  dirtyTree:
    execFileSync("git", ["status", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
    }).trim().length > 0,
  applicationDiffFromSourceSha:
    execFileSync("git", ["diff", "HEAD", "--name-only", "--", "app"], {
      cwd: root,
      encoding: "utf8",
    }).trim().length > 0,
  capturedAt: new Date().toISOString(),
  lane: "synthetic-performer-logic-replay",
  description:
    "Actual production UI. Chosen song → Enable sound → Watch auto-play. Planned synthetic landmarks pass through the game input pipeline and real judge. No webcam, recognition, injected hit or mock-up.",
  song,
  difficulty: "normal",
  url,
  viewport: { width: 1440, height: 900, dpr: 1 },
  environment: {
    os: `${platform()} ${release()}`,
    cpu: cpus()[0]?.model,
    node: process.version,
  },
  limitations: [
    "Synthetic input; no live-camera or human-play claim.",
    "Capture timings and recorded frame rate are not a performance benchmark.",
    "GIFs are silent, resized excerpts; screenshots preserve the rendered UI.",
  ],
  actions: [],
};
let chrome;
const frames = [];
const samples = [];
const pendingWrites = [];
try {
  chrome = await launchChrome({
    profile: path.join(scratch, "profile"),
    headless: true,
  });
  const page = await PageSession.attach(chrome.browser);
  await page.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  receipt.browser = await chrome.browser.send("Browser.getVersion");
  await page.navigate(url);
  const snapshot = () =>
    page.evaluate(
      `(() => ({ at: Date.now(), state: document.querySelector('.application')?.className, text: document.body.innerText, songTime: document.querySelector('.song-progress')?.innerText, left: document.querySelector('.hud-hand-left')?.innerText, right: document.querySelector('.hud-hand-right')?.innerText, combo: document.querySelector('.hud-combo-count')?.innerText }))()`,
    );
  const wait = async (predicate, timeout = 45000) => {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const s = await snapshot();
      if (predicate(s)) return s;
      if (/state-error/.test(s.state ?? "")) throw new Error(s.text);
      await delay(150);
    }
    throw new Error(
      `Timed out waiting for UI: ${JSON.stringify(await snapshot())}`,
    );
  };
  const click = async (id) => {
    await page.click(id);
    receipt.actions.push({ id, at: new Date().toISOString() });
  };
  await wait((s) => /state-select/.test(s.state ?? ""));
  await click(`song:${song}`);
  for (let i = 0; i < 300; i++) {
    const box = await page.targetBox("audio");
    if (!box.missing && !box.disabled) break;
    await delay(100);
  }
  await click("audio");
  for (let i = 0; i < 300; i++) {
    const box = await page.targetBox("performer-trial");
    if (!box.missing && !box.disabled) break;
    await delay(100);
  }
  await delay(1800);
  const menu = await page.send("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(out, "menu.png"), Buffer.from(menu.data, "base64"));
  await click("performer-trial");
  await wait((s) => /state-playing/.test(s.state ?? ""), 120000);
  const recordingStart = Date.now();
  chrome.browser.on((message) => {
    if (
      message.sessionId !== page.sessionId ||
      message.method !== "Page.screencastFrame"
    )
      return;
    const p = message.params;
    const index = frames.length;
    const filename = `${String(index).padStart(6, "0")}.jpg`;
    frames.push({
      filename,
      timestamp: p.metadata.timestamp,
      receivedAt: Date.now(),
    });
    pendingWrites.push(
      writeFile(path.join(frameDir, filename), Buffer.from(p.data, "base64")),
    );
    void page.send("Page.screencastFrameAck", { sessionId: p.sessionId });
  });
  await page.send("Page.startScreencast", {
    format: "jpeg",
    quality: 92,
    maxWidth: 1440,
    maxHeight: 900,
    everyNthFrame: 1,
  });
  let complete = false;
  while (Date.now() - recordingStart < 130000) {
    const s = await snapshot();
    samples.push(s);
    if (/state-results/.test(s.state ?? "")) {
      complete = true;
      break;
    }
    if (/state-paused/.test(s.state ?? ""))
      throw new Error(`Capture paused: ${s.text}`);
    await delay(200);
  }
  if (!complete)
    throw new Error("Auto-play did not reach results within 130 seconds");
  await page.send("Page.stopScreencast");
  await Promise.all(pendingWrites);
  await delay(2200);
  const results = await page.send("Page.captureScreenshot", { format: "png" });
  await writeFile(
    path.join(out, "results.png"),
    Buffer.from(results.data, "base64"),
  );
  receipt.resultsText = (await snapshot()).text;
  receipt.console = page.console;
  receipt.framesCaptured = frames.length;
  receipt.recordingSeconds = frames.at(-1).timestamp - frames[0].timestamp;
  receipt.finishedAt = new Date().toISOString();
  await writeFile(
    path.join(scratch, "timeline.json"),
    JSON.stringify({ frames, samples }, null, 2),
  );
  const concat = frames
    .map((frame, i) => {
      const duration =
        i + 1 < frames.length
          ? Math.max(0.001, frames[i + 1].timestamp - frame.timestamp)
          : 0.1;
      return `file '${path.join(frameDir, frame.filename).replaceAll("\\", "/")}'\nduration ${duration}\n`;
    })
    .join("");
  await writeFile(path.join(scratch, "frames.txt"), concat);
  await writeFile(
    path.join(out, "capture.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        scratch,
        receipt: path.join(out, "capture.json"),
        frames: frames.length,
        results: receipt.resultsText,
      },
      null,
      2,
    ),
  );
} catch (error) {
  receipt.failure = error instanceof Error ? error.message : String(error);
  await writeFile(
    path.join(out, "capture.json"),
    JSON.stringify(receipt, null, 2) + "\n",
  );
  console.error(JSON.stringify({ scratch, failure: receipt.failure }));
  throw error;
} finally {
  if (chrome) await chrome.close();
}
