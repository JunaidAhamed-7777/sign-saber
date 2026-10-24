#!/usr/bin/env node
/** Prepare a versioned, verified local runtime; no size-only cache acceptance. */
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { modelAssets } from "./model-assets.mjs";
const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "app");
const outDir = join(appDir, "public", "models");
const wasmOut = join(outDir, "wasm");
const args = new Set(process.argv.slice(2));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function atomicWrite(path, data) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, data);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
await mkdir(wasmOut, { recursive: true });
const require = createRequire(join(appDir, "package.json"));
// package.json is not in the package's exports map. Resolve the public entry.
const packageDir = dirname(require.resolve("@mediapipe/tasks-vision"));
const pkg = JSON.parse(
  await readFile(join(packageDir, "package.json"), "utf8"),
);
const files = [];
for (const name of (await readdir(join(packageDir, "wasm"))).sort()) {
  const bytes = await readFile(join(packageDir, "wasm", name));
  await atomicWrite(join(wasmOut, name), bytes);
  files.push({
    path: `wasm/${name}`,
    bytes: bytes.length,
    sha256: sha256(bytes),
    source: `@mediapipe/tasks-vision@${pkg.version}`,
    license: "Apache-2.0",
  });
}
await atomicWrite(join(wasmOut, "VERSION"), `${pkg.version}\n`);
for (const model of modelAssets) {
  if (model.optional && !args.has("--with-segmenter")) continue;
  const dest = join(outDir, model.file);
  let bytes = null;
  try {
    if (!args.has("--force")) bytes = await readFile(dest);
  } catch {
    /* Missing is a cache miss. */
  }
  if (
    !bytes ||
    bytes.length !== model.bytes ||
    sha256(bytes) !== model.sha256
  ) {
    console.log(`${model.file}: downloading pinned revision 1`);
    const response = await fetch(model.url, {
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`${model.file}: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== model.bytes || sha256(bytes) !== model.sha256)
      throw new Error(
        `${model.file}: integrity mismatch; existing asset was preserved`,
      );
    // Task models are ZIP containers; TFLite starts with its flatbuffer identifier.
    const zipHeader = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    const formatOk = model.file.endsWith(".task")
      ? zipHeader >= 0 && zipHeader <= 4
      : bytes.subarray(4, 8).toString() === "TFL3";
    if (!formatOk) throw new Error(`${model.file}: invalid file signature`);
    await atomicWrite(dest, bytes);
  } else console.log(`${model.file}: SHA-256 verified`);
  files.push({
    path: model.file,
    bytes: bytes.length,
    sha256: model.sha256,
    source: model.url,
    modelCard: model.modelCard,
    license: "Apache-2.0",
    licenseSource: model.modelCard,
  });
}
await atomicWrite(
  join(outDir, "asset-manifest.json"),
  `${JSON.stringify({ schemaVersion: 1, package: `@mediapipe/tasks-vision@${pkg.version}`, files }, null, 2)}\n`,
);
await atomicWrite(
  join(outDir, "LICENSE-APACHE-2.0.txt"),
  await readFile(new URL("./MEDIAPIPE-LICENSE.txt", import.meta.url)),
);
console.log(`Prepared ${files.length} verified assets in ${outDir}`);
