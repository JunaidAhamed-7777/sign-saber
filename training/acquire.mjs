#!/usr/bin/env node
// Explicit local research acquisition. Nothing in training/data is bundled with the game.
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, rename, stat, statfs, rmdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('./', import.meta.url)), data = path.join(root, 'data');
await mkdir(data, { recursive: true });
const manifestPath = path.join(root, 'DATASETS.json');
const config = JSON.parse(await readFile(path.join(root, 'config.json'), 'utf8'));
const args = process.argv.slice(2);
const mode = args[0] ?? 'annotations';
// Independent acquisitions must not overwrite another dataset's completed receipt.
async function updateEntry(id, changes) {
  const lock = path.join(root, '.acquisition-manifest.lock');
  for (let attempts = 0; ; attempts++) {
    try { await mkdir(lock); break; }
    catch (error) {
      if (error.code !== 'EEXIST' || attempts >= 100) throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  try {
    const current = JSON.parse(await readFile(manifestPath, 'utf8'));
    const entry = current.datasets.find(item => item.id === id);
    if (!entry) throw new Error('Unknown dataset ' + id);
    Object.assign(entry, changes);
    const temporary = manifestPath + '.' + process.pid + '.tmp';
    await writeFile(temporary, JSON.stringify(current, null, 2) + '\n');
    await rename(temporary, manifestPath);
  } finally { await rmdir(lock); }
}
async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function download(url, dest, maxBytes, quiet = false) {
  const target = path.resolve(dest);
  if (!target.startsWith(path.resolve(data) + path.sep)) throw new Error('Acquisition path escapes training/data');
  await mkdir(path.dirname(target), { recursive: true });
  const receiptPath = target + '.receipt.json';
  try {
    const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
    if (receipt.url === url && receipt.bytes === (await stat(target)).size && receipt.sha256 === await hashFile(target)) return receipt;
    throw new Error('Existing file failed receipt verification: ' + target);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const filesystem = await statfs(data);
  if (Number(filesystem.bavail) * Number(filesystem.bsize) < config.minFreeDiskBytes) throw new Error('Research acquisition reached the configured free-disk reserve');
  const partial = target + '.part', metadataPath = partial + '.json';
  let start = 0, metadata = null;
  try { metadata = JSON.parse(await readFile(metadataPath, 'utf8')); if (metadata.url === url) start = (await stat(partial)).size; }
  catch { /* Fresh acquisition. */ }
  const headers = start ? { Range: 'bytes=' + start + '-', ...(metadata?.etag ? { 'If-Range': metadata.etag } : {}) } : {};
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error('HTTP ' + response.status + ' from ' + url);
  if (start && (response.status !== 206 || !response.headers.get('content-range')?.startsWith('bytes ' + start + '-'))) start = 0;
  await writeFile(metadataPath, JSON.stringify({ url, etag: response.headers.get('etag'), startedAt: metadata?.startedAt ?? new Date().toISOString() }) + '\n');
  const hash = createHash('sha256');
  if (start) for await (const chunk of createReadStream(partial)) hash.update(chunk);
  let count = start;
  const measure = new Transform({ transform(chunk, _encoding, callback) {
    count += chunk.length;
    if (count > maxBytes) { callback(new Error('Asset exceeds configured acquisition bound')); return; }
    hash.update(chunk); callback(null, chunk);
  } });
  if (!quiet) console.log('Downloading ' + path.relative(data, target) + (start ? ' from byte ' + start : ''));
  await pipeline(Readable.fromWeb(response.body), measure, createWriteStream(partial, { flags: start ? 'a' : 'w' }));
  const receipt = { version: 1, url, acquiredAt: new Date().toISOString(), bytes: count, sha256: hash.digest('hex'), transport: new URL(url).protocol, publisherChecksum: null, note: 'SHA records actual acquired bytes; no publisher-provided checksum was found. Local research only.' };
  await rename(partial, target);
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  if (!quiet) console.log('Acquired ' + path.relative(data, target) + ': ' + count + ' bytes ' + receipt.sha256);
  return receipt;
}
if (mode === 'annotations') {
  const assets = [
    ['coco2017', 'http://images.cocodataset.org/annotations/annotations_trainval2017.zip', 'coco2017/annotations_trainval2017.zip', 300 * 1024 ** 2],
    ['mpii', 'https://datasets.d2.mpi-inf.mpg.de/andriluka14cvpr/mpii_human_pose_v1_u12_2.zip', 'mpii/mpii_human_pose_v1_u12_2.zip', 20 * 1024 ** 2],
  ];
  const results = await Promise.allSettled(assets.map(async ([id, url, file, cap]) => ({ id, receipt: await download(url, path.join(data, file), cap) })));
  for (const result of results) {
    if (result.status === 'fulfilled') {
      await updateEntry(result.value.id, { localAnnotations: result.value.receipt });
    } else { console.error(result.reason); process.exitCode = 1; }
  }
} else if (mode === 'mpii-images') {
  const current = JSON.parse(await readFile(manifestPath, 'utf8'));
  const entry = current.datasets.find(item => item.id === 'mpii');
  const receipt = await download(entry.access.images, path.join(data, 'mpii/mpii_human_pose_v1.tar.gz'), 16 * 1024 ** 3);
  await updateEntry('mpii', { localImagesArchive: receipt, status: 'archives_acquired_prepare_and_training_pending' });
} else if (mode === 'coco-images') {
  const lines = (await readFile(path.join(data, 'coco2017/images-to-acquire.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const limitFlag = args.find(value => value.startsWith('--limit='));
  const limit = limitFlag ? Number(limitFlag.split('=')[1]) : lines.length;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Image limit must be a positive integer');
  const selected = lines.slice(0, limit);
  let next = 0, complete = 0;
  const failures = [];
  await Promise.all(Array.from({ length: config.downloadConcurrency }, async () => {
    while (next < selected.length) {
      const image = selected[next++];
      const url = new URL(image.url);
      if (url.hostname !== 'images.cocodataset.org' || !/^\/(train2017|val2017)\/\d{12}\.jpg$/.test(url.pathname)) throw new Error('Non-canonical COCO image URL');
      try { await download(image.url, path.join(data, 'coco2017', image.path), 30 * 1024 ** 2, true); complete++; }
      catch (error) { failures.push({ imageId: image.imageId, message: error.message }); }
      if (complete % 100 === 0) console.log('COCO images: ' + complete + '/' + selected.length + ' acquired, ' + failures.length + ' failures');
    }
  }));
  const summary = { selected: selected.length, availableInIndex: lines.length, limitApplied: !!limitFlag, completed: complete, failures, completedAt: new Date().toISOString(), fullEligibleAcquisitionComplete: !limitFlag && failures.length === 0 };
  await writeFile(path.join(data, 'coco2017/image-acquisition.json'), JSON.stringify(summary, null, 2) + '\n');
  await updateEntry('coco2017', { localImageAcquisition: summary, downloaded: summary.fullEligibleAcquisitionComplete, status: summary.fullEligibleAcquisitionComplete ? 'eligible_images_acquired_training_pending' : 'partial_image_acquisition_not_full_dataset' });
  if (failures.length) process.exitCode = 1;
} else throw new Error('Use annotations, coco-images or mpii-images');
