#!/usr/bin/env node
// Populates app/public/models/ with the MediaPipe WASM runtime and task models.
// - WASM files are copied from the installed @mediapipe/tasks-vision package (no network).
// - .task models are downloaded from Google's public model bucket (network needed once).
//
// Usage (from app/):  npm run models            → hand + pose lite
//                     npm run models -- --with-segmenter  → also selfie_segmenter.tflite (ADR-003 fallback)
//                     npm run models -- --force  → re-download even if present
//
// Spec: docs/05-tracking-pipeline.md §Model assets, docs/03-decisions.md ADR-013.

import { createRequire } from 'node:module';
import { mkdirSync, copyFileSync, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..', 'app');
const outDir = join(appDir, 'public', 'models');
const wasmOut = join(outDir, 'wasm');
const args = new Set(process.argv.slice(2));
const force = args.has('--force');

const MODELS = [
  {
    file: 'hand_landmarker.task',
    url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task',
  },
  {
    file: 'pose_landmarker_lite.task',
    url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task',
  },
];
if (args.has('--with-segmenter')) {
  MODELS.push({
    file: 'selfie_segmenter.tflite',
    url: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
  });
}

function copyWasm() {
  const require = createRequire(join(appDir, 'package.json'));
  const pkgJson = require.resolve('@mediapipe/tasks-vision/package.json');
  const wasmSrc = join(dirname(pkgJson), 'wasm');
  mkdirSync(wasmOut, { recursive: true });
  let n = 0;
  for (const f of readdirSync(wasmSrc)) {
    copyFileSync(join(wasmSrc, f), join(wasmOut, f));
    n++;
  }
  const version = require('@mediapipe/tasks-vision/package.json').version;
  writeFileSync(join(wasmOut, 'VERSION'), `${version}\n`);
  console.log(`wasm: copied ${n} files from @mediapipe/tasks-vision@${version}`);
}

async function download({ file, url }) {
  const dest = join(outDir, file);
  if (!force && existsSync(dest) && statSync(dest).size > 100_000) {
    console.log(`${file}: present (${(statSync(dest).size / 1e6).toFixed(1)} MB), skipping`);
    return;
  }
  process.stdout.write(`${file}: downloading… `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${file}: HTTP ${res.status} from ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  console.log(`${(buf.length / 1e6).toFixed(1)} MB`);
}

mkdirSync(outDir, { recursive: true });
copyWasm();
for (const m of MODELS) await download(m);
console.log(`done → ${outDir}`);
