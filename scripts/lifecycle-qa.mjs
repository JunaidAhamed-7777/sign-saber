#!/usr/bin/env node
/** Production-browser failure/lifecycle QA. Real native UI actions; no fabricated input or scores. */
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  open,
  rm,
} from "node:fs/promises";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir, platform, release, cpus } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createStaticServer } from "./serve.mjs";
import {
  launchChrome,
  PageSession,
  defaultBrowser,
  delay,
} from "./cdp-client.mjs";
import {
  SCENARIOS,
  CYCLE_COUNT,
  RETAINED_METRICS,
  rhythmWav,
  sha256,
  retainedGrowth,
  reportPassed,
  markdownReport,
} from "./lifecycle-helpers.mjs";
import {
  installLifecycleProbe,
  cacheFailureScript,
} from "./lifecycle-probe.mjs";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--"))
    throw new Error(`Missing --${name} value`);
  return args[index + 1];
};
const selected = option("scenario", "all").split(",");
if (!selected.every((name) => name === "all" || SCENARIOS.includes(name)))
  throw new Error("Unknown lifecycle scenario");
const date = option("date", new Date().toLocaleDateString("en-CA"));
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Use --date YYYY-MM-DD");
const outDir = path.resolve(option("out", path.join(root, "docs/evidence")));
const temp = await mkdtemp(path.join(tmpdir(), "sign-saber-lifecycle-"));
const report = {
  schema: 1,
  date,
  recordedAt: new Date().toISOString(),
  gitHead: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  dirtyTree: !!execFileSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  environment: {
    node: process.version,
    os: `${platform()} ${release()}`,
    logicalCpus: cpus().length,
  },
  sourceHashes: {},
  browser: null,
  protocol: null,
  fixtures: {},
  measurement: {
    renderer:
      "Actual Three.js renderer.info.memory; read-only ?stats=1 diagnostics",
    audio:
      "CDP WebAudio lifetime events; only native string IDs retained; no AudioNode references",
    listeners:
      "CDP Memory.getDOMCounters.jsEventListeners after HeapProfiler.collectGarbage and the same quiet boundary",
    workers:
      "CDP Target.getTargets worker targets in the current isolated browser context",
    observers:
      "Auxiliary observe/disconnect token count, not a retained-GC metric and not a growth gate",
    warmup:
      "One complete generated-chart run, one retry cycle and one quit cycle; then three identical GC/quiet snapshots at the suspended menu boundary before 20 measured cycles",
  },
  limitations: [
    "Synthetic original WAVs/planned motion; no camera/person/recognition",
    "Muted headless software rendering; no audible-sync or GPU-performance claim",
    "Forced GC/resource counts are lifecycle diagnostics, not release performance evidence",
  ],
  scenarios: SCENARIOS.map((name) => ({ name, status: "not-run", checks: [] })),
};
let server, chrome, baseUrl;
const fixturePaths = {};

class QaPage {
  constructor(page, contextId, previousListeners) {
    this.page = page;
    this.contextId = contextId;
    this.previousListeners = previousListeners;
    this.audioNodes = new Map();
    this.audioContexts = new Map();
    this.audioEdges = new Map();
    this.progress = [];
    this.off = chrome.browser.on((event) => {
      if (event.sessionId !== page.sessionId) return;
      const { method, params } = event;
      if (
        method === "WebAudio.contextCreated" ||
        method === "WebAudio.contextChanged"
      )
        this.audioContexts.set(params.context.contextId, {
          type: params.context.contextType,
          state: params.context.contextState,
        });
      else if (method === "WebAudio.contextWillBeDestroyed") {
        this.audioContexts.delete(params.contextId);
        for (const [key, node] of this.audioNodes)
          if (node.contextId === params.contextId) this.audioNodes.delete(key);
      } else if (method === "WebAudio.audioNodeCreated")
        this.audioNodes.set(params.node.nodeId, {
          contextId: params.node.contextId,
          nodeType: params.node.nodeType,
        });
      else if (method === "WebAudio.audioNodeWillBeDestroyed") {
        this.audioNodes.delete(params.nodeId);
        this.audioEdges.delete(params.nodeId);
        for (const destinations of this.audioEdges.values())
          destinations.delete(params.nodeId);
      } else if (method === "WebAudio.nodesConnected") {
        if (!this.audioEdges.has(params.sourceId))
          this.audioEdges.set(params.sourceId, new Set());
        this.audioEdges.get(params.sourceId).add(params.destinationId);
      } else if (method === "WebAudio.nodesDisconnected") {
        if (!params.destinationId) this.audioEdges.delete(params.sourceId);
        else this.audioEdges.get(params.sourceId)?.delete(params.destinationId);
      }
    });
  }
  static async create({ tier = "medium", cacheFailure = null } = {}) {
    const previousListeners = new Set(chrome.browser.listeners);
    const { browserContextId } = await chrome.browser.send(
      "Target.createBrowserContext",
    );
    const { targetId } = await chrome.browser.send("Target.createTarget", {
      url: "about:blank",
      browserContextId,
    });
    const { sessionId } = await chrome.browser.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    const page = new PageSession(chrome.browser, sessionId, targetId);
    const qa = new QaPage(page, browserContextId, previousListeners);
    try {
      await page.send("Page.enable");
      await page.send("Runtime.enable");
      await page.send("WebAudio.enable");
      await page.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `(${installLifecycleProbe.toString()})();`,
      });
      if (cacheFailure)
        await page.send("Page.addScriptToEvaluateOnNewDocument", {
          source: cacheFailureScript(cacheFailure),
        });
      await page.send("Emulation.setDeviceMetricsOverride", {
        width: 1440,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await chrome.browser.send("Target.activateTarget", { targetId });
      await page.navigate(`${baseUrl}/?stats=1&tier=${tier}`);
      await qa.wait((s) => s?.state === "SELECT", "BOOT → SELECT");
      return qa;
    } catch (error) {
      await qa.close();
      throw error;
    }
  }
  async snapshot() {
    const value = await this.page.evaluate(
      "window.__signSaberDiagnostics?.snapshot() ?? null",
    );
    if (value?.generation?.active) this.progress.push({ ...value.generation });
    return value;
  }
  async wait(predicate, label, timeout = 180000) {
    const start = Date.now();
    let last;
    while (Date.now() - start < timeout) {
      last = await this.snapshot();
      if (predicate(last)) return last;
      await delay(100);
    }
    throw new Error(`Timed out: ${label}; last state ${JSON.stringify(last)}`);
  }
  async control(id, label = id) {
    const start = Date.now();
    while (Date.now() - start < 20000) {
      const box = await this.page.targetBox(id);
      if (!box.missing && !box.disabled) return;
      await delay(100);
    }
    throw new Error(`UI control unavailable: ${label}`);
  }
  async click(id) {
    await this.control(id);
    await this.page.click(id);
  }
  async pageUntil(id, rail) {
    if (!(await this.page.targetBox(id)).missing) return;
    for (let attempt = 0; attempt < 12; attempt++) {
      const previous = await this.page.targetBox(`ui:${rail}:previous`);
      if (previous.missing || previous.disabled) break;
      await this.page.click(`ui:${rail}:previous`);
      await delay(50);
    }
    for (let attempt = 0; attempt < 12; attempt++) {
      const box = await this.page.targetBox(id);
      if (!box.missing) return;
      const next = await this.page.targetBox(`ui:${rail}:next`);
      if (next.missing || next.disabled) break;
      await this.page.click(`ui:${rail}:next`);
      await delay(50);
    }
    throw new Error(`Cannot reach ${id} on ${rail} pages`);
  }
  async upload(file) {
    // The actual HTML file input, via CDP's native file-picker seam; no call into GameRuntime.
    await this.pageUntil("ui:left:previous", "left").catch(() => {});
    for (let attempt = 0; attempt < 8; attempt++) {
      const exists = await this.page.evaluate(
        "!!document.querySelector('#audio-file')",
      );
      if (exists) break;
      await this.click("ui:left:next");
    }
    const { root: doc } = await this.page.send("DOM.getDocument");
    const { nodeId } = await this.page.send("DOM.querySelector", {
      nodeId: doc.nodeId,
      selector: "#audio-file",
    });
    if (!nodeId) throw new Error("Audio picker missing");
    await this.page.send("DOM.setFileInputFiles", { nodeId, files: [file] });
  }
  async readyUpload(
    file = fixturePaths.valid,
    hash = report.fixtures.valid.sha256,
  ) {
    await this.upload(file);
    return this.wait(
      (s) => s?.mapReady && !s.loading && s.selection?.sourceHash === hash,
      "generated upload ready",
    );
  }
  async enableSound() {
    await this.pageUntil("audio", "right");
    await this.click("audio");
    await this.wait((s) => s.audioReady, "native Enable sound");
  }
  async start() {
    if (!(await this.snapshot()).audioReady) await this.enableSound();
    await this.pageUntil("performer-trial", "right");
    await this.click("performer-trial");
  }
  async playing() {
    return this.wait((s) => s.state === "PLAYING", "performer PLAYING");
  }
  async results() {
    return this.wait(
      (s) => s.state === "RESULTS" && s.results,
      "real performer RESULTS",
    );
  }
  async capture(label, width = 1440, height = 900) {
    await this.page.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await delay(200);
    const { data } = await this.page.send("Page.captureScreenshot", {
      format: "webp",
      quality: 78,
    });
    const file = `${date}-lifecycle-${label}-${width}.webp`;
    await mkdir(outDir, { recursive: true });
    await writeFile(path.join(outDir, file), Buffer.from(data, "base64"));
    return file;
  }
  async reloadFromError() {
    const box = await this.page.evaluate(`(() => {
      const link = document.querySelector('.boot-error a[href="/"]');
      if (!link) return null;
      const rect = link.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`);
    if (!box) throw new Error("Visible error page has no reload link");
    await this.page.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      ...box,
      button: "left",
      clickCount: 1,
    });
    await this.page.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      ...box,
      button: "left",
      clickCount: 1,
    });
    // The native reload link intentionally returns to the ordinary (non-stats) app.
    const start = Date.now();
    while (Date.now() - start < 20000) {
      const recovered = await this.page.evaluate(
        "!!document.querySelector('[data-target=\"song:pamgaea\"]') && !document.querySelector('.boot-error')",
      );
      if (recovered) return true;
      await delay(100);
    }
    return false;
  }
  async songs() {
    await this.pageUntil("songs", "right");
    await this.click("songs");
    const result = await this.wait(
      (s) => s.state === "SELECT",
      "Songs → SELECT",
    );
    await this.pageUntil("performer-trial", "right");
    return result;
  }
  async resources() {
    await delay(500);
    await this.page.send("HeapProfiler.collectGarbage");
    await delay(250);
    await this.page.send("HeapProfiler.collectGarbage");
    await delay(250);
    const s = await this.snapshot(),
      probe = await this.page.evaluate("window.__lifecycleProbe.snapshot()");
    const dom = await this.page.send("Memory.getDOMCounters");
    const { targetInfos } = await chrome.browser.send("Target.getTargets");
    const workers = targetInfos
      .filter(
        (target) =>
          target.type === "worker" &&
          (target.browserContextId
            ? target.browserContextId === this.contextId
            : target.url.startsWith(baseUrl)),
      )
      .map((target) => ({ id: target.targetId, url: target.url }));
    const audioNodeTypes = {};
    for (const node of this.audioNodes.values())
      audioNodeTypes[node.nodeType] = (audioNodeTypes[node.nodeType] ?? 0) + 1;
    return {
      ...s?.resources,
      ...probe,
      jsEventListeners: dom.jsEventListeners,
      domNodes: dom.nodes,
      audioNodes: this.audioNodes.size,
      audioContexts: this.audioContexts.size,
      audioNodeTypes,
      nativeAudioContexts: [...this.audioContexts].map(([id, context]) => ({
        id,
        ...context,
      })),
      nativeAudioNodes: [...this.audioNodes].map(([id, node]) => ({
        id,
        ...node,
        destinations: [...(this.audioEdges.get(id) ?? [])],
      })),
      audio: s.audio,
      workers: workers.length,
      workerTargets: workers,
      state: s.state,
      at: new Date().toISOString(),
    };
  }
  async cycle(retry) {
    await this.start();
    await this.playing();
    await this.wait((s) => s.hud.score > 0, "genuine hit before cycle pause");
    await this.page.key("Escape", "Escape", 27);
    await this.wait((s) => s.state === "PAUSED", "manual pause");
    await this.click("resume");
    await this.playing();
    if (retry) {
      await this.results();
      await this.pageUntil("retry", "right");
      await this.click("retry");
      await this.playing();
    }
    await this.page.key("Escape", "Escape", 27);
    await this.wait(
      (s) => s.state === "PAUSED",
      retry ? "retry pause" : "quit pause",
    );
    await this.songs();
    await delay(250);
  }
  async close() {
    this.off();
    await chrome.browser.send("Target.disposeBrowserContext", {
      browserContextId: this.contextId,
    });
    for (const listener of chrome.browser.listeners)
      if (!this.previousListeners.has(listener))
        chrome.browser.listeners.delete(listener);
  }
  async stableBaseline() {
    const samples = [];
    let stable = 0,
      previous = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const sample = await this.resources();
      samples.push(sample);
      for (const name of RETAINED_METRICS)
        if (!Number.isInteger(sample[name]) || sample[name] < 0)
          throw new Error(`Native retained metric unavailable: ${name}`);
      const signature = JSON.stringify(
        RETAINED_METRICS.map((name) => sample[name]),
      );
      stable = signature === previous ? stable + 1 : 1;
      previous = signature;
      if (stable === 3) return { baseline: sample, samples };
    }
    throw new Error(
      `Warm-up did not reach three stable native resource snapshots: ${JSON.stringify(samples)}`,
    );
  }
}

function check(item, name, ok, detail) {
  item.checks.push({
    name,
    ok: !!ok,
    ...(detail !== undefined
      ? { detail: typeof detail === "string" ? detail : JSON.stringify(detail) }
      : {}),
  });
  if (!ok)
    console.error(
      `FAIL ${item.name}: ${name}${detail ? ` — ${JSON.stringify(detail)}` : ""}`,
    );
}
const consoleErrors = (qa) =>
  qa.page.console.filter((entry) => entry.type !== "warning");
async function withPage(item, options, fn) {
  const qa = await QaPage.create(options);
  try {
    return await fn(qa);
  } finally {
    item.console ??= [];
    item.console.push(...qa.page.console);
    await qa.close();
  }
}
async function setupUpload(qa) {
  const ready = await qa.readyUpload();
  await qa.pageUntil("difficulty:normal", "right");
  await qa.click("difficulty:normal");
  await qa.wait(
    (s) => s.mapReady && !s.loading && s.selection.difficulty === "normal",
    "Normal difficulty",
  );
  await qa.enableSound();
  return ready;
}

const scenarios = {
  async upload(item) {
    item.reproduction =
      "Upload lifecycle-valid.wav, wait for analysis, choose Easy then Normal, Enable sound, Watch synthetic performer, wait for Results, choose Songs.";
    await withPage(item, {}, async (qa) => {
      const ready = await qa.readyUpload();
      check(
        item,
        "original synthesized upload generated a real nonempty chart",
        ready.selection.notes > 0,
        ready.selection,
      );
      check(
        item,
        "generation progress was observed",
        qa.progress.length > 0,
        qa.progress,
      );
      await qa.pageUntil("difficulty:easy", "right");
      await qa.click("difficulty:easy");
      await qa.wait(
        (s) => s.mapReady && !s.loading && s.selection.difficulty === "easy",
        "Easy difficulty",
      );
      await qa.click("difficulty:normal");
      await qa.wait(
        (s) => s.mapReady && !s.loading && s.selection.difficulty === "normal",
        "Normal difficulty",
      );
      await qa.enableSound();
      await qa.start();
      const result = await qa.results();
      item.results = result.results;
      check(
        item,
        "performer reached real results with nonzero hits",
        result.results.counts.perfect +
          result.results.counts.great +
          result.results.counts.good >
          0,
        result.results.counts,
      );
      await qa.songs();
      check(item, "Songs returns to a usable menu", true);
      check(
        item,
        "no browser console errors (warnings retained separately)",
        consoleErrors(qa).length === 0,
        consoleErrors(qa),
      );
    });
  },
  async cancel(item) {
    item.reproduction =
      "Upload lifecycle-long.wav; click Cancel analysis while progress is active; upload lifecycle-second.wav; verify its source hash remains selected after old work could return.";
    await withPage(item, {}, async (qa) => {
      await qa.upload(fixturePaths.long);
      const stages = ["stft", "flux", "onsets", "tempo", "beats", "energy"];
      const active = await qa.wait(
        (s) =>
          s.generation.active &&
          s.generation.fraction < 1 &&
          stages.includes(s.generation.stage),
        "actual DSP worker progress before cancellation",
      );
      item.cancelledAt = active.generation;
      await qa.click("cancel-generation");
      await qa.wait(
        (s) => !s.loading && !s.generation.active,
        "analysis cancelled",
      );
      const ready = await qa.readyUpload(
        fixturePaths.second,
        report.fixtures.second.sha256,
      );
      await delay(1500);
      const later = await qa.snapshot();
      check(
        item,
        "a second upload succeeds after cancellation",
        ready.mapReady,
        ready.selection,
      );
      check(
        item,
        "cancelled job cannot overwrite the new selection",
        later.selection?.sourceHash === report.fixtures.second.sha256 &&
          !later.loading,
        later.selection,
      );
      check(
        item,
        "no browser console errors (warnings retained separately)",
        consoleErrors(qa).length === 0,
        consoleErrors(qa),
      );
    });
  },
  async invalid(item) {
    item.reproduction =
      "Choose each corrupt/wrong-format/one-second/over-60-MiB fixture in turn; inspect error, then select bundled music to verify menu recovery.";
    await withPage(item, {}, async (qa) => {
      for (const name of ["corrupt", "wrong", "short", "oversized"]) {
        await qa.upload(fixturePaths[name]);
        const failed = await qa.wait(
          (s) => !s.loading && !!s.error,
          `${name}: actionable input error`,
        );
        const visibleError = await qa.page.evaluate("document.body.innerText");
        check(
          item,
          `${name}: an actual input error is shown`,
          !!failed.error &&
            !failed.mapReady &&
            visibleError.includes(failed.error),
          failed.error,
        );
        await qa.pageUntil("song:pamgaea", "left");
        await qa.click("song:pamgaea");
        const recovered = await qa.wait(
          (s) => s.mapReady && !s.loading,
          `${name}: bundled selection recovers`,
        );
        check(
          item,
          `${name}: menu remains usable`,
          recovered.selection?.title === "Pamgaea",
          recovered.selection,
        );
      }
    });
  },
  async cache(item) {
    item.reproduction =
      "Before load, deny IndexedDB access or make real readwrite transactions throw QuotaExceededError; upload the synthesized WAV and inspect the visible fallback notice.";
    for (const mode of ["unavailable", "quota"])
      await withPage(item, { cacheFailure: mode }, async (qa) => {
        const ready = await qa.readyUpload();
        check(
          item,
          `${mode}: generation succeeds without cache`,
          ready.selection.notes > 0,
          ready.selection,
        );
        check(
          item,
          `${mode}: cache failure is retained in chart warnings`,
          ready.selection.warnings.includes("cacheUnavailable"),
          ready.selection.warnings,
        );
        const text = await qa.page.evaluate("document.body.innerText");
        check(
          item,
          `${mode}: visible honest cache-fallback message`,
          /cache|storage/i.test(text) &&
            /unavailable|without|not saved|could not/i.test(text),
          text,
        );
        if (mode === "unavailable") {
          item.screenshots = [
            await qa.capture("cache"),
            await qa.capture("cache", 1024, 640),
          ];
          const compact = await qa.page.evaluate("document.body.innerText");
          check(
            item,
            "compact viewport keeps the cache notice visible",
            compact.includes("Local cache unavailable"),
            compact,
          );
        }
      });
  },
  async context(item) {
    item.reproduction =
      "On the menu and separately during performer play, call the canvas WEBGL_lose_context extension. Check visible failure/recovery, halted audio/scoring and bounded render callbacks.";
    for (const state of ["menu", "play"])
      await withPage(item, {}, async (qa) => {
        if (state === "play") {
          await setupUpload(qa);
          await qa.start();
          await qa.playing();
        }
        const available = await qa.page.evaluate(
          `(() => { const gl = document.querySelector('#app canvas')?.getContext('webgl2'); const extension = gl?.getExtension('WEBGL_lose_context'); if (!extension) return false; extension.loseContext(); return true; })()`,
        );
        check(
          item,
          `${state}: actual context-loss extension available`,
          available,
        );
        await delay(500);
        const before = await qa.snapshot();
        const probe = await qa.page.evaluate(
          "window.__lifecycleProbe.snapshot()",
        );
        await delay(1000);
        const after = await qa.snapshot();
        const later = await qa.page.evaluate(
          "window.__lifecycleProbe.snapshot()",
        );
        const nativeAudio = [...qa.audioContexts].map(([id, context]) => ({
          id,
          ...context,
        }));
        const realtime = nativeAudio.filter(
          (context) => context.type === "realtime",
        );
        const text = await qa.page.evaluate("document.body.innerText");
        check(
          item,
          `${state}: useful visible graphics failure or successful recovery`,
          !after.resources?.contextLost ||
            /graphics|WebGL|arena could not|reload|context/i.test(text),
          { before, after, text },
        );
        check(
          item,
          `${state}: no zombie scoring/audio run`,
          state === "menu" ||
            (after.state !== "PLAYING" &&
              !after.audioReady &&
              realtime.length === 1 &&
              realtime.every((context) =>
                ["suspended", "closed"].includes(context.state),
              ) &&
              after.audio?.contextState !== "running" &&
              after.audio?.activeSfxVoices === 0 &&
              after.hud.score === before.hud.score &&
              (after.songTimeMs === null ||
                after.songTimeMs === before.songTimeMs)),
          {
            state: after.state,
            songTimeMs: after.songTimeMs,
            audio: after.audio,
            nativeAudio,
          },
        );
        check(
          item,
          `${state}: no zombie render callback loop while context remains lost`,
          !after.resources?.contextLost ||
            later.rafCallbacks - probe.rafCallbacks <= 1,
          { callbacksAfterLoss: later.rafCallbacks - probe.rafCallbacks },
        );
        if (after.resources?.contextLost) {
          if (state === "menu")
            item.screenshots = [
              await qa.capture("graphics-error"),
              await qa.capture("graphics-error", 1024, 640),
            ];
          check(
            item,
            `${state}: native Retry reload restores the usable song menu`,
            await qa.reloadFromError(),
          );
        }
      });
  },
  async cycles(item) {
    item.reproduction =
      "Warm a complete uploaded performer run, return to Songs, collect garbage, then measure all 20 real start/pause/resume/quit cycles with periodic Results/retry; compare the same idle menu boundary.";
    await withPage(item, {}, async (qa) => {
      await setupUpload(qa);
      await qa.start();
      await qa.results();
      await qa.songs();
      item.beforeLifecycleWarmup = await qa.resources();
      await qa.cycle(true);
      await qa.cycle(false);
      const warmup = await qa.stableBaseline();
      item.baseline = warmup.baseline;
      item.warmupSamples = warmup.samples;
      check(
        item,
        "fixed baseline is the actual suspended-audio menu boundary",
        item.baseline.audio.contextState === "suspended",
        item.baseline.nativeAudioContexts,
      );
      item.cycles = [];
      console.log(`Lifecycle fixed baseline: ${JSON.stringify(item.baseline)}`);
      for (let index = 0; index < CYCLE_COUNT; index++) {
        await qa.cycle((index + 1) % 5 === 0);
        const sample = await qa.resources();
        item.cycles.push(sample);
        console.log(
          `Lifecycle cycle ${index + 1}/${CYCLE_COUNT}: ${JSON.stringify(sample)}`,
        );
      }
      const failures = retainedGrowth(item.baseline, item.cycles);
      check(
        item,
        "quit leaves no connected native buffer sources or active SFX voices",
        item.cycles.every(
          (sample) =>
            sample.audio.contextState === "suspended" &&
            sample.audio.activeSfxVoices === 0 &&
            sample.nativeAudioNodes.every(
              (node) =>
                node.nodeType !== "AudioBufferSource" ||
                node.destinations.length === 0,
            ),
        ),
      );
      check(
        item,
        "all 20 complete measured cycles",
        item.cycles.length === CYCLE_COUNT,
      );
      check(
        item,
        "warmed retained resources do not grow",
        failures.length === 0,
        failures,
      );
      check(
        item,
        "no browser console errors during repeated lifecycle",
        consoleErrors(qa).length === 0,
        consoleErrors(qa),
      );
    });
  },
  async hidden(item) {
    item.reproduction =
      "Activate another real Chrome tab during the start countdown and separately during play; return to the game tab and inspect cancellation/pause/manual resume.";
    for (const state of ["countdown", "play"])
      await withPage(item, {}, async (qa) => {
        await setupUpload(qa);
        await qa.start();
        await qa.wait(
          (s) =>
            s.state === (state === "countdown" ? "CALIBRATION" : "PLAYING"),
          state,
        );
        const { targetId } = await chrome.browser.send("Target.createTarget", {
          url: "about:blank",
          browserContextId: qa.contextId,
        });
        await chrome.browser.send("Target.activateTarget", { targetId });
        await delay(750);
        const hidden = await qa.page.evaluate("document.hidden");
        const during = await qa.snapshot();
        check(
          item,
          `${state}: browser actually hid the game tab`,
          hidden,
          during,
        );
        check(
          item,
          `${state}: expected hidden-tab semantics`,
          state === "countdown"
            ? during.state === "SELECT"
            : during.state === "PAUSED" && during.pauseReason === "hidden",
          during,
        );
        await chrome.browser.send("Target.activateTarget", {
          targetId: qa.page.targetId,
        });
        await chrome.browser.send("Target.closeTarget", { targetId });
        await delay(300);
        const returned = await qa.snapshot();
        check(
          item,
          `${state}: returning alone never auto-starts`,
          returned.state === (state === "countdown" ? "SELECT" : "PAUSED"),
          returned.state,
        );
        if (state === "play" && returned.state === "PAUSED") {
          await qa.click("resume");
          await qa.playing();
          check(item, "native Resume works after tab return", true);
        }
      });
  },
  async tiers(item) {
    item.reproduction =
      "Load fresh low/medium/high fixed-tier pages, upload the same original synthesized WAV, enable sound and complete the planned performer through actual results.";
    for (const tier of ["low", "medium", "high"])
      await withPage(item, { tier }, async (qa) => {
        const initial = await qa.snapshot();
        check(
          item,
          `${tier}: requested quality tier boots`,
          initial.quality?.tier === tier,
          initial.quality,
        );
        await setupUpload(qa);
        await qa.start();
        const result = await qa.results();
        check(
          item,
          `${tier}: performer reaches genuine positive results`,
          result.results.score > 0,
          result.results.counts,
        );
        check(
          item,
          `${tier}: no browser console errors`,
          consoleErrors(qa).length === 0,
          consoleErrors(qa),
        );
      });
  },
};

try {
  for (const file of [
    "scripts/lifecycle-qa.mjs",
    "scripts/lifecycle-helpers.mjs",
    "scripts/lifecycle-probe.mjs",
    "scripts/cdp-client.mjs",
    "app/src/core/runtime.ts",
    "app/src/render/renderer.ts",
    "app/src/ui/strings.ts",
    "app/src/ui/screens/Select.tsx",
    "app/package-lock.json",
  ])
    report.sourceHashes[file] = sha256(await readFile(path.join(root, file)));
  for (const [name, seconds, seed] of [
    ["valid", 12, 104],
    ["second", 13, 208],
    ["long", 240, 416],
    ["short", 1, 104],
  ]) {
    const bytes = rhythmWav(seconds, 22050, seed);
    fixturePaths[name] = path.join(temp, `lifecycle-${name}.wav`);
    await writeFile(fixturePaths[name], bytes);
    report.fixtures[name] = {
      bytes: bytes.length,
      durationSec: seconds,
      sampleRate: 22050,
      sha256: sha256(bytes),
      source: "original deterministic synthesized pulse/tone/noise",
    };
  }
  for (const [name, extension, bytes] of [
    ["corrupt", "wav", Buffer.from("RIFFbroken")],
    ["wrong", "txt", Buffer.from("This is text, not an audio file.\n")],
  ]) {
    fixturePaths[name] = path.join(temp, `lifecycle-${name}.${extension}`);
    await writeFile(fixturePaths[name], bytes);
    report.fixtures[name] = { bytes: bytes.length, sha256: sha256(bytes) };
  }
  fixturePaths.oversized = path.join(temp, "lifecycle-oversized.wav");
  const oversized = await open(fixturePaths.oversized, "w");
  await oversized.truncate(60 * 1024 * 1024 + 1);
  await oversized.close();
  report.fixtures.oversized = {
    bytes: 60 * 1024 * 1024 + 1,
    source: "sparse zero file; admission limit check only",
  };
  if (!args.includes("--no-build"))
    await run(
      process.execPath,
      [path.join(root, "app/node_modules/vite/bin/vite.js"), "build"],
      { cwd: path.join(root, "app"), windowsHide: true, timeout: 180000 },
    );
  server = createStaticServer({ root: path.join(root, "app/dist") });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  chrome = await launchChrome({
    binary: option("browser", defaultBrowser()),
    profile: path.join(temp, "profile"),
    headless: true,
    args: [
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--mute-audio",
    ],
  });
  report.browser = await chrome.browser.send("Browser.getVersion");
  const protocol = await (
    await fetch(`http://127.0.0.1:${chrome.port}/json/protocol`)
  ).json();
  report.protocol = Object.fromEntries(
    ["WebAudio", "Memory", "HeapProfiler", "Target"].map((name) => {
      const domain = protocol.domains.find((item) => item.domain === name);
      return [
        name,
        {
          commands: domain?.commands?.map((item) => item.name),
          events: domain?.events?.map((item) => item.name),
        },
      ];
    }),
  );
  if (
    !report.protocol.WebAudio.commands?.includes("enable") ||
    !report.protocol.WebAudio.events?.includes("audioNodeWillBeDestroyed")
  )
    throw new Error(
      "Installed Chrome lacks required native WebAudio resource events",
    );
  for (const item of report.scenarios) {
    if (!selected.includes("all") && !selected.includes(item.name)) continue;
    console.log(`Lifecycle scenario: ${item.name}`);
    item.startedAt = new Date().toISOString();
    try {
      await scenarios[item.name](item);
      item.status =
        item.checks.length && item.checks.every((value) => value.ok)
          ? "pass"
          : "fail";
    } catch (error) {
      item.status = "fail";
      item.error = error instanceof Error ? error.stack : String(error);
    }
    item.finishedAt = new Date().toISOString();
    console.log(
      `${item.name}: ${item.status}${item.error ? ` — ${item.error.split("\n")[0]}` : ""}`,
    );
  }
} catch (error) {
  report.error = error instanceof Error ? error.stack : String(error);
} finally {
  report.cleanup = {};
  if (chrome)
    await chrome.close().catch((error) => {
      report.cleanup.browserError = error.message;
    });
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  // Only our mkdtemp directory, checked to remain inside the OS temp root.
  const resolved = path.resolve(temp),
    parent = path.resolve(tmpdir());
  if (
    resolved.startsWith(parent + path.sep) &&
    path.basename(resolved).startsWith("sign-saber-lifecycle-")
  )
    await rm(resolved, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 200,
    }).catch((error) => {
      report.cleanup.profileError = error.message;
    });
  report.completedAt = new Date().toISOString();
  report.passed = !report.error && reportPassed(report.scenarios);
  await mkdir(outDir, { recursive: true });
  const prefix = path.join(outDir, `${date}-lifecycle-qa`);
  await writeFile(`${prefix}.json`, JSON.stringify(report, null, 2) + "\n");
  await writeFile(`${prefix}.md`, markdownReport(report));
  console.log(
    `Lifecycle evidence: ${prefix}.{json,md}; ${report.passed ? "PASS" : "FAIL / INCOMPLETE"}`,
  );
  if (Object.keys(report.cleanup).length)
    console.error(`Optional cleanup: ${JSON.stringify(report.cleanup)}`);
  process.exitCode = report.passed ? 0 : 1;
}
