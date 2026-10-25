/** Rejection tests for the offline avatar gate. Uses the shipped authored fixture; no GPU. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { loadAvatar, validateAvatarScene } from "./check-avatar.mjs";

const fixture = new URL(
  "../app/public/assets/models/avatar.glb",
  import.meta.url,
);
const mesh = (scene) => scene.getObjectByProperty("isSkinnedMesh", true);
for (const [name, corrupt, expected] of [
  [
    "over-budget triangles",
    (scene) => {
      mesh(scene).geometry.setIndex(new Array(48_003).fill(0));
    },
    /triangles exceeds/,
  ],
  [
    "non-unit armature scale",
    (scene) => {
      scene.getObjectByName("avatar_rig").scale.x = 2;
    },
    /armature scale/,
  ],
  [
    "nonfinite position",
    (scene) => {
      mesh(scene).geometry.attributes.position.array[0] = NaN;
    },
    /nonfinite/,
  ],
  [
    "out-of-range skin joint",
    (scene) => {
      mesh(scene).geometry.attributes.skinIndex.array[0] = 99;
    },
    /valid skin joint/,
  ],
  [
    "unnormalized weights",
    (scene) => {
      mesh(scene).geometry.attributes.skinWeight.array.fill(0);
    },
    /normalized weights/,
  ],
  [
    "broken inverse bind",
    (scene) => {
      mesh(scene).skeleton.boneInverses[0].elements[12] += 0.1;
    },
    /rest bind/,
  ],
  [
    "missing bone",
    (scene) => {
      scene.getObjectByName("head").name = "missing_head";
    },
    /bone set/,
  ],
  [
    "zero-length normals",
    (scene) => {
      mesh(scene).geometry.attributes.normal.array.fill(0);
    },
    /normalized vertex normal/,
  ],
  [
    "missing material slot",
    (scene) => {
      mesh(scene).material.name = "unknown_material";
    },
    /runtime material slots/,
  ],
  [
    "out-of-range triangle index",
    (scene) => {
      const geometry = mesh(scene).geometry;
      geometry.index.array[0] = geometry.attributes.position.count;
    },
    /index in vertex range/,
  ],
]) {
  test(`rejects ${name}`, async () => {
    const { scene } = await loadAvatar(fixture);
    corrupt(scene);
    assert.throws(() => validateAvatarScene(scene), expected);
  });
}

test("accepts the authored fixture and unchanged reference rest pose", async () => {
  const candidate = await loadAvatar(fixture),
    reference = await loadAvatar(fixture);
  const report = validateAvatarScene(candidate.scene, reference.scene);
  assert.equal(report.bones, 43);
  assert.equal(report.referenceRestCompared, true);
  assert(report.triangles > 0 && report.triangles <= report.triangleBudget);
  assert(report.maxBindDrift < 1e-4);
});

test("rejects a shifted retargeting anchor relative to reference", async () => {
  const candidate = await loadAvatar(fixture),
    reference = await loadAvatar(fixture);
  candidate.scene.getObjectByName(
    "avatar_rig",
  ).userData.sign_saber_anchors.nose[0] += 0.1;
  assert.throws(
    () => validateAvatarScene(candidate.scene, reference.scene),
    /reference anchor/,
  );
});
