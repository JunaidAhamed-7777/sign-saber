#!/usr/bin/env node
// Browser-native numeric checks, separate from webcam, audible playback and latency evidence.
import { createRequire } from "node:module";
import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { decodeCanonicalPcm } from "./music-pcm.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(new URL("../app/package.json", import.meta.url));
const { build } = await import(pathToFileURL(require.resolve("vite")).href);
const run = promisify(execFile);
const browser =
  process.argv[2] ||
  process.env.BROWSER_BINARY ||
  (process.platform === "win32"
    ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
    : "google-chrome");
const temp = await mkdtemp(path.join(tmpdir(), "sign-saber-resample-"));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
let server;
const waiters = new Set();
try {
  const result = await build({
    configFile: false,
    root: path.join(root, "app"),
    logLevel: "error",
    build: {
      write: false,
      minify: false,
      lib: {
        entry: path.join(root, "app/tests/browser/resampling.ts"),
        formats: ["iife"],
        name: "SignSaberAudioCheck",
      },
    },
  });
  const bundle = (Array.isArray(result) ? result[0] : result).output.find(
    (item) => item.type === "chunk",
  ).code;
  const prefixes = new Map();
  for (const slug of ["pamgaea", "electro-cabello", "cipher"]) {
    const { pcm } = await decodeCanonicalPcm(
      path.join(root, "app/public/assets/tracks", slug, "audio.mp3"),
      temp,
      22050,
    );
    prefixes.set(
      slug,
      pcm.subarray(0, 22050 * 2 * Float32Array.BYTES_PER_ELEMENT),
    );
  }
  const html =
    '<!doctype html><meta charset="utf-8"><pre id="result">pending</pre><iframe hidden src="/wait"></iframe><script>' +
    bundle +
    "</script>";
  let payload = "";
  server = createServer(async (req, res) => {
    try {
      if (req.url === "/") {
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(html);
      } else if (req.url === "/wait") {
        waiters.add(res);
        req.on("close", () => waiters.delete(res));
      } else if (req.url === "/result" && req.method === "POST") {
        req.setEncoding("utf8");
        req.on("data", (chunk) => {
          payload += chunk;
          if (payload.length > 16 * 1024 * 1024)
            req.destroy(new Error("Oversized test result"));
        });
        req.on("end", () => {
          res.end("ok");
          for (const waiter of waiters) waiter.end("complete");
          waiters.clear();
        });
      } else if (req.url?.startsWith("/canonical-start/")) {
        const bytes = prefixes.get(req.url.slice("/canonical-start/".length));
        if (!bytes) {
          res.statusCode = 404;
          res.end();
        } else res.end(bytes);
      } else if (
        req.url === "/assets/tracks/manifest.json" ||
        /^\/assets\/tracks\/(pamgaea|electro-cabello|cipher)\/audio\.mp3$/.test(
          req.url ?? "",
        )
      ) {
        res.end(
          await readFile(path.join(root, "app/public", req.url.slice(1))),
        );
      } else {
        res.statusCode = 404;
        res.end();
      }
    } catch (error) {
      res.statusCode = 500;
      res.end(error instanceof Error ? error.message : "Test fixture failure");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await run(
    browser,
    [
      "--headless",
      "--disable-extensions",
      "--no-first-run",
      "--no-default-browser-check",
      "--user-data-dir=" + path.join(temp, "profile"),
      "--dump-dom",
      `http://127.0.0.1:${address.port}/`,
    ],
    { windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024 },
  );
  if (!payload)
    throw new Error("Browser did not finish the offline-audio checks");
  const report = JSON.parse(payload);
  report.recordedAt = new Date().toISOString();
  report.gitHead = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  report.dirtyTree = !!execFileSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  report.functionSourceSha256 = sha(
    await readFile(path.join(root, "app/src/beatmap/dsp/resample.ts")),
  );
  report.testSourceSha256 = sha(
    await readFile(path.join(root, "app/tests/browser/resampling.ts")),
  );
  report.constantsSourceSha256 = sha(
    await readFile(path.join(root, "app/src/core/constants.ts")),
  );
  report.lockfileSha256 = sha(
    await readFile(path.join(root, "app/package-lock.json")),
  );
  const assetBytes = await readFile(
    path.join(root, "app/public/assets/tracks/manifest.json"),
  );
  const assetManifest = JSON.parse(assetBytes);
  report.assetsManifestSha256 = sha(assetBytes);
  report.musicAssets = assetManifest.tracks.map((track) => ({
    slug: track.slug,
    generatorVersion: track.generatorVersion,
    ...track.hashes,
  }));
  report.scope =
    "Synthetic native OfflineAudioContext correctness only. No microphone/camera/audio-output permission requested; no webcam, audible playback, physical latency or musical quality claim.";
  const output = path.join(
    root,
    "app/tests/fixtures/audio/resample-browser-result.json",
  );
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(
    `${report.checks.length} browser audio checks; passed=${report.passed}; ${report.userAgent ?? ""}`,
  );
  if (!report.passed) {
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  }
} finally {
  for (const waiter of waiters) waiter.end("test ended");
  server?.closeAllConnections();
  if (server) await new Promise((resolve) => server.close(resolve));
  const resolved = path.resolve(temp),
    base = path.resolve(tmpdir()) + path.sep;
  if (
    !resolved.startsWith(base) ||
    !path.basename(resolved).startsWith("sign-saber-resample-")
  )
    throw new Error("Refusing cleanup outside the test temp directory");
  await rm(resolved, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 200,
  });
}
