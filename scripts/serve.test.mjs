import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep, basename } from "node:path";
import { createStaticServer, parseRange } from "./serve.mjs";
import { productionCsp, developmentCsp } from "./security-headers.mjs";
let directory;
let server;
let url;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), "sign-saber-serve-"));
  const root = join(directory, "dist");
  await mkdir(join(root, "assets"), { recursive: true });
  await Promise.all([
    writeFile(
      join(root, "index.html"),
      "<!doctype html><title>Fixture</title>",
    ),
    writeFile(
      join(root, "assets", "worker.js"),
      "export const fixture = true;",
    ),
    writeFile(
      join(root, "assets", "vision.wasm"),
      Buffer.from([0, 97, 115, 109]),
    ),
    writeFile(join(root, "audio.mp3"), "0123456789"),
    writeFile(join(directory, "secret.txt"), "outside"),
  ]);
  server = createStaticServer({ root });
  await new Promise((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  url = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) {
    server.closeIdleConnections();
    await new Promise((done) => server.close(done));
  }
  if (directory) {
    const target = resolve(directory);
    const parent = resolve(tmpdir());
    assert.ok(
      target.startsWith(parent + sep) &&
        basename(target).startsWith("sign-saber-serve-"),
    );
    await rm(target, { recursive: true, force: true });
  }
});
test("production and worker responses enforce self-only network and correct MIME", async () => {
  for (const [path, mime] of [
    ["/", "text/html"],
    ["/assets/worker.js", "text/javascript"],
    ["/assets/vision.wasm", "application/wasm"],
  ]) {
    const response = await fetch(url + path);
    assert.equal(response.status, 200);
    assert.equal(
      response.headers.get("content-security-policy"),
      productionCsp,
    );
    assert.ok(response.headers.get("content-type").startsWith(mime));
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    await response.arrayBuffer();
  }
  assert.match(productionCsp, /connect-src 'self';/);
  assert.doesNotMatch(productionCsp, /https:|unsafe-inline.*script-src|ws:/);
  assert.match(developmentCsp, /ws:\/\/localhost:5173/);
  assert.doesNotMatch(developmentCsp, /wss:|ws:\/\/\*/);
  const imported = await fetch(url + "/assets/worker.js?import");
  assert.equal(imported.status, 200);
  assert.equal(await imported.text(), "export const fixture = true;");
});
test("serves explicit audio ranges, suffix ranges and HEAD without losing CSP", async () => {
  const part = await fetch(url + "/audio.mp3", {
    headers: { Range: "bytes=2-5" },
  });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(part.headers.get("content-type"), "audio/mpeg");
  assert.equal(await part.text(), "2345");
  const suffix = await fetch(url + "/audio.mp3", {
    headers: { Range: "bytes=-3" },
  });
  assert.equal(suffix.status, 206);
  assert.equal(await suffix.text(), "789");
  const head = await fetch(url + "/audio.mp3", {
    method: "HEAD",
    headers: { Range: "bytes=0-4" },
  });
  assert.equal(head.status, 206);
  assert.equal(head.headers.get("content-length"), "5");
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  assert.equal(head.headers.get("content-security-policy"), productionCsp);
});
test("rejects invalid ranges and write methods", async () => {
  const bad = await fetch(url + "/audio.mp3", {
    headers: { Range: "bytes=100-200" },
  });
  assert.equal(bad.status, 416);
  assert.equal(bad.headers.get("content-range"), "bytes */10");
  await bad.text();
  const write = await fetch(url + "/audio.mp3", {
    method: "PUT",
    body: "overwrite",
  });
  assert.equal(write.status, 405);
  assert.equal(write.headers.get("allow"), "GET, HEAD");
  await write.text();
  const original = await fetch(url + "/audio.mp3");
  assert.equal(await original.text(), "0123456789");
});
test("blocks encoded traversal and malformed URLs, keeps missing assets separate from navigation", async () => {
  for (const path of [
    "/%2e%2e%2fsecret.txt",
    "/assets/%2e%2e%2f%2e%2e%2fsecret.txt",
  ]) {
    const response = await fetch(url + path);
    assert.equal(response.status, 403);
    await response.text();
  }
  const invalid = await fetch(url + "/%ZZ");
  assert.equal(invalid.status, 400);
  await invalid.text();
  const missing = await fetch(url + "/missing.json", {
    headers: { Accept: "text/html" },
  });
  assert.equal(missing.status, 404);
  await missing.text();
  const navigation = await fetch(url + "/practice", {
    headers: { Accept: "text/html" },
  });
  assert.equal(navigation.status, 200);
  assert.match(await navigation.text(), /Fixture/);
});
test("blocks a symlink escaping the prepared root when symlinks are supported", async (t) => {
  try {
    await symlink(
      join(directory, "secret.txt"),
      join(directory, "dist", "leak.txt"),
    );
  } catch (error) {
    if (error.code === "EPERM" || error.code === "ENOTSUP") {
      t.skip("Host does not permit symlink creation.");
      return;
    }
    throw error;
  }
  const response = await fetch(url + "/leak.txt");
  assert.equal(response.status, 403);
  await response.text();
});
test("range parser rejects ambiguous/multiple/unsafe values", () => {
  assert.equal(parseRange("bytes=0-1,3-4", 10), false);
  assert.equal(parseRange("bytes=-0", 10), false);
  assert.equal(parseRange("bytes=4-2", 10), false);
  assert.equal(parseRange("bytes=9999999999999999999999-", 10), false);
  assert.deepEqual(parseRange("bytes=0-100", 10), { start: 0, end: 9 });
});
