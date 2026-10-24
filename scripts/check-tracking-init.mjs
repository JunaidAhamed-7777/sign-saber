#!/usr/bin/env node
// Native browser/worker initialization only. No getUserMedia, pixels or fabricated frames.
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, basename, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createStaticHandler } from "./serve.mjs";
import { securityHeaders, productionCsp } from "./security-headers.mjs";
const root = fileURLToPath(new URL("../", import.meta.url));
const dist = join(root, "app", "dist");
const name = (await readdir(join(dist, "assets"))).find((name) =>
  /^tracking\.worker-.*\.js$/.test(name),
);
if (!name) throw new Error("Build the tracking worker first.");
const temp = await mkdtemp(join(tmpdir(), "sign-saber-tracking-init-"));
const forceCpu = process.argv.includes("--cpu");
const browser =
  process.argv.slice(2).find((arg) => !arg.startsWith("--")) ||
  (process.platform === "win32"
    ? "C:/Program Files/Google/Chrome/Application/chrome.exe"
    : "google-chrome");
const run = promisify(execFile);
const waiters = new Set();
let payload = "";
let server;
try {
  const serve = createStaticHandler({ root: dist });
  const script = `let finished=false;let initialization=null;let seq=0;const samples=[];const worker=new Worker('/assets/${name}',{type:'module'});async function sendFrame(){const canvas=new OffscreenCanvas(640,360);const ctx=canvas.getContext('2d');ctx.fillStyle='#777';ctx.fillRect(0,0,640,360);const bitmap=await createImageBitmap(canvas);worker.postMessage({type:'frame',seq:seq++,tCapture:performance.now(),bitmap},[bitmap]);}async function done(result){if(finished)return;finished=true;const payload={scope:'headless worker initialization and three explicitly synthetic blank images; no webcam or human tracking/throughput claim',userAgent:navigator.userAgent,initialization,result,samples};document.querySelector('pre').textContent=JSON.stringify(payload);await fetch('/result',{method:'POST',body:JSON.stringify(payload)});worker.postMessage({type:'dispose'});}worker.onmessage=async e=>{const m=e.data;if(m.type==='ready'){initialization=m;await sendFrame();}else if(m.type==='result'){const f=m.frame;samples.push({seq:f.seq,inferenceMs:f.inferenceMs,callbackToInferDoneMs:f.tInferDone-f.tCapture,hands:f.hands.length,pose:!!f.pose,mask:!!f.mask});const b=m.buffers;worker.postMessage({type:'recycle',buffers:b},[b.handLm[0].buffer,b.handLm[1].buffer,b.handWorld[0].buffer,b.handWorld[1].buffer,b.poseLm.buffer,b.poseWorld.buffer,b.mask.buffer]);if(samples.length<3)await sendFrame();else void done({type:'result'});}else if(m.type==='error')void done(m);};worker.onerror=e=>void done({type:'native-worker-error',message:e.message,filename:e.filename,line:e.lineno});worker.postMessage({type:'init',mainTimeOrigin:performance.timeOrigin${forceCpu ? ",preferredDelegate:'CPU'" : ""}});setTimeout(()=>void done({type:'timeout'}),20000);`;
  server = createServer(async (request, response) => {
    for (const [key, value] of Object.entries(securityHeaders))
      response.setHeader(key, value);
    if (request.url === "/") {
      response.setHeader(
        "Content-Security-Policy",
        productionCsp.replace("frame-src 'none'", "frame-src 'self'"),
      );
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(
        '<!doctype html><title>Tracking init probe, no camera</title><pre>pending</pre><iframe hidden src="/wait"></iframe><script type="module" src="/probe.mjs"></script>',
      );
    } else if (request.url === "/probe.mjs") {
      response.setHeader("Content-Type", "text/javascript");
      response.end(script);
    } else if (request.url === "/wait") {
      waiters.add(response);
      request.on("close", () => waiters.delete(response));
    } else if (request.url === "/result" && request.method === "POST") {
      request.setEncoding("utf8");
      request.on("data", (chunk) => {
        payload += chunk;
        if (payload.length > 65536)
          request.destroy(new Error("Oversized diagnostic result"));
      });
      request.on("end", () => {
        response.end("ok");
        for (const waiter of waiters) waiter.end("complete");
        waiters.clear();
      });
    } else void serve(request, response);
  });
  await new Promise((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  const { port } = server.address();
  const { stderr } = await run(
    browser,
    [
      "--headless",
      "--disable-extensions",
      "--no-first-run",
      "--no-default-browser-check",
      "--user-data-dir=" + join(temp, "profile"),
      "--dump-dom",
      `http://127.0.0.1:${port}/`,
    ],
    { windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
  );
  if (!payload)
    throw new Error("No browser initialization result. " + stderr.slice(-2000));
  const report = JSON.parse(payload);
  console.log(JSON.stringify(report, null, 2));
  if (report.result.type !== "result") process.exitCode = 1;
} finally {
  for (const waiter of waiters) waiter.end("finished");
  server?.closeAllConnections();
  if (server) await new Promise((done) => server.close(done));
  const target = resolve(temp);
  if (
    !target.startsWith(resolve(tmpdir()) + sep) ||
    !basename(target).startsWith("sign-saber-tracking-init-")
  )
    throw new Error("Refusing cleanup outside diagnostic temp directory");
  await rm(target, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 200,
  });
}
