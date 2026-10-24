#!/usr/bin/env node
/** Clean-commit installation and a real, camera-free offline production journey. */
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir, platform, release, arch } from "node:os";
import { dirname, join, resolve, sep, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { launchChrome, defaultBrowser } from "./cdp-client.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const COMMAND_TIMEOUT_MS = 15 * 60_000;
const BROWSER_STEP_TIMEOUT_MS = 30_000;
const PERFORMANCE_TIMEOUT_MS = 150_000;
const POLL_MS = 200;
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const autoAttach = {
  autoAttach: true,
  waitForDebuggerOnStart: true,
  flatten: true,
  filter: [
    { type: "page" },
    { type: "iframe" },
    { type: "worker" },
    { exclude: true },
  ],
};

/** Worker targets expose Network, but not Fetch. Block before releasing the debugger pause. */
export async function prepareTarget(cdp, sessionId, type, origin) {
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Network.enable", {}, sessionId);
  // Ordered URLPattern allowlists precede legacy wildcard blocks in CDP.
  // https://chromedevtools.github.io/devtools-protocol/tot/Network/#method-setBlockedURLs
  await cdp.send(
    "Network.setBlockedURLs",
    {
      urlPatterns: [{ urlPattern: `${origin}/*`, block: false }],
      urls: ["http://*", "https://*", "ws://*", "wss://*"],
    },
    sessionId,
  );
  if (type === "page" || type === "iframe") {
    await cdp.send(
      "Fetch.enable",
      { patterns: [{ urlPattern: "*" }] },
      sessionId,
    );
    await cdp.send("Target.setAutoAttach", autoAttach, sessionId);
  }
}

export function isLocalRequest(value) {
  try {
    const url = new URL(value);
    if (["about:", "data:", "blob:"].includes(url.protocol)) return true;
    return (
      ["http:", "https:", "ws:", "wss:"].includes(url.protocol) &&
      (url.hostname === "localhost" ||
        url.hostname === "[::1]" ||
        /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(url.hostname))
    );
  } catch {
    return false;
  }
}

export function parseOptions(args, base = root) {
  const options = {
    output: join(base, "docs", "evidence"),
    browser: defaultBrowser(),
    injectMissingAsset: false,
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--inject-missing-asset") options.injectMissingAsset = true;
    else if (["--output-dir", "--browser"].includes(args[i])) {
      const name = args[i];
      const value = args[++i];
      if (!value || value.startsWith("--"))
        throw new Error(`Missing value for ${name}`);
      if (name === "--output-dir") options.output = resolve(base, value);
      else options.browser = value;
    } else throw new Error(`Unknown option: ${args[i]}`);
  }
  return options;
}

export function reportSummary(report) {
  const lines = [
    `# ${report.evidenceDate ?? report.recordedAt.slice(0, 10)} — Release drill${report.injectMissingAsset ? " (injected missing asset)" : ""}`,
    "",
    `Outcome: **${report.passed ? "PASS" : "FAIL"}**. Tested commit: \`${report.commit}\`.`,
    "",
    `Environment: Node ${report.environment.node}, npm ${report.environment.npm}, ${report.environment.os}; browser ${report.browser?.version ?? "not reached"}.`,
    "",
    `Recorded at ${report.recordedAt}${report.evidenceTimezone ? `; evidence filename date uses ${report.evidenceTimezone}` : ""}. Each command ran in a fresh temporary clone checked out at the exact commit above. Uncommitted changes in the invoking checkout were excluded.`,
    "",
    ...report.steps.map(
      (step) =>
        `- ${step.passed ? "PASS" : "FAIL"} — ${step.name} (${step.durationMs} ms${step.exitCode === undefined ? "" : `; exit ${step.exitCode}`})${step.error ? `: ${step.error.replace(/\s+/g, " ")}` : ""}.`,
    ),
    ...(report.notRun ?? []).map((name) => `- NOT RUN — ${name}.`),
    "",
    `Network: ${report.browser?.requests?.length ?? 0} observed page/worker requests, ${report.browser?.blockedRequests?.length ?? 0} blocked external attempts; ${report.browser?.consoleErrors?.length ?? 0} console/runtime/log errors; ${report.browser?.cspViolations?.length ?? 0} CSP violations. Unreached checks are not passes.`,
    "",
    `Synthetic performer results: ${report.browser?.results ? JSON.stringify(report.browser.results) : "not reached"}.`,
    "",
    "The browser uses a dead loopback proxy for non-loopback destinations, plus a CDP Network allowlist on app page/worker targets and Fetch interception on pages. Local requests remain available; this is an offline venue simulation, not an unplugged-network test.",
    "",
    "Camera paths are out of scope. MediaPipe models require network preparation with `npm run models`; this drill never requests a camera. Planned synthetic landmarks exercise the real game scoring path and do not prove webcam recognition, human movement, audible sync or performance targets. Other P5 manual and live-camera gates remain open.",
    "",
  ];
  if (report.failure)
    lines.push(`Failure: ${report.failure.replace(/\s+/g, " ")}`, "");
  if (report.cleanupError)
    lines.push(
      `Temporary-directory cleanup failed: ${report.cleanupError.replace(/\s+/g, " ")}. The check/journey outcomes above remain separate; the overall command fails and leaves the locked directory for inspection.`,
      "",
    );
  return lines.join("\n");
}

/** Keep the previous attempt byte-for-byte before replacing the dated latest report. */
export async function writeEvidence(report, output, stem) {
  const jsonPath = join(output, `${stem}.json`);
  try {
    const previous = await readFile(jsonPath);
    const archived = `${stem}-previous-${createHash("sha256").update(previous).digest("hex").slice(0, 12)}`;
    const retain = async (extension, bytes) => {
      try {
        await writeFile(join(output, `${archived}.${extension}`), bytes, {
          flag: "wx",
        });
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
    };
    await retain("json", previous);
    try {
      await retain("md", await readFile(join(output, `${stem}.md`)));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await writeFile(jsonPath, JSON.stringify(report, null, 2) + "\n");
  await writeFile(join(output, `${stem}.md`), reportSummary(report));
}

function npmArgs(args) {
  if (process.platform !== "win32" && !process.env.npm_execpath)
    return ["npm", args];
  const npmCli =
    process.env.npm_execpath ||
    join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  return [process.execPath, [npmCli, ...args]];
}

async function runCommand(command, args, cwd, logPath) {
  const start = performance.now();
  let output = "";
  const child = spawn(command, args, {
    cwd,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (data) => {
    output += data;
  });
  child.stderr.on("data", (data) => {
    output += data;
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    if (process.platform === "win32" && child.pid) {
      try {
        execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      } catch {
        child.kill();
      }
    } else child.kill();
  }, COMMAND_TIMEOUT_MS);
  const exitCode = await new Promise((done, reject) => {
    child.once("error", reject);
    child.once("close", (code) => done(code ?? 1));
  }).finally(() => clearTimeout(timer));
  await writeFile(logPath, output);
  return {
    exitCode,
    durationMs: Math.round(performance.now() - start),
    passed: exitCode === 0 && !timedOut,
    ...(timedOut ? { error: "Command timed out" } : {}),
    log: basename(logPath),
    outputTail: output.slice(-3000),
  };
}

async function waitFor(check, message, timeout = BROWSER_STEP_TIMEOUT_MS) {
  const started = performance.now();
  while (performance.now() - started < timeout) {
    const value = await check();
    if (value) return value;
    await delay(POLL_MS);
  }
  throw new Error(message);
}

async function browserJourney(clone, temporary, options, report, step) {
  const { createStaticServer } = await import(
    pathToFileURL(join(clone, "scripts", "serve.mjs")).href
  );
  const server = createStaticServer({ root: join(clone, "app", "dist") });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const profile = join(temporary, "chrome-profile");
  let browser;
  let cdp;
  let closing = false;
  const diagnostics = (report.browser = {
    requests: [],
    blockedRequests: [],
    consoleErrors: [],
    cspViolations: [],
    failedRequests: [],
    interceptionErrors: [],
  });
  try {
    browser = await launchChrome({
      binary: options.browser,
      profile,
      headless: true,
      args: [
        "--window-size=1440,900",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--no-pings",
        "--proxy-server=http://127.0.0.1:9",
        "--proxy-bypass-list=localhost;127.0.0.1;[::1]",
      ],
    });
    cdp = browser.browser;
    diagnostics.version = (await cdp.send("Browser.getVersion")).product;
    const readySessions = new Map();
    const sessions = new Map();
    let pageSession;
    const setupSession = async (sessionId, info) => {
      sessions.set(sessionId, info.type);
      await prepareTarget(cdp, sessionId, info.type, origin);
      if (info.type === "page") {
        await cdp.send("Page.enable", {}, sessionId);
        await cdp.send("Log.enable", {}, sessionId);
        await cdp.send(
          "Page.addScriptToEvaluateOnNewDocument",
          {
            source: `window.__releaseDrill={csp:[],states:[]};addEventListener('securitypolicyviolation',e=>window.__releaseDrill.csp.push({directive:e.effectiveDirective,blockedURI:e.blockedURI}));new MutationObserver(()=>{const e=document.querySelector('.application');const s=e?.className.match(/state-(\\w+)/)?.[1];const a=window.__releaseDrill.states;if(s&&a.at(-1)?.state!==s)a.push({state:s,at:performance.now()});}).observe(document,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});`,
          },
          sessionId,
        );
      }
      await cdp.send("Runtime.runIfWaitingForDebugger", {}, sessionId);
      return sessionId;
    };
    cdp.listeners.add((message) => {
      if (closing) return;
      const { method, params, sessionId } = message;
      if (method === "Target.attachedToTarget") {
        const ready = setupSession(params.sessionId, params.targetInfo);
        ready.catch((error) => {
          if (!closing) diagnostics.interceptionErrors.push(error.message);
        });
        readySessions.set(params.targetInfo.targetId, ready);
      } else if (method === "Fetch.requestPaused") {
        const local = isLocalRequest(params.request.url);
        if (!local)
          diagnostics.blockedRequests.push({
            url: params.request.url,
            target: sessions.get(sessionId),
          });
        void cdp
          .send(
            local ? "Fetch.continueRequest" : "Fetch.failRequest",
            {
              requestId: params.requestId,
              ...(!local ? { errorReason: "BlockedByClient" } : {}),
            },
            sessionId,
          )
          .catch((error) => {
            if (!closing) diagnostics.interceptionErrors.push(error.message);
          });
      } else if (method === "Network.requestWillBeSent") {
        diagnostics.requests.push({
          url: params.request.url,
          method: params.request.method,
          type: params.type,
          target: sessions.get(sessionId),
        });
      } else if (
        method === "Network.responseReceived" &&
        params.response.status >= 400
      ) {
        diagnostics.failedRequests.push({
          url: params.response.url,
          status: params.response.status,
        });
      } else if (method === "Network.loadingFailed" && !params.canceled) {
        diagnostics.failedRequests.push({
          requestId: params.requestId,
          error: params.errorText,
        });
      } else if (method === "Runtime.exceptionThrown") {
        diagnostics.consoleErrors.push({
          source: "exception",
          text:
            params.exceptionDetails.exception?.description ??
            params.exceptionDetails.text,
        });
      } else if (
        method === "Runtime.consoleAPICalled" &&
        params.type === "error"
      ) {
        diagnostics.consoleErrors.push({
          source: "console",
          text: params.args
            .map((arg) => arg.value ?? arg.description)
            .join(" "),
        });
      } else if (
        method === "Log.entryAdded" &&
        params.entry.level === "error"
      ) {
        diagnostics.consoleErrors.push({
          source: params.entry.source,
          text: params.entry.text,
        });
      }
    });
    await cdp.send("Target.setAutoAttach", autoAttach);
    const { targetId } = await cdp.send("Target.createTarget", {
      url: "about:blank",
    });
    const ready = await waitFor(
      () => readySessions.get(targetId),
      "Page was not attached",
    );
    pageSession = await ready;
    await cdp.send(
      "Emulation.setDeviceMetricsOverride",
      { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false },
      pageSession,
    );
    const evaluate = async (expression) => {
      const response = await cdp.send(
        "Runtime.evaluate",
        { expression, returnByValue: true, awaitPromise: true },
        pageSession,
      );
      if (response.exceptionDetails)
        throw new Error(response.exceptionDetails.text);
      return response.result.value;
    };
    const state = (name, timeout) =>
      waitFor(
        () => evaluate(`!!document.querySelector('.state-${name}')`),
        `Did not reach ${name.toUpperCase()}`,
        timeout,
      );
    const click = async (target) => {
      const selector = `[data-target=${JSON.stringify(target)}]`;
      const point = await waitFor(
        () =>
          evaluate(
            `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)return null;const r=e.getBoundingClientRect();return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null})()`,
          ),
        `Control unavailable: ${target}`,
      );
      await cdp.send(
        "Input.dispatchMouseEvent",
        { type: "mousePressed", button: "left", clickCount: 1, ...point },
        pageSession,
      );
      await cdp.send(
        "Input.dispatchMouseEvent",
        { type: "mouseReleased", button: "left", clickCount: 1, ...point },
        pageSession,
      );
    };
    try {
      await step("BOOT → SELECT offline", async () => {
        await cdp.send("Page.navigate", { url: origin }, pageSession);
        await state("select");
        await waitFor(
          () =>
            evaluate(
              `document.querySelectorAll('[data-target^="song:"]').length`,
            ),
          "Local music catalog did not load",
        );
        return {
          catalogEntries: await evaluate(
            `document.querySelectorAll('[data-target^="song:"]').length`,
          ),
        };
      });
      await step(
        "Select song and enable sound with native CDP input",
        async () => {
          const target = await evaluate(
            `document.querySelector('[data-target^="song:"]').dataset.target`,
          );
          await click(target);
          await click("audio");
          await waitFor(
            () =>
              evaluate(
                `!!document.querySelector('[data-target="performer-trial"]:not(:disabled)') && document.body.innerText.includes('Sound enabled.')`,
              ),
            "Sound did not unlock",
          );
          return { target, nativeInput: "Input.dispatchMouseEvent" };
        },
      );
      await step("Synthetic performer → genuine results", async () => {
        await click("performer-trial");
        await state("calibration");
        await state("playing");
        await state("results", PERFORMANCE_TIMEOUT_MS);
        const results = await evaluate(
          `(()=>{const counts=Object.fromEntries([...document.querySelectorAll('.judgement-row')].map(e=>[e.className.match(/j-(\\w+)/)[1],Number(e.querySelector('.count').textContent)]));return {counts,hits:(counts.perfect??0)+(counts.great??0)+(counts.good??0),summary:document.querySelector('.result-stats')?.innerText,label:document.querySelector('.replay-label')?.textContent}})()`,
        );
        diagnostics.results = results;
        if (!(results.hits > 0))
          throw new Error("Performer results did not show non-zero hits");
        if (!results.label?.includes("SYNTHETIC PERFORMER"))
          throw new Error("Synthetic performer label missing");
        return results;
      });
      await step("Results → Retry → playing → pause → Songs", async () => {
        await click("retry");
        await state("calibration");
        await state("playing");
        await cdp.send(
          "Input.dispatchKeyEvent",
          {
            type: "keyDown",
            key: "Escape",
            code: "Escape",
            windowsVirtualKeyCode: 27,
          },
          pageSession,
        );
        await cdp.send(
          "Input.dispatchKeyEvent",
          {
            type: "keyUp",
            key: "Escape",
            code: "Escape",
            windowsVirtualKeyCode: 27,
          },
          pageSession,
        );
        await state("paused");
        await click("songs");
        await state("select");
      });
    } finally {
      try {
        const observation = await evaluate("window.__releaseDrill");
        diagnostics.cspViolations = observation?.csp ?? [];
        diagnostics.states = observation?.states ?? [];
        diagnostics.lastScreen = await evaluate(
          "document.body.innerText.slice(0,6000)",
        );
      } catch (error) {
        diagnostics.interceptionErrors.push(error.message);
      }
    }
    await step("Offline network, console and CSP assertions", async () => {
      const escaped = diagnostics.requests.filter(
        (request) => !isLocalRequest(request.url),
      );
      if (
        escaped.length ||
        diagnostics.blockedRequests.length ||
        diagnostics.consoleErrors.length ||
        diagnostics.cspViolations.length ||
        diagnostics.failedRequests.length ||
        diagnostics.interceptionErrors.length
      )
        throw new Error(
          `External requests/attempts ${escaped.length}/${diagnostics.blockedRequests.length}; console errors ${diagnostics.consoleErrors.length}; CSP ${diagnostics.cspViolations.length}; failed requests ${diagnostics.failedRequests.length}; interception errors ${diagnostics.interceptionErrors.length}`,
        );
      return {
        requests: diagnostics.requests.length,
        externalRequests: 0,
        cspViolations: 0,
        consoleErrors: 0,
      };
    });
  } finally {
    closing = true;
    if (browser) {
      await browser.close();
      diagnostics.chromeStderr = browser.stderr();
    }
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
  }
}

export async function runDrill(options, repository = root) {
  const recordedAt = new Date().toISOString();
  const evidenceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const evidenceDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: evidenceTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(recordedAt));
  const suffix = options.injectMissingAsset ? "-missing-asset" : "";
  const stem = `${evidenceDate}-release-drill${suffix}`;
  const runStem = `${stem}-${recordedAt.slice(11, 23).replace(/[:.]/g, "")}`;
  await mkdir(options.output, { recursive: true });
  const report = {
    schemaVersion: 1,
    recordedAt,
    evidenceDate,
    evidenceTimezone,
    commit: "unresolved",
    passed: false,
    injectMissingAsset: options.injectMissingAsset,
    environment: {
      node: process.version,
      npm: "unresolved",
      os: `${platform()} ${release()} ${arch()}`,
    },
    steps: [],
    exclusions: [
      "camera/model preparation",
      "live recognition",
      "human QA",
      "audible synchronization",
      "P4 performance gates",
    ],
  };
  let temporary;
  const step = async (name, action) => {
    console.log(name);
    const started = performance.now();
    try {
      const details = await action();
      const result = {
        name,
        passed: true,
        durationMs: Math.round(performance.now() - started),
        ...details,
      };
      report.steps.push(result);
      if (!result.passed)
        throw new Error(
          `${name} exited ${result.exitCode}. ${result.outputTail ?? ""}`,
        );
      return result;
    } catch (error) {
      if (report.steps.at(-1)?.name !== name)
        report.steps.push({
          name,
          passed: false,
          durationMs: Math.round(performance.now() - started),
          error: error.message,
        });
      throw error;
    }
  };
  try {
    report.commit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repository,
      encoding: "utf8",
    }).trim();
    report.harnessSha256 = createHash("sha256")
      .update(await readFile(fileURLToPath(import.meta.url)))
      .digest("hex");
    report.browserHelperSha256 = createHash("sha256")
      .update(await readFile(new URL("./cdp-client.mjs", import.meta.url)))
      .digest("hex");
    report.invokingCheckoutDirty = !!execFileSync(
      "git",
      ["status", "--porcelain"],
      { cwd: repository, encoding: "utf8" },
    ).trim();
    const [npmCommand, versionArgs] = npmArgs(["--version"]);
    report.environment.npm = execFileSync(npmCommand, versionArgs, {
      encoding: "utf8",
      windowsHide: true,
    }).trim();
    temporary = await mkdtemp(join(tmpdir(), "sign-saber-release-drill-"));
    const clone = join(temporary, "repo");
    const command = (name, binary, args, cwd) =>
      step(name, () =>
        runCommand(
          binary,
          args,
          cwd,
          join(
            options.output,
            `${runStem}-${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.log`,
          ),
        ),
      );
    await command(
      "Clone current commit",
      "git",
      ["clone", "--no-hardlinks", "--no-checkout", repository, clone],
      repository,
    );
    await command(
      "Checkout tested SHA",
      "git",
      ["checkout", "--detach", report.commit],
      clone,
    );
    for (const args of [
      ["ci", "--cache", join(tmpdir(), "sign-saber-release-drill-npm-cache")],
      ["run", "check"],
      ["run", "build"],
    ]) {
      const [binary, npmCommandArgs] = npmArgs(args);
      await command(
        `npm ${args[0] === "ci" ? "ci" : args.join(" ")}`,
        binary,
        npmCommandArgs,
        join(clone, "app"),
      );
    }
    if (options.injectMissingAsset)
      await step(
        "Inject missing catalog asset into temporary prepared build",
        async () => {
          await rm(
            join(clone, "app", "dist", "assets", "tracks", "manifest.json"),
          );
          return {
            asset: "/assets/tracks/manifest.json",
            expectedFailure: true,
          };
        },
      );
    await browserJourney(clone, temporary, options, report, step);
    report.passed = report.steps.every((entry) => entry.passed);
  } catch (error) {
    report.failure = error.stack ?? error.message;
    console.error(error.message);
  } finally {
    if (temporary) {
      const target = resolve(temporary);
      if (
        !target.startsWith(resolve(tmpdir()) + sep) ||
        !basename(target).startsWith("sign-saber-release-drill-")
      )
        throw new Error(
          "Refusing cleanup outside the drill temporary directory",
        );
      try {
        await rm(target, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: POLL_MS,
        });
      } catch (error) {
        report.cleanupError = error.message;
        report.passed = false;
      }
    }
    report.notRun = [
      "Clone current commit",
      "Checkout tested SHA",
      "npm ci",
      "npm run check",
      "npm run build",
      "BOOT → SELECT offline",
      "Select song and enable sound with native CDP input",
      "Synthetic performer → genuine results",
      "Results → Retry → playing → pause → Songs",
      "Offline network, console and CSP assertions",
    ].filter((name) => !report.steps.some((entry) => entry.name === name));
    report.finishedAt = new Date().toISOString();
    await writeEvidence(report, options.output, stem);
    console.log(
      `${report.passed ? "PASS" : "FAIL"}: ${join(options.output, stem)}.{json,md}`,
    );
  }
  return report;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (!(await runDrill(parseOptions(process.argv.slice(2)))).passed)
      process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
