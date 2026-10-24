/** Regression for the worker-only CDP capability failure found by the release drill. */
import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { launchChrome } from "./cdp-client.mjs";
import { prepareTarget } from "./release-drill.mjs";

test(
  "real worker resumes, loads loopback and blocks external fetch before network",
  { timeout: 60_000 },
  async () => {
    const temporary = await mkdtemp(
      join(tmpdir(), "sign-saber-worker-regression-"),
    );
    const server = createServer((request, response) => {
      response.setHeader(
        "Content-Type",
        request.url === "/worker.js" ? "text/javascript" : "text/html",
      );
      response.end(
        request.url === "/worker.js"
          ? `Promise.all([fetch('/local').then(r=>r.text()),fetch('http://offline-release-drill.invalid/probe').then(()=>false,()=>true)]).then(result=>postMessage(result));`
          : request.url === "/local"
            ? "local ok"
            : `<script>new Worker('/worker.js').onmessage=event=>document.body.textContent=JSON.stringify(event.data)</script>`,
      );
    });
    await new Promise((done) => server.listen(0, "127.0.0.1", done));
    const origin = `http://127.0.0.1:${server.address().port}`;
    let chrome;
    try {
      chrome = await launchChrome({
        profile: join(temporary, "profile"),
        headless: true,
        args: [
          "--proxy-server=http://127.0.0.1:9",
          "--proxy-bypass-list=localhost;127.0.0.1;[::1]",
        ],
      });
      const cdp = chrome.browser;
      const requests = [];
      const blocked = [];
      let pageSession;
      let setupFailure;
      cdp.on((message) => {
        if (message.method === "Target.attachedToTarget") {
          void (async () => {
            await prepareTarget(
              cdp,
              message.params.sessionId,
              message.params.targetInfo.type,
              origin,
            );
            if (message.params.targetInfo.type === "page")
              pageSession = message.params.sessionId;
            await cdp.send(
              "Runtime.runIfWaitingForDebugger",
              {},
              message.params.sessionId,
            );
          })().catch((error) => {
            setupFailure = error;
          });
        } else if (message.method === "Fetch.requestPaused") {
          void cdp.send(
            "Fetch.continueRequest",
            { requestId: message.params.requestId },
            message.sessionId,
          );
        } else if (message.method === "Network.requestWillBeSent")
          requests.push({
            id: message.params.requestId,
            url: message.params.request.url,
          });
        else if (message.method === "Network.loadingFailed")
          blocked.push(message.params);
      });
      await cdp.send("Target.setAutoAttach", {
        autoAttach: true,
        waitForDebuggerOnStart: true,
        flatten: true,
        filter: [{ type: "page" }, { type: "worker" }, { exclude: true }],
      });
      await cdp.send("Target.createTarget", { url: "about:blank" });
      const poll = async (predicate) => {
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          if (setupFailure) throw setupFailure;
          const result = await predicate();
          if (result) return result;
          await new Promise((done) => setTimeout(done, 100));
        }
        throw new Error("Worker regression did not complete");
      };
      await poll(() => pageSession);
      await cdp.send("Page.navigate", { url: origin }, pageSession);
      const result = await poll(async () => {
        const response = await cdp.send(
          "Runtime.evaluate",
          { expression: "document.body?.textContent", returnByValue: true },
          pageSession,
        );
        const text = response.result.value;
        return text?.startsWith("[") ? JSON.parse(text) : null;
      });
      assert.deepEqual(result, ["local ok", true]);
      const attempted = requests.find(
        (request) =>
          request.url === "http://offline-release-drill.invalid/probe",
      );
      assert.ok(
        attempted,
        "the test must actually attempt its explicitly labelled external request",
      );
      assert.ok(
        blocked.some(
          (failure) =>
            failure.requestId === attempted.id &&
            failure.blockedReason === "inspector",
        ),
        "CDP must block the request; a DNS or proxy failure is insufficient",
      );
    } finally {
      if (chrome) await chrome.close();
      server.closeAllConnections();
      await new Promise((done) => server.close(done));
      const target = resolve(temporary);
      assert.ok(
        target.startsWith(resolve(tmpdir()) + sep) &&
          target.includes("sign-saber-worker-regression-"),
      );
      await rm(target, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 200,
      });
    }
  },
);
