import test from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync, crc32 } from "node:zlib";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  KEYPOINTS,
  RULES,
  planCrop,
  cropKeypoints,
  seededOrder,
  readZipMember,
  calibrationFromSweep,
} from "./prepare-dataset-camera.mjs";

/** A frontal, upright synthetic person in a 640×480 photo (source pixels, COCO visibility 2). */
function person(overrides = {}) {
  const at = {
    nose: [320, 140],
    left_eye: [330, 130],
    right_eye: [310, 130],
    left_ear: [340, 135],
    right_ear: [300, 135],
    left_shoulder: [370, 200],
    right_shoulder: [270, 200],
    left_elbow: [390, 260],
    right_elbow: [250, 260],
    left_wrist: [395, 310],
    right_wrist: [245, 310],
    left_hip: [350, 330],
    right_hip: [290, 330],
    ...overrides,
  };
  return {
    width: 640,
    height: 480,
    bbox: [230, 90, 180, 300],
    keypoints: KEYPOINTS.map((name) => [...at[name], 2]),
  };
}

test("plans a 16:9 head-to-hips crop inside the image with calibration-range shoulder scale", () => {
  const plan = planCrop(person());
  assert.ok(!plan.reject, plan.reject);
  const { crop } = plan;
  assert.ok(Math.abs(crop.width / crop.height - 16 / 9) < 0.01);
  assert.ok(
    crop.x >= 0 &&
      crop.y >= 0 &&
      crop.x + crop.width <= 640 &&
      crop.y + crop.height <= 480,
  );
  assert.ok(plan.shoulderWidthNorm >= RULES.minShoulderWidthNorm);
  assert.ok(plan.shoulderWidthNorm <= RULES.maxShoulderWidthNorm + 1e-9);
  assert.equal(plan.calibrationEligible, true);
  const normalized = cropKeypoints(person(), crop);
  assert.equal(normalized.length, KEYPOINTS.length);
  for (const point of normalized)
    assert.ok(point.x > 0 && point.x < 1 && point.y > 0 && point.y < 1);
  // Unmirrored: the anatomical left shoulder of a camera-facing person is on the image right.
  assert.ok(normalized[5].x > normalized[6].x);
});

test("rejects back-facing, unlabelled, tiny and crowded subjects with a named reason", () => {
  assert.equal(
    planCrop(person({ left_shoulder: [270, 200], right_shoulder: [370, 200] }))
      .reject,
    "not-facing-camera",
  );
  const missing = person();
  missing.keypoints[9][2] = 0;
  assert.equal(planCrop(missing).reject, "left_wrist-unlabelled");
  const tiny = person();
  tiny.keypoints = tiny.keypoints.map(([x, y, v]) => [
    320 + (x - 320) / 4,
    240 + (y - 240) / 4,
    v,
  ]);
  assert.equal(planCrop(tiny).reject, "too-small");
  assert.equal(
    planCrop(person(), [{ bbox: [240, 100, 150, 280], iscrowd: false }]).reject,
    "other-person-in-crop",
  );
  assert.equal(
    planCrop(person(), [{ bbox: [300, 300, 20, 20], iscrowd: true }]).reject,
    "crowd-in-crop",
  );
  assert.ok(
    !planCrop(person(), [{ bbox: [300, 300, 20, 20], iscrowd: false }]).reject,
  );
});

test("orders candidates deterministically by seed", () => {
  const ids = ["coco-1", "coco-2", "coco-3", "coco-4"];
  assert.deepEqual(seededOrder(7, ids), seededOrder(7, [...ids].reverse()));
  assert.notDeepEqual(seededOrder(7, ids), seededOrder(8, ids));
});

test("chooses a measured calibration photo by the declared two-hand rule", () => {
  const evidence = {
    lane: "dataset-camera",
    datasetCamera: {
      evaluation: {
        items: [
          { id: "a", frames: 30, twoHandsRate: 0.4, oneOrMoreHandsRate: 1 },
          { id: "b", frames: 30, twoHandsRate: 1, oneOrMoreHandsRate: 1 },
          { id: "c", frames: 2, twoHandsRate: 1, oneOrMoreHandsRate: 1 },
          { id: "d", frames: 30, twoHandsRate: 1, oneOrMoreHandsRate: 1 },
        ],
      },
    },
  };
  assert.equal(calibrationFromSweep(evidence, ["d", "c", "b", "a"]).id, "d");
  assert.equal(calibrationFromSweep(evidence, ["a", "b", "c", "d"]).id, "b");
  assert.throws(
    () => calibrationFromSweep({ lane: "live-camera-unverified" }, ["a"]),
    /dataset-camera/,
  );
});

test("reads a deflated ZIP member without extra dependencies", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "sign-saber-zip-test-"));
  try {
    const name = Buffer.from("annotations/x.json");
    const data = Buffer.from(JSON.stringify({ ok: true, items: [1, 2, 3] }));
    const compressed = deflateRawSync(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0, 42);
    const directoryOffset = local.length + name.length + compressed.length;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(central.length + name.length, 12);
    end.writeUInt32LE(directoryOffset, 16);
    const file = path.join(dir, "test.zip");
    await writeFile(
      file,
      Buffer.concat([local, name, compressed, central, name, end]),
    );
    assert.deepEqual(
      JSON.parse(await readZipMember(file, "annotations/x.json")),
      { ok: true, items: [1, 2, 3] },
    );
    await assert.rejects(readZipMember(file, "missing.json"), /not found/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
