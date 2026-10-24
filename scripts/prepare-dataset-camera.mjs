#!/usr/bin/env node
/**
 * Prepare the local dataset-camera photo reel from already-acquired COCO2017 CC-BY photos.
 *
 * Output (ignored by Git): JPEG crops + manifest.json + ATTRIBUTION.txt. No pixels are committed.
 * Each crop frames one prominent, upright, camera-facing person's head-to-hips upper body at 16:9.
 * Ground-truth annotation keypoints are stored in crop-normalized, UNMIRRORED image coordinates.
 * This prepares input for a labelled "Dataset camera — not a webcam"; it is never webcam evidence.
 *
 * Usage (from the repository root):
 *   node scripts/prepare-dataset-camera.mjs [--coco <training/data/coco2017>] [--out <app/public/dataset-camera>]
 *        [--count 24] [--seed 20261025] [--width 1280] [--height 720] [--dry-run]
 *        [--calibration-from docs/evidence/<date>-dataset-camera-sweep-app-evidence.json]
 * Requires ffmpeg/ffprobe on PATH (or FFMPEG/FFPROBE). Selection rules are recorded in the manifest.
 * `--calibration-from` keeps the same selected photos but moves the photo with the best MEASURED
 * two-hand detection in a prior dataset-camera sweep to the calibration slot; the manifest records the
 * evidence hash and the declared rule's own choice, so the substitution is disclosed, not hidden.
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  open,
  readFile,
  writeFile,
  mkdir,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] !== undefined
    ? args[index + 1]
    : fallback;
};
const integer = (name, fallback, min, max) => {
  const value = Number(option(name, fallback));
  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`--${name} must be an integer in [${min}, ${max}]`);
  return value;
};

export const KEYPOINTS = [
  "nose",
  "left_eye",
  "right_eye",
  "left_ear",
  "right_ear",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "left_hip",
  "right_hip",
];
const K = Object.fromEntries(KEYPOINTS.map((name, index) => [name, index]));

/** Declared selection rules. Changing one changes the reel and must be recorded with new evidence. */
export const RULES = Object.freeze({
  license: "http://creativecommons.org/licenses/by/2.0/",
  requiredVisible: ["nose", "left_shoulder", "right_shoulder"],
  requiredLabelled: [
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
    "left_hip",
    "right_hip",
  ],
  minFrontalShoulderToTorso: 0.5,
  maxTorsoLeanFraction: 0.5,
  headTopAboveNoseFraction: 0.9,
  verticalFill: 0.82,
  horizontalFill: 0.88,
  maxShoulderWidthNorm: 0.26,
  minShoulderWidthNorm: 0.15,
  headMarginFraction: 0.06,
  jointEdgeMarginFraction: 0.02,
  minCropHeightPx: 240,
  maxOtherPersonOverlapFraction: 0.15,
  rejectCrowdInCrop: true,
  calibration:
    "Both elbows and wrists visible (v=2), wrists at least 8% inside every crop edge; largest source crop height wins; ties by seeded order.",
  calibrationWristEdgeMargin: 0.08,
  order:
    "Ascending SHA-256 of `${seed}:${sampleId}`; at most one person per source image.",
});

export const CALIBRATION_FROM_SWEEP_RULE =
  "Highest measured two-hand frame rate (>= 0.9 over >= 10 attributed frames) in a dataset-camera sweep; ties by reel order.";

/** Picks the calibration photo from measured sweep evidence (raw app evidence of the dataset-camera lane). */
export function calibrationFromSweep(evidence, orderIds) {
  if (evidence?.lane !== "dataset-camera")
    throw new Error(
      "Calibration evidence must be a dataset-camera sweep export",
    );
  const byId = new Map(
    (evidence.datasetCamera?.evaluation?.items ?? []).map((item) => [
      item.id,
      item,
    ]),
  );
  let best = null;
  for (const id of orderIds) {
    const item = byId.get(id);
    if (!item || !(item.frames >= 10) || !(item.twoHandsRate >= 0.9)) continue;
    if (!best || item.twoHandsRate > best.twoHandsRate) best = item;
  }
  if (!best)
    throw new Error(
      "No swept photo had two detected hands in at least 90% of its frames",
    );
  return best;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Minimal read-only ZIP member reader (no ZIP64), sufficient for the official annotation archive. */
export async function readZipMember(zipPath, memberName) {
  const handle = await open(zipPath, "r");
  try {
    const { size } = await handle.stat();
    const tailLength = Math.min(size, 65557);
    const tail = Buffer.alloc(tailLength);
    await handle.read(tail, 0, tailLength, size - tailLength);
    let eocd = -1;
    for (let i = tailLength - 22; i >= 0; i--)
      if (tail.readUInt32LE(i) === 0x06054b50) {
        eocd = i;
        break;
      }
    if (eocd < 0)
      throw new Error("ZIP end-of-central-directory record not found");
    const entries = tail.readUInt16LE(eocd + 10);
    const directorySize = tail.readUInt32LE(eocd + 12);
    const directoryOffset = tail.readUInt32LE(eocd + 16);
    if (directoryOffset === 0xffffffff || entries === 0xffff)
      throw new Error("ZIP64 archives are unsupported");
    const directory = Buffer.alloc(directorySize);
    await handle.read(directory, 0, directorySize, directoryOffset);
    let cursor = 0;
    for (let entry = 0; entry < entries; entry++) {
      if (directory.readUInt32LE(cursor) !== 0x02014b50)
        throw new Error("Corrupt ZIP central directory");
      const method = directory.readUInt16LE(cursor + 10);
      const compressedSize = directory.readUInt32LE(cursor + 20);
      const uncompressedSize = directory.readUInt32LE(cursor + 24);
      const nameLength = directory.readUInt16LE(cursor + 28);
      const extraLength = directory.readUInt16LE(cursor + 30);
      const commentLength = directory.readUInt16LE(cursor + 32);
      const localOffset = directory.readUInt32LE(cursor + 42);
      const name = directory.toString(
        "utf8",
        cursor + 46,
        cursor + 46 + nameLength,
      );
      cursor += 46 + nameLength + extraLength + commentLength;
      if (name !== memberName) continue;
      const local = Buffer.alloc(30);
      await handle.read(local, 0, 30, localOffset);
      if (local.readUInt32LE(0) !== 0x04034b50)
        throw new Error("Corrupt ZIP local header");
      const dataOffset =
        localOffset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
      const compressed = Buffer.alloc(compressedSize);
      await handle.read(compressed, 0, compressedSize, dataOffset);
      const bytes =
        method === 0
          ? compressed
          : method === 8
            ? inflateRawSync(compressed)
            : null;
      if (!bytes)
        throw new Error(`Unsupported ZIP compression method ${method}`);
      if (bytes.length !== uncompressedSize)
        throw new Error("ZIP member size mismatch");
      return bytes;
    }
    throw new Error(`ZIP member not found: ${memberName}`);
  } finally {
    await handle.close();
  }
}

const point = (keypoints, name) => {
  const [x, y, v] = keypoints[K[name]];
  return { x, y, v };
};

/**
 * Pure crop/eligibility rule. Returns { crop, shoulderWidthNorm, calibrationEligible } or { reject }.
 * Coordinates are source pixels; the crop is integer pixels inside the image.
 */
export function planCrop(person, others = []) {
  const kp = person.keypoints;
  if (!Array.isArray(kp) || kp.length !== KEYPOINTS.length)
    return { reject: "topology" };
  for (const name of RULES.requiredVisible)
    if (point(kp, name).v !== 2) return { reject: `${name}-not-visible` };
  for (const name of RULES.requiredLabelled)
    if (point(kp, name).v < 1) return { reject: `${name}-unlabelled` };
  const ls = point(kp, "left_shoulder"),
    rs = point(kp, "right_shoulder"),
    lh = point(kp, "left_hip"),
    rh = point(kp, "right_hip"),
    nose = point(kp, "nose");
  // Facing the camera: anatomical left appears on the image right in an unmirrored photo.
  if (!(ls.x > rs.x) || !(lh.x > rh.x)) return { reject: "not-facing-camera" };
  const shoulder = Math.hypot(ls.x - rs.x, ls.y - rs.y);
  const shoulderMid = { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 };
  const hipMid = { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 };
  const torso = hipMid.y - shoulderMid.y;
  if (!(nose.y < shoulderMid.y) || !(torso > 0))
    return { reject: "not-upright" };
  if (shoulder / torso < RULES.minFrontalShoulderToTorso)
    return { reject: "not-frontal" };
  if (Math.abs(hipMid.x - shoulderMid.x) > RULES.maxTorsoLeanFraction * torso)
    return { reject: "leaning" };
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const [x, y, v] of kp)
    if (v > 0) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  const headTop =
    nose.y - RULES.headTopAboveNoseFraction * (shoulderMid.y - nose.y);
  const top0 = Math.min(minY, headTop);
  const cx = (shoulderMid.x + hipMid.x) / 2;
  const halfSpan = Math.max(cx - minX, maxX - cx);
  const height = Math.max(
    (maxY - top0) / RULES.verticalFill,
    ((2 * halfSpan) / RULES.horizontalFill) * (9 / 16),
    (shoulder * 9) / (16 * RULES.maxShoulderWidthNorm),
  );
  const width = (height * 16) / 9;
  const W = Math.round(width),
    H = Math.round(height);
  if (H < RULES.minCropHeightPx) return { reject: "too-small" };
  if (W > person.width || H > person.height)
    return { reject: "crop-exceeds-image" };
  const x = Math.round(Math.min(Math.max(cx - width / 2, 0), person.width - W));
  const y = Math.round(
    Math.min(
      Math.max(top0 - RULES.headMarginFraction * height, 0),
      person.height - H,
    ),
  );
  const margin = RULES.jointEdgeMarginFraction;
  for (const [px, py, v] of kp)
    if (v > 0) {
      const u = (px - x) / W,
        w = (py - y) / H;
      if (u < margin || u > 1 - margin || w < margin || w > 1 - margin)
        return { reject: "joint-near-edge" };
    }
  const shoulderWidthNorm = Math.hypot(
    (ls.x - rs.x) / W,
    ((ls.y - rs.y) / H) * (9 / 16),
  );
  if (
    shoulderWidthNorm < RULES.minShoulderWidthNorm ||
    shoulderWidthNorm > RULES.maxShoulderWidthNorm + 1e-9
  )
    return { reject: "shoulder-scale" };
  const selfArea = Math.max(1, person.bbox[2] * person.bbox[3]);
  for (const other of others) {
    const [ox, oy, ow, oh] = other.bbox;
    const ix = Math.max(0, Math.min(ox + ow, x + W) - Math.max(ox, x));
    const iy = Math.max(0, Math.min(oy + oh, y + H) - Math.max(oy, y));
    if (other.iscrowd && RULES.rejectCrowdInCrop && ix * iy > 0)
      return { reject: "crowd-in-crop" };
    if (
      !other.iscrowd &&
      ix * iy >= RULES.maxOtherPersonOverlapFraction * selfArea
    )
      return { reject: "other-person-in-crop" };
  }
  const edge = RULES.calibrationWristEdgeMargin;
  const calibrationEligible = [
    "left_elbow",
    "right_elbow",
    "left_wrist",
    "right_wrist",
  ].every((name) => {
    const p = point(kp, name);
    if (p.v !== 2) return false;
    if (!name.endsWith("wrist")) return true;
    const u = (p.x - x) / W,
      w = (p.y - y) / H;
    return u >= edge && u <= 1 - edge && w >= edge && w <= 1 - edge;
  });
  return {
    crop: { x, y, width: W, height: H },
    shoulderWidthNorm,
    calibrationEligible,
  };
}

export function cropKeypoints(person, crop) {
  return KEYPOINTS.map((name, index) => {
    const [x, y, v] = person.keypoints[index];
    return v > 0
      ? { name, x: (x - crop.x) / crop.width, y: (y - crop.y) / crop.height, v }
      : { name, x: 0, y: 0, v: 0 };
  });
}

export function seededOrder(seed, ids) {
  return [...ids].sort((a, b) => {
    const ha = sha256(`${seed}:${a}`),
      hb = sha256(`${seed}:${b}`);
    return ha < hb ? -1 : ha > hb ? 1 : 0;
  });
}

async function main() {
  const coco = path.resolve(
    option(
      "coco",
      process.env.SIGN_SABER_COCO_DIR ||
        path.join(root, "training", "data", "coco2017"),
    ),
  );
  const out = path.resolve(
    option("out", path.join(root, "app", "public", "dataset-camera")),
  );
  const count = integer("count", 24, 2, 200);
  const seed = integer("seed", 20261025, 0, 2 ** 31 - 1);
  const width = integer("width", 1280, 320, 3840);
  const height = integer("height", 720, 180, 2160);
  if (width * 9 !== height * 16) throw new Error("Output must be exactly 16:9");
  const dryRun = args.includes("--dry-run");
  const ffmpeg = process.env.FFMPEG || "ffmpeg";
  const ffprobe = process.env.FFPROBE || "ffprobe";
  const relativeOut = path.relative(root, out).split(path.sep).join("/");
  if (
    !dryRun &&
    relativeOut !== "app/public/dataset-camera" &&
    !args.includes("--allow-any-out")
  )
    throw new Error(
      "Refusing to write outside the ignored app/public/dataset-camera directory",
    );

  const people = [];
  const indexHashes = {};
  for (const split of ["val", "train"]) {
    const file = path.join(coco, `${split}.jsonl`);
    const bytes = await readFile(file);
    indexHashes[`${split}.jsonl`] = sha256(bytes);
    for (const line of bytes.toString("utf8").split("\n"))
      if (line.trim()) {
        const record = JSON.parse(line);
        if (
          record.dataset === "coco2017" &&
          record.source?.license === RULES.license
        )
          people.push(record);
      }
  }
  const zip = path.join(coco, "annotations_trainval2017.zip");
  const allPeople = new Map();
  let annotationsSha256 = null;
  let prominenceCheck = "full-official-annotations";
  try {
    const receipt = JSON.parse(await readFile(`${zip}.receipt.json`, "utf8"));
    annotationsSha256 = receipt.sha256 ?? null;
    for (const split of ["val2017", "train2017"]) {
      const json = JSON.parse(
        (
          await readZipMember(zip, `annotations/person_keypoints_${split}.json`)
        ).toString("utf8"),
      );
      for (const annotation of json.annotations) {
        let list = allPeople.get(annotation.image_id);
        if (!list) allPeople.set(annotation.image_id, (list = []));
        list.push({
          id: annotation.id,
          bbox: annotation.bbox,
          iscrowd: !!annotation.iscrowd,
        });
      }
    }
  } catch (error) {
    if (!args.includes("--index-only-prominence"))
      throw new Error(
        `Official annotation archive unavailable (${error.message}). Pass --index-only-prominence to accept a weaker check.`,
      );
    prominenceCheck = "index-only";
    for (const person of people) {
      let list = allPeople.get(person.imageId);
      if (!list) allPeople.set(person.imageId, (list = []));
      list.push({
        id: Number(person.sampleId.replace(/^coco-/, "")),
        bbox: person.bbox,
        iscrowd: false,
      });
    }
  }

  const rejected = {};
  const candidates = new Map();
  for (const person of people) {
    const annotationId = Number(person.sampleId.replace(/^coco-/, ""));
    const others = (allPeople.get(person.imageId) ?? []).filter(
      (other) => other.id !== annotationId,
    );
    const plan = planCrop(person, others);
    if (plan.reject) {
      rejected[plan.reject] = (rejected[plan.reject] ?? 0) + 1;
      continue;
    }
    candidates.set(person.sampleId, { person, annotationId, ...plan });
  }
  const ordered = seededOrder(seed, [...candidates.keys()]).map((id) =>
    candidates.get(id),
  );
  const calibration = ordered
    .filter((candidate) => candidate.calibrationEligible)
    .reduce(
      (best, candidate) =>
        !best || candidate.crop.height > best.crop.height ? candidate : best,
      null,
    );
  if (!calibration)
    throw new Error(
      "No calibration-eligible photo satisfies the declared rules",
    );
  const selected = [calibration];
  const images = new Set([calibration.person.imageId]);
  for (const candidate of ordered) {
    if (selected.length >= count) break;
    if (images.has(candidate.person.imageId)) continue;
    images.add(candidate.person.imageId);
    selected.push(candidate);
  }
  let calibrationSelection = {
    rule: RULES.calibration,
    source: "declared annotation rule",
  };
  const calibrationFrom = option("calibration-from", null);
  if (calibrationFrom) {
    const bytes = await readFile(path.resolve(calibrationFrom));
    const evidence = JSON.parse(bytes.toString("utf8"));
    const ids = selected.map((candidate) => candidate.person.sampleId);
    const chosen = calibrationFromSweep(evidence, ids);
    const items = evidence.datasetCamera.evaluation.items;
    const measured = (id) => {
      const item = items.find((entry) => entry.id === id);
      return item
        ? {
            id,
            frames: item.frames,
            twoHandsRate: item.twoHandsRate,
            oneOrMoreHandsRate: item.oneOrMoreHandsRate,
          }
        : { id, frames: 0 };
    };
    const index = ids.indexOf(chosen.id);
    calibrationSelection = {
      rule: CALIBRATION_FROM_SWEEP_RULE,
      source: path.basename(calibrationFrom),
      evidenceSha256: sha256(bytes),
      chosen: measured(chosen.id),
      declaredRuleChoice: measured(ids[0]),
    };
    [selected[0], selected[index]] = [selected[index], selected[0]];
  }
  const summary = {
    eligiblePeopleInIndex: people.length,
    candidates: candidates.size,
    calibrationEligible: ordered.filter(
      (candidate) => candidate.calibrationEligible,
    ).length,
    selected: selected.length,
    rejected,
    prominenceCheck,
  };
  console.log(JSON.stringify(summary));
  if (dryRun) return;
  if (selected.length < count)
    throw new Error(`Only ${selected.length} photos satisfy the rules`);

  await mkdir(out, { recursive: true });
  for (const name of await readdir(out))
    if (
      /^\d{3}-coco-\d+\.jpg$/.test(name) ||
      name === "manifest.json" ||
      name === "ATTRIBUTION.txt"
    )
      await rm(path.join(out, name));
  const items = [];
  for (const [index, candidate] of selected.entries()) {
    const { person, crop } = candidate;
    const source = path.join(coco, person.image.replace(/^coco2017[\\/]/, ""));
    const sourceBytes = await readFile(source);
    const receipt = JSON.parse(
      await readFile(`${source}.receipt.json`, "utf8"),
    );
    const sourceSha256 = sha256(sourceBytes);
    if (receipt.sha256 !== sourceSha256)
      throw new Error(`Source receipt mismatch: ${person.image}`);
    const probe = await run(ffprobe, [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height",
      "-of",
      "csv=p=0",
      source,
    ]);
    const [probeWidth, probeHeight] = probe.stdout
      .trim()
      .split(",")
      .map(Number);
    if (probeWidth !== person.width || probeHeight !== person.height)
      throw new Error(
        `Decoded size differs from annotation size: ${person.image}`,
      );
    const file = `${String(index).padStart(3, "0")}-${person.sampleId}.jpg`;
    const target = path.join(out, file);
    await run(ffmpeg, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-noautorotate",
      "-i",
      source,
      "-vf",
      `crop=${crop.width}:${crop.height}:${crop.x}:${crop.y},scale=${width}:${height}:flags=lanczos`,
      "-frames:v",
      "1",
      "-q:v",
      "2",
      "-y",
      target,
    ]);
    const bytes = await readFile(target);
    items.push({
      id: person.sampleId,
      role: index === 0 ? "calibration" : "reel",
      file,
      bytes: bytes.length,
      sha256: sha256(bytes),
      coco: {
        imageId: person.imageId,
        annotationId: candidate.annotationId,
        split: person.split,
        sourceSha256,
        sourceSize: { width: person.width, height: person.height },
        cocoUrl: person.source.url,
      },
      license: person.source.license,
      flickrUrl: person.source.flickrUrl,
      crop,
      shoulderWidthNorm: Number(candidate.shoulderWidthNorm.toFixed(6)),
      keypoints: cropKeypoints(person, crop).map((p) => ({
        ...p,
        x: Number(p.x.toFixed(6)),
        y: Number(p.y.toFixed(6)),
      })),
    });
  }
  const scriptBytes = await readFile(fileURLToPath(import.meta.url));
  const manifest = {
    schema: 1,
    kind: "coco-photo-reel",
    label: "Dataset camera — not a webcam",
    coordinateSpace: "crop-normalized-unmirrored",
    temporalRecording: false,
    createdAt: new Date().toISOString(),
    generator: {
      script: "scripts/prepare-dataset-camera.mjs",
      scriptSha256: sha256(scriptBytes),
      seed,
      rules: RULES,
      calibrationSelection,
      summary,
    },
    source: {
      dataset: "coco2017",
      annotationsArchiveSha256: annotationsSha256,
      indexSha256: indexHashes,
      terms:
        "COCO annotations CC-BY-4.0; each photo retains its own Flickr CC-BY-2.0 license. Local use only; pixels are not committed.",
    },
    frame: { width, height },
    keypoints: KEYPOINTS,
    items,
  };
  await writeFile(
    path.join(out, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  const attribution = [
    "Sign Saber dataset camera — local, ignored photo reel. Not a webcam; never live-camera evidence.",
    "Annotations: COCO 2017 person keypoints (CC-BY-4.0, https://cocodataset.org/#termsofuse).",
    "Each photo: CC-BY-2.0 (https://creativecommons.org/licenses/by/2.0/), by its Flickr author at the URL below.",
    "Modifications: cropped to a 16:9 upper-body region and resized. Do not redistribute without attribution.",
    "",
    ...items.map(
      (item) =>
        `${item.file}\tCOCO image ${item.coco.imageId}\t${item.flickrUrl}\t${item.license}\tcrop ${item.crop.x},${item.crop.y} ${item.crop.width}x${item.crop.height}`,
    ),
    "",
  ].join("\n");
  await writeFile(path.join(out, "ATTRIBUTION.txt"), attribution);
  const total = (
    await Promise.all(items.map((item) => stat(path.join(out, item.file))))
  ).reduce((sum, info) => sum + info.size, 0);
  console.log(
    `Wrote ${items.length} photos (${total} bytes) and manifest.json to ${relativeOut}`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
