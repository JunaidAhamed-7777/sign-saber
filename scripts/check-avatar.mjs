#!/usr/bin/env node
/** Offline structural avatar gate. Run after `cd app && npm ci`:
 * node scripts/check-avatar.mjs [candidate.glb] [reference.glb]
 * Uses the application's installed Three.js GLTFLoader; never renders or establishes camera evidence.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GLTFLoader } from "../app/node_modules/three/examples/jsm/loaders/GLTFLoader.js";
import {
  Matrix4,
  PropertyBinding,
  Quaternion,
  Vector3,
} from "../app/node_modules/three/build/three.module.js";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const TRIANGLE_BUDGET = 16_000; // docs/18 §11, separate from arena asset pack.
const EPSILON = 1e-4; // Float32 exporter/loader roundoff; not an artistic motion tolerance.
const FINGERS = ["thumb", "index", "middle", "ring", "pinky"];
const BONES = [
  "hips",
  "spine",
  "chest",
  "neck",
  "head",
  ...["L", "R"].flatMap((side) => [
    ...["shoulder", "upper_arm", "forearm", "hand"].map(
      (name) => `${name}.${side}`,
    ),
    ...FINGERS.flatMap((name) =>
      [1, 2, 3].map((segment) => `${name}_0${segment}.${side}`),
    ),
  ]),
];
const MATERIALS = [
  "avatar_suit",
  "avatar_skin",
  "avatar_accent",
  "avatar_eye",
  "avatar_hair",
];
const ANCHORS = [
  "nose",
  ...[
    "hip",
    "shoulder",
    "elbow",
    "wrist",
    "ear",
    "eye",
    "mouth",
    "index",
    "pinky",
    "thumb",
  ].flatMap((name) => ["L", "R"].map((side) => `${name}.${side}`)),
];
const finite = (values, label) =>
  assert(
    Array.from(values).every(Number.isFinite),
    `${label}: nonfinite value`,
  );
const near = (a, b, label) => {
  assert.equal(a.length, b.length, `${label}: length`);
  assert(
    a.every((value, i) => Math.abs(value - b[i]) <= EPSILON),
    `${label}: changed beyond ${EPSILON}`,
  );
};

export async function loadAvatar(path) {
  const bytes = await readFile(path);
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, "GLB magic");
  assert.equal(bytes.readUInt32LE(4), 2, "GLB version");
  assert.equal(bytes.readUInt32LE(8), bytes.length, "GLB byte length");
  assert.equal(bytes.readUInt32LE(16), 0x4e4f534a, "GLB JSON chunk");
  const json = JSON.parse(
    bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)),
  );
  assert.equal(json.skins?.length, 1, "exactly one authored skin");
  assert(
    !json.buffers?.some((buffer) => buffer.uri),
    "self-contained embedded GLB buffers",
  );
  assert(
    !json.images?.length && !json.textures?.length,
    "base-colour materials need no external textures",
  );
  assert(!json.animations?.length, "runtime solver owns animation");
  for (const mesh of json.meshes ?? [])
    for (const primitive of mesh.primitives) {
      assert.equal(primitive.mode ?? 4, 4, "triangles only");
      assert(!primitive.targets?.length, "no unhandled morph targets");
      assert(!("JOINTS_1" in primitive.attributes), "at most four influences");
    }
  const gltf = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    "",
  );
  return { scene: gltf.scene, bytes: bytes.length };
}

export function validateAvatarScene(scene, reference) {
  scene.updateMatrixWorld(true);
  const armature = scene.getObjectByName("avatar_rig");
  assert(armature, "avatar_rig exists");
  near(armature.position.toArray(), [0, 0, 0], "armature origin");
  near(armature.scale.toArray(), [1, 1, 1], "armature scale");
  assert(
    armature.quaternion.angleTo(new Quaternion()) < EPSILON,
    "armature rotation",
  );
  const anchors = armature.userData.sign_saber_anchors;
  assert.deepEqual(
    Object.keys(anchors ?? {}).sort(),
    [...ANCHORS].sort(),
    "complete anchor set",
  );
  for (const [name, point] of Object.entries(anchors)) {
    assert.equal(point.length, 3, `${name}: xyz`);
    finite(point, name);
  }
  assert(
    anchors.nose[2] > anchors["ear.L"][2] + 0.05,
    "authored forward-facing +Z head basis",
  );
  const bones = [],
    meshes = [],
    materials = new Set();
  scene.traverse((object) => {
    finite(object.matrix.elements, `${object.name} transform`);
    if (object.isBone) bones.push(object);
    if (object.isMesh) {
      assert(
        object.isSkinnedMesh,
        `${object.name}: all avatar geometry must follow skin`,
      );
      meshes.push(object);
    }
  });
  assert.deepEqual(
    bones.map((bone) => bone.name).sort(),
    BONES.map(PropertyBinding.sanitizeNodeName).sort(),
    "exact upper-body-only bone set",
  );
  const identity = new Matrix4();
  let triangles = 0,
    vertices = 0,
    maxWeightError = 0,
    maxBindDrift = 0;
  for (const bone of bones)
    near(bone.scale.toArray(), [1, 1, 1], `${bone.name} scale`);
  for (const mesh of meshes) {
    near(mesh.scale.toArray(), [1, 1, 1], `${mesh.name} scale`);
    for (const material of Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material])
      materials.add(material.name);
    const { geometry, skeleton } = mesh;
    assert.equal(skeleton.bones.length, 43, "complete skin joints");
    assert.equal(
      skeleton.boneInverses.length,
      43,
      "complete inverse bind matrices",
    );
    skeleton.boneInverses.forEach((inverse, i) => {
      finite(inverse.elements, `inverse bind ${i}`);
      assert(Math.abs(inverse.determinant()) > EPSILON, `invertible bind ${i}`);
      near(
        new Matrix4().multiplyMatrices(skeleton.bones[i].matrixWorld, inverse)
          .elements,
        identity.elements,
        `rest bind ${i}`,
      );
    });
    const pos = geometry.getAttribute("position"),
      normal = geometry.getAttribute("normal");
    const joints = geometry.getAttribute("skinIndex"),
      weights = geometry.getAttribute("skinWeight");
    assert(
      pos && normal && joints && weights,
      "position, normal and skin attributes",
    );
    assert.equal(joints.itemSize, 4);
    assert.equal(weights.itemSize, 4);
    assert.equal(normal.count, pos.count);
    assert.equal(joints.count, pos.count);
    assert.equal(weights.count, pos.count);
    for (const [name, attribute] of Object.entries(geometry.attributes))
      finite(attribute.array, `${mesh.name} ${name}`);
    const count = geometry.index?.count ?? pos.count;
    assert.equal(count % 3, 0, "complete triangles");
    if (geometry.index)
      for (const index of geometry.index.array)
        assert(
          Number.isInteger(index) && index >= 0 && index < pos.count,
          "index in vertex range",
        );
    triangles += count / 3;
    vertices += pos.count;
    const point = new Vector3(),
      deformed = new Vector3();
    for (let vertex = 0; vertex < pos.count; vertex++) {
      let sum = 0;
      for (let channel = 0; channel < 4; channel++) {
        const index = joints.getComponent(vertex, channel),
          weight = weights.getComponent(vertex, channel);
        assert(
          Number.isInteger(index) &&
            index >= 0 &&
            index < skeleton.bones.length,
          "valid skin joint",
        );
        assert(
          weight >= 0 && weight <= 1 + EPSILON,
          "nonnegative bounded skin weight",
        );
        sum += weight;
      }
      maxWeightError = Math.max(maxWeightError, Math.abs(sum - 1));
      assert(
        Math.abs(sum - 1) <= EPSILON,
        `normalized weights at ${mesh.name}/${vertex}`,
      );
      point.fromBufferAttribute(normal, vertex);
      assert(Math.abs(point.length() - 1) < 0.01, "normalized vertex normal");
      point.fromBufferAttribute(pos, vertex);
      deformed.copy(point);
      mesh.applyBoneTransform(vertex, deformed);
      maxBindDrift = Math.max(maxBindDrift, point.distanceTo(deformed));
      assert(
        point.distanceTo(deformed) < EPSILON,
        `rest skin deformation at ${mesh.name}/${vertex}`,
      );
    }
  }
  assert(meshes.length > 0, "skinned geometry exists");
  assert.deepEqual(
    [...materials].sort(),
    [...MATERIALS].sort(),
    "runtime material slots",
  );
  assert(
    triangles <= TRIANGLE_BUDGET,
    `${triangles} triangles exceeds ${TRIANGLE_BUDGET}`,
  );
  if (reference) {
    reference.updateMatrixWorld(true);
    const oldAnchors =
      reference.getObjectByName("avatar_rig").userData.sign_saber_anchors;
    for (const name of ANCHORS)
      near(anchors[name], oldAnchors[name], `reference anchor ${name}`);
    for (const bone of bones) {
      const old = reference.getObjectByName(bone.name);
      assert(old?.isBone, `reference bone ${bone.name}`);
      assert.equal(
        bone.parent?.name,
        old.parent?.name,
        `reference parent ${bone.name}`,
      );
      near(
        bone.matrix.elements,
        old.matrix.elements,
        `reference local rest ${bone.name}`,
      );
    }
  }
  return {
    triangles,
    triangleBudget: TRIANGLE_BUDGET,
    vertices,
    skinnedMeshes: meshes.length,
    bones: bones.length,
    anchors: ANCHORS.length,
    materials: [...materials],
    maxWeightError,
    maxBindDrift,
    referenceRestCompared: !!reference,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const candidate = await loadAvatar(
    resolve(process.argv[2] ?? `${ROOT}/app/public/assets/models/avatar.glb`),
  );
  const reference = process.argv[3]
    ? await loadAvatar(resolve(process.argv[3]))
    : null;
  console.log(
    JSON.stringify(
      {
        file: process.argv[2] ?? "app/public/assets/models/avatar.glb",
        bytes: candidate.bytes,
        ...validateAvatarScene(candidate.scene, reference?.scene),
        evidence:
          "Offline structural/CPU skin validation only; not browser, visual deformation or camera evidence.",
      },
      null,
      2,
    ),
  );
}
