import test from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  isLocalRequest,
  parseOptions,
  reportSummary,
  writeEvidence,
} from "./release-drill.mjs";
import { CdpConnection } from "./cdp-client.mjs";

test("offline request policy permits loopback and local data, rejects outside destinations", () => {
  for (const url of [
    "http://127.0.0.1:4173/",
    "https://localhost/a",
    "ws://127.12.3.4/",
    "http://[::1]:4173/",
    "blob:http://localhost/identifier",
    "data:image/png;base64,abc",
    "about:blank",
  ])
    assert.equal(isLocalRequest(url), true, url);
  for (const url of [
    "https://example.com",
    "http://localhost.evil.test",
    "http://127.0.0.1.evil.test",
    "http://localhost@external.test",
    "file:///outside",
    "not a URL",
  ])
    assert.equal(isLocalRequest(url), false, url);
});

test("options reject unknown flags and missing values, keep output directories explicit", () => {
  const options = parseOptions(
    [
      "--output-dir",
      "reports",
      "--browser",
      "my-chrome",
      "--inject-missing-asset",
    ],
    process.cwd(),
  );
  assert.equal(options.output, resolve("reports"));
  assert.equal(options.browser, "my-chrome");
  assert.equal(options.injectMissingAsset, true);
  assert.throws(() => parseOptions(["--output-dir"]), /Missing value/);
  assert.throws(
    () => parseOptions(["--browser", "--inject-missing-asset"]),
    /Missing value/,
  );
  assert.throws(() => parseOptions(["--skip-checks"]), /Unknown option/);
});

test("failure summary retains command failures, unrun results and camera exclusion", () => {
  const report = {
    recordedAt: "2026-10-25T00:00:00Z",
    passed: false,
    commit: "abc123",
    environment: { node: "v22", npm: "10", os: "test" },
    steps: [
      {
        name: "npm ci",
        passed: false,
        durationMs: 12,
        exitCode: 1,
        error: "missing\nasset",
      },
    ],
    failure: "failure",
  };
  const summary = reportSummary(report);
  assert.match(summary, /\*\*FAIL\*\*/);
  assert.match(summary, /FAIL — npm ci \(12 ms; exit 1\): missing asset/);
  assert.match(summary, /Synthetic performer results: not reached/);
  assert.match(summary, /Camera paths are out of scope/);
  assert.match(summary, /Unreached checks are not passes/);
  assert.match(
    reportSummary({ ...report, cleanupError: "EBUSY locked profile" }),
    /Temporary-directory cleanup failed: EBUSY locked profile/,
  );
});

test("writing a later attempt preserves the previous failure report and summary", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sign-saber-evidence-test-"));
  try {
    const first = {
      recordedAt: "2026-10-25T00:00:00Z",
      passed: false,
      commit: "abc",
      environment: { node: "v22", npm: "10", os: "test" },
      steps: [],
      failure: "missing asset",
    };
    await writeEvidence(first, directory, "release-drill");
    const original = await readFile(
      join(directory, "release-drill.json"),
      "utf8",
    );
    await writeEvidence(
      {
        ...first,
        recordedAt: "2026-10-25T01:00:00Z",
        passed: true,
        failure: undefined,
      },
      directory,
      "release-drill",
    );
    const files = await readdir(directory);
    const archive = files.find((name) =>
      /^release-drill-previous-.*\.json$/.test(name),
    );
    assert.ok(archive);
    assert.equal(await readFile(join(directory, archive), "utf8"), original);
    assert.match(
      await readFile(
        join(directory, archive.replace(/\.json$/, ".md")),
        "utf8",
      ),
      /missing asset/,
    );
    assert.equal(
      JSON.parse(await readFile(join(directory, "release-drill.json"), "utf8"))
        .passed,
      true,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

class FakeSocket extends EventTarget {
  sent = [];
  send(value) {
    this.sent.push(JSON.parse(value));
  }
  close() {
    this.dispatchEvent(new Event("close"));
  }
  receive(value) {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(value) }),
    );
  }
}

test("CDP client correlates commands, sessions and events and rejects protocol errors", async () => {
  const socket = new FakeSocket();
  const client = new CdpConnection(socket);
  const command = client.send("Runtime.enable", {}, "worker-session");
  assert.deepEqual(socket.sent[0], {
    id: 1,
    method: "Runtime.enable",
    params: {},
    sessionId: "worker-session",
  });
  socket.receive({ id: 1, result: { enabled: true } });
  assert.deepEqual(await command, { enabled: true });
  let event;
  client.listeners.add((value) => {
    event = value;
  });
  socket.receive({
    method: "Fetch.requestPaused",
    params: { requestId: "one" },
    sessionId: "worker-session",
  });
  assert.equal(event.params.requestId, "one");
  const failure = client.send("Unknown.method");
  socket.receive({ id: 2, error: { message: "Unknown method" } });
  await assert.rejects(failure, /Unknown method/);
  const closed = client.send("Pending.method");
  client.close();
  await assert.rejects(closed, /CDP socket closed/);
});
