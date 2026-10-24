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
  assert.equal(report.assets.length, 7);
  assert.ok(report.totalTriangles <= 6000 && report.totalBytes <= 1024 * 1024);
  assert.match(report.authoringRoute, /Blender MCP/);
  assert.match(report.shardMode, /14-cell Voronoi/);
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
test("exported shards contain both surface materials and fourteen distinct semantic nodes", async () => {
  const glb = inspectGlb(await readFile(asset));
  assert.deepEqual(
    glb.nodeNames.slice().sort(),
    Array.from({ length: 14 }, (_, i) => "shard_" + String(i).padStart(2, "0")),
  );
  assert.ok(glb.json.materials.some((material) => material.name === "inner"));
  assert.ok(glb.json.materials.some((material) => material.name === "outer"));
  assert.ok(glb.triangles > 14 * 12 && glb.triangles <= 700);
  // Irregular cells: not every shard is the same eight-octant cube.
  const counts = new Set(glb.instances.map((i) => i.triangles.length));
  assert.ok(counts.size > 1);
});
