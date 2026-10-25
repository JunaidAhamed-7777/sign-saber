import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  checkChunks,
  MAX_JS_CHUNK_BYTES,
  parseArguments,
  readChunks,
} from "./check-bundle.mjs";

test("argument parser accepts one path and rejects unknown flags / extra paths", () => {
  assert.equal(parseArguments(["fixture assets"]), resolve("fixture assets"));
  assert.match(parseArguments([]), /app[\\/]dist[\\/]assets$/);
  assert.throws(() => parseArguments(["--skip"]), /Usage/);
  assert.throws(() => parseArguments(["a", "b"]), /Usage/);
});

test("budget includes exact boundary and rejects oversized, missing, invalid sizes", () => {
  const atLimit = { file: "main.js", bytes: MAX_JS_CHUNK_BYTES };
  const overLimit = { file: "worker.js", bytes: MAX_JS_CHUNK_BYTES + 1 };
  assert.deepEqual(checkChunks([atLimit, overLimit]), [overLimit]);
  assert.throws(() => checkChunks([]), /No JavaScript/);
  assert.throws(
    () => checkChunks([{ file: "bad.js", bytes: NaN }]),
    /Invalid size/,
  );
  assert.throws(() => checkChunks([atLimit], 0), /Invalid bundle budget/);
});

test("emitted parser reads JS and nested workers, ignores maps, and CLI fails on excess", async () => {
  const directory = await mkdtemp(join(tmpdir(), "sign-saber-bundle-test-"));
  try {
    await mkdir(join(directory, "nested"));
    await writeFile(join(directory, "main.js"), "export const a=1;");
    await writeFile(
      join(directory, "nested", "worker.mjs"),
      "self.postMessage(1);",
    );
    await writeFile(join(directory, "main.js.map"), "ignored");
    await writeFile(join(directory, "style.css"), "ignored");
    const chunks = await readChunks(directory);
    assert.deepEqual(
      chunks.map((chunk) => chunk.file),
      ["main.js", "nested/worker.mjs"],
    );
    assert.equal(chunks[0].bytes, 17);
    assert.ok(chunks.every((chunk) => chunk.gzipBytes > 0));
    const script = fileURLToPath(
      new URL("./check-bundle.mjs", import.meta.url),
    );
    assert.equal(spawnSync(process.execPath, [script, directory]).status, 0);
    await writeFile(
      join(directory, "large.js"),
      Buffer.alloc(MAX_JS_CHUNK_BYTES + 1),
    );
    const failed = spawnSync(process.execPath, [script, directory], {
      encoding: "utf8",
    });
    assert.equal(failed.status, 1);
    assert.match(failed.stdout, /large.js: 500001 bytes.*OVER BUDGET/);
    assert.match(failed.stderr, /exceed 500000/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
