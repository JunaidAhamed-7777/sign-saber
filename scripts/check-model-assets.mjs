#!/usr/bin/env node
/** Validate the actual GLB buffers, pivots, axes and manifest (not authoring predictions). */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return out;
}
function matrix(node) {
  if (node.matrix) return node.matrix;
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1],
    [sx, sy, sz] = node.scale ?? [1, 1, 1],
    [tx, ty, tz] = node.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy,
    0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}
const point = (m, p) => [
  m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
  m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
  m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
];
export function inspectGlb(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, "GLB magic");
  assert.equal(bytes.readUInt32LE(4), 2, "GLB version");
  assert.equal(bytes.readUInt32LE(8), bytes.length, "GLB byte length");
  let json;
  let bin;
  for (let offset = 12; offset < bytes.length;) {
    const size = bytes.readUInt32LE(offset),
      type = bytes.readUInt32LE(offset + 4);
    assert.ok(offset + 8 + size <= bytes.length, "chunk inside file");
    if (type === 0x4e4f534a)
      json = JSON.parse(
        bytes.subarray(offset + 8, offset + 8 + size).toString(),
      );
    if (type === 0x004e4942)
      bin = bytes.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size;
  }
  assert.equal(json.asset.version, "2.0");
  assert.ok(bin, "binary buffer");
  assert.equal(json.buffers.length, 1);
  assert.ok(!json.buffers[0].uri, "no external buffer");
  assert.ok(!json.images?.length && !json.textures?.length, "no textures");
  assert.ok(
    !json.animations?.length && !json.skins?.length && !json.cameras?.length,
    "no animation, skin or camera",
  );
  for (const material of json.materials ?? [])
    assert.ok(
      (material.emissiveFactor ?? [0, 0, 0]).every((x) => x === 0),
      "base-color assets have no emission",
    );
  const dimensions = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
  const componentBytes = { 5121: 1, 5123: 2, 5125: 4, 5126: 4 };
  function accessor(index) {
    const a = json.accessors[index],
      view = json.bufferViews[a.bufferView],
      n = dimensions[a.type],
      size = componentBytes[a.componentType];
    assert.ok(n && size && !a.sparse, "supported direct accessor");
    const stride = view.byteStride ?? n * size,
      start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    assert.ok(
      start + (a.count - 1) * stride + n * size <= bin.length,
      "accessor in BIN",
    );
    const values = [];
    for (let i = 0; i < a.count; i++) {
      const row = [];
      for (let j = 0; j < n; j++) {
        const at = start + i * stride + j * size;
        let value =
          a.componentType === 5126
            ? bin.readFloatLE(at)
            : a.componentType === 5125
              ? bin.readUInt32LE(at)
              : a.componentType === 5123
                ? bin.readUInt16LE(at)
                : bin.readUInt8(at);
        if (a.normalized) value /= a.componentType === 5121 ? 255 : 65535;
        assert.ok(Number.isFinite(value), "finite accessor");
        row.push(value);
      }
      values.push(row);
    }
    return values;
  }
  const instances = [];
  const nodeNames = [];
  function walk(index, parent) {
    const node = json.nodes[index],
      world = multiply(parent, matrix(node));
    nodeNames.push(node.name);
    for (const axis of [0, 1, 2])
      assert.ok(
        Math.abs(
          Math.hypot(
            world[axis * 4],
            world[axis * 4 + 1],
            world[axis * 4 + 2],
          ) - 1,
        ) < 1e-5,
        "applied unit scale",
      );
    if (node.mesh !== undefined) {
      const bounds = {
          min: [Infinity, Infinity, Infinity],
          max: [-Infinity, -Infinity, -Infinity],
        },
        triangles = [],
        colors = [];
      for (const primitive of json.meshes[node.mesh].primitives) {
        assert.equal(primitive.mode ?? 4, 4, "triangle primitives");
        const positions = accessor(primitive.attributes.POSITION).map((p) =>
            point(world, p),
          ),
          indices =
            primitive.indices === undefined
              ? positions.map((_, i) => i)
              : accessor(primitive.indices).map((v) => v[0]);
        assert.equal(indices.length % 3, 0);
        for (const p of positions)
          for (let axis = 0; axis < 3; axis++) {
            bounds.min[axis] = Math.min(bounds.min[axis], p[axis]);
            bounds.max[axis] = Math.max(bounds.max[axis], p[axis]);
          }
        for (let i = 0; i < indices.length; i += 3)
          triangles.push(indices.slice(i, i + 3).map((id) => positions[id]));
        if (primitive.attributes.COLOR_0 !== undefined)
          colors.push(...accessor(primitive.attributes.COLOR_0));
      }
      instances.push({
        name: node.name,
        bounds,
        triangles,
        colors,
        origin: point(world, [0, 0, 0]),
      });
    }
    for (const child of node.children ?? []) walk(child, world);
  }
  for (const index of json.scenes[json.scene ?? 0].nodes)
    walk(index, identity());
  return {
    json,
    instances,
    nodeNames,
    triangles: instances.reduce((n, i) => n + i.triangles.length, 0),
  };
}
function volumeAndCentroid(instance) {
  let volume = 0;
  const moment = [0, 0, 0],
    edges = new Map();
  const key = (p) => p.map((x) => Math.round(x * 1e6)).join(",");
  for (const [a, b, c] of instance.triangles) {
    const v =
      (a[0] * (b[1] * c[2] - b[2] * c[1]) +
        a[1] * (b[2] * c[0] - b[0] * c[2]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) /
      6;
    volume += v;
    for (let axis = 0; axis < 3; axis++)
      moment[axis] += (v * (a[axis] + b[axis] + c[axis])) / 4;
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const ka = key(u),
        kb = key(v),
        id = ka < kb ? ka + "|" + kb : kb + "|" + ka,
        entry = edges.get(id) ?? [0, 0];
      entry[0]++;
      entry[1] += ka < kb ? 1 : -1;
      edges.set(id, entry);
    }
  }
  assert.ok(
    [...edges.values()].every(
      ([count, balance]) => count === 2 && balance === 0,
    ),
    "closed consistently oriented welded mesh",
  );
  return { volume: Math.abs(volume), centroid: moment.map((x) => x / volume) };
}
export async function checkModelAssets({ khronos = null } = {}) {
  const manifest = JSON.parse(
    await readFile(
      resolve(root, "app/public/assets/models/manifest.json"),
      "utf8",
    ),
  );
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.upAxis, "Y");
  assert.equal(manifest.units, "metres");
  const ids = [
    "block_fractured",
    "armor",
    "beam_ring",
    "glyphs",
    "pylon",
    "arena_environment",
    "block_targets",
  ];
  // This generator's assets come first; entries from separate generators may follow.
  assert.deepEqual(
    manifest.assets.slice(0, ids.length).map((a) => a.id),
    ids,
  );
  const budgets = {
    block_fractured: 700,
    armor: 900,
    beam_ring: 900,
    glyphs: 1200,
    pylon: 600,
    arena_environment: 3000,
    block_targets: 400,
  };
  const reports = [];
  let totalTriangles = 0,
    totalBytes = 0;
  for (const entry of manifest.assets.filter((a) => ids.includes(a.id))) {
    const path = resolve(root, "app/public" + entry.path),
      bytes = await readFile(path);
    assert.equal(hash(bytes), entry.sha256, entry.id + " hash");
    assert.equal(bytes.length, entry.bytes, entry.id + " bytes");
    const glb = inspectGlb(bytes);
    assert.equal(glb.triangles, entry.triangles, entry.id + " triangle count");
    assert.ok(
      glb.triangles <= budgets[entry.id],
      entry.id + " triangle budget",
    );
    for (const name of entry.nodes)
      assert.ok(glb.nodeNames.includes(name), "missing semantic node " + name);
    if (entry.id === "block_fractured") {
      assert.equal(glb.instances.length, manifest.shardCount);
      let volume = 0;
      for (const instance of glb.instances) {
        assert.match(instance.name, /^shard_[0-9]{2}$/);
        assert.ok(
          Number(instance.name.slice(6)) < manifest.shardCount,
          "contiguous shard names",
        );
        const measured = volumeAndCentroid(instance);
        volume += measured.volume;
        for (let a = 0; a < 3; a++) {
          assert.ok(
            instance.bounds.min[a] >= -0.50001 &&
              instance.bounds.max[a] <= 0.50001,
            "unit cube extents",
          );
          assert.ok(
            Math.abs(measured.centroid[a] - instance.origin[a]) < 1e-5,
            "centroid pivot",
          );
        }
      }
      assert.ok(volume >= 0.98 && volume <= 1.02, "shard volume sum");
      assert.ok(
        glb.json.materials.some((m) => m.name === "inner") &&
          glb.json.materials.some((m) => m.name === "outer"),
        "inner/outer materials",
      );
    }
    if (entry.id === "glyphs")
      for (const instance of glb.instances) {
        assert.match(instance.name, /^glyph_(palm|fist|point|arrow)$/);
        assert.ok(instance.triangles.length <= 400);
        assert.ok(
          instance.bounds.max[0] - instance.bounds.min[0] <= 0.80001 &&
            instance.bounds.max[1] - instance.bounds.min[1] <= 0.80001,
          "upright XY glyph bounds",
        );
        assert.ok(
          Math.abs(instance.bounds.max[2] - instance.bounds.min[2] - 0.04) <
            1e-5,
          "glyph thickness",
        );
        volumeAndCentroid(instance);
      }
    if (entry.id === "pylon") {
      const pylon = glb.instances[0];
      assert.ok(
        Math.abs(pylon.bounds.min[1]) < 1e-6 &&
          Math.abs(pylon.bounds.max[1] - 6) < 1e-6,
        "pylon +Y axis and base pivot",
      );
      assert.ok(
        pylon.colors.some((c) => c[0] > 0.9) &&
          pylon.colors.some((c) => c[0] < 0.1),
        "pylon COLOR_0 strip mask",
      );
      volumeAndCentroid(pylon);
    }
    if (entry.id === "armor" || entry.id === "beam_ring")
      for (const instance of glb.instances) volumeAndCentroid(instance);
    if (entry.id === "block_targets") {
      for (const instance of glb.instances) {
        volumeAndCentroid(instance);
        for (let a = 0; a < 3; a++)
          assert.ok(
            instance.bounds.min[a] >= -0.50001 &&
              instance.bounds.max[a] <= 0.50001,
            "target body inside the unit cube",
          );
      }
      for (const name of ["block_slash", "block_orb"]) {
        const body = glb.instances.find((i) => i.name === name);
        assert.ok(body, "missing target body " + name);
        assert.ok(
          body.colors.some((c) => c[0] > 0.9) &&
            body.colors.some((c) => c[0] < 0.1),
          name + " COLOR_0 trim mask",
        );
      }
      // Distinct silhouettes: the slash slab is thin in depth, the orb is round.
      const slab = glb.instances.find((i) => i.name === "block_slash").bounds;
      assert.ok(
        slab.max[2] - slab.min[2] < 0.5 * (slab.max[0] - slab.min[0]),
        "thin slash slab",
      );
    }
    if (entry.id === "arena_environment") {
      for (const i of glb.instances) {
        const b = i.bounds;
        assert.ok(
          !(
            b.max[0] > -3 &&
            b.min[0] < 3 &&
            b.max[1] > 0 &&
            b.min[1] < 3 &&
            b.max[2] > -5 &&
            b.min[2] < 4
          ),
          "central human stage is clear: " + i.name,
        );
      }
    }
    let validation = null;
    if (khronos) {
      const module = await import(pathToFileURL(resolve(khronos)).href),
        validator = module.validateBytes ? module : module.default;
      const result = await validator.validateBytes(new Uint8Array(bytes), {
        uri: entry.path,
        maxIssues: 1000,
      });
      validation = {
        validatorVersion: validator.version(),
        errors: result.issues.numErrors,
        warnings: result.issues.numWarnings,
        infos: result.issues.numInfos,
        messages: result.issues.messages,
      };
      assert.equal(validation.errors, 0, entry.id + " Khronos errors");
    }
    reports.push({
      id: entry.id,
      nodes: entry.nodes,
      instances: glb.instances.map((i) => ({
        name: i.name,
        bounds: i.bounds,
        origin: i.origin,
        unitScale: true,
      })),
      triangles: glb.triangles,
      bytes: bytes.length,
      sha256: entry.sha256,
      khronos: validation,
    });
    totalTriangles += glb.triangles;
    totalBytes += bytes.length;
  }
  assert.equal(
    manifest.assets.reduce((n, a) => n + a.triangles, 0),
    manifest.totalTriangles,
  );
  assert.equal(
    manifest.assets.reduce((n, a) => n + a.bytes, 0),
    manifest.totalGlbBytes,
  );
  assert.ok(
    totalTriangles <= 6000 && totalBytes <= 1024 * 1024,
    "combined asset budgets",
  );
  const blend = await readFile(resolve(root, manifest.sourceBlend));
  assert.ok(
    blend.subarray(0, 7).toString() === "BLENDER" ||
      blend.readUInt32LE(0) === 0xfd2fb528,
    "saved .blend or Blender Zstandard container",
  );
  assert.equal(hash(blend), manifest.sourceBlendSha256, "saved blend hash");
  assert.equal(
    hash(await readFile(resolve(root, manifest.sourceGenerator))),
    manifest.sourceGeneratorSha256,
    "source generator hash",
  );
  const report = {
    schemaVersion: 1,
    checkedAt: new Date().toISOString(),
    authoringRoute: manifest.authoringRoute,
    blenderVersion: manifest.blenderVersion,
    shardMode: manifest.fractureMode,
    assets: reports,
    totalTriangles,
    totalBytes,
    sourceBlendSha256: hash(blend),
    scope:
      "Structural buffers/pivots/axis/budgets/hashes only; browser appearance and live gameplay remain separate checks.",
  };
  return report;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const arg = process.argv.find((a) => a.startsWith("--khronos="));
  const report = await checkModelAssets({
    khronos: arg?.slice("--khronos=".length) ?? null,
  });
  const output = resolve(root, "app/public/assets/models/validation.json");
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  if (arg)
    await writeFile(
      resolve(root, "app/public/assets/models/khronos-validation.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  console.log(
    `Validated ${report.assets.length} authored GLBs: ${report.totalTriangles} triangles, ${report.totalBytes} bytes; Khronos=${!!arg}`,
  );
}
