import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { checkModelAssets, inspectGlb } from "./check-model-assets.mjs";
const asset = new URL(
  "../app/public/assets/models/block_fractured.glb",
  import.meta.url,
);
test("authored GLBs satisfy the actual node, pivot, volume, axis, clear-stage and payload contracts", async () => {
  const report = await checkModelAssets();
  assert.equal(report.assets.length, 6);
  assert.ok(report.totalTriangles <= 6000 && report.totalBytes <= 1024 * 1024);
  assert.match(report.authoringRoute, /Blender MCP/);
  assert.match(report.shardMode, /eight-octant/);
});
test("rejects corrupt GLB header, version and declared length", async () => {
  for (const [offset, value] of [
    [0, 0],
    [4, 1],
    [8, 24],
  ]) {
    const corrupt = Buffer.from(await readFile(asset));
    corrupt.writeUInt32LE(value, offset);
    assert.throws(() => inspectGlb(corrupt));
  }
});
test("exported shards contain both surface materials and eight distinct semantic nodes", async () => {
  const glb = inspectGlb(await readFile(asset));
  assert.deepEqual(
    glb.nodeNames.slice().sort(),
    Array.from({ length: 8 }, (_, i) => "shard_0" + i),
  );
  assert.ok(glb.json.materials.some((material) => material.name === "inner"));
  assert.ok(glb.json.materials.some((material) => material.name === "outer"));
  assert.equal(glb.triangles, 96);
});
