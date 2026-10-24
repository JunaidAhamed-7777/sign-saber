#!/usr/bin/env node
// Pinned, hash-verified upstream fonts. Prepared builds serve these locally.
import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(
  new URL("../app/public/assets/fonts/", import.meta.url),
);
const sources = [
  {
    family: "Orbitron",
    style: "variable",
    weight: "400 900",
    file: "orbitron.ttf",
    commit: "8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5",
    directory: "orbitron",
    upstreamFile: "Orbitron[wght].ttf",
    sha256: "f42db2dd16e642258e35782916eceb1dcdbea06fb958d77ad71dc5963587e8fd",
    licenseSha256:
      "ab609b0e110d622435ff337cdf233288556e011bbf9bd0550be98846c0630819",
  },
  {
    family: "Rajdhani",
    style: "Medium",
    weight: "500",
    file: "rajdhani.ttf",
    commit: "8772f86137e17678cbd3584ca9a3c9486c3e7e50",
    directory: "rajdhani",
    upstreamFile: "Rajdhani-Medium.ttf",
    sha256: "12ff7dcfe4c206e3875ac53b1762eab57de6a2fa7f5a86c26b97b88d6591eac2",
    licenseSha256:
      "f62ef357d3a1c3d27edd35a6e1ba350e8a8d13499797964eeadefbf0b3b15d1f",
  },
];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
await mkdir(root, { recursive: true });
const manifest = { version: 1, fonts: [] };
for (const font of sources) {
  const base = `https://raw.githubusercontent.com/google/fonts/${font.commit}/ofl/${font.directory}/`;
  const sourceUrl = base + encodeURIComponent(font.upstreamFile),
    licenseUrl = base + "OFL.txt";
  const licenseFile = `${font.directory}-OFL.txt`;
  for (const [file, url, expected] of [
    [font.file, sourceUrl, font.sha256],
    [licenseFile, licenseUrl, font.licenseSha256],
  ]) {
    const dest = path.join(root, file);
    let bytes;
    try {
      bytes = await readFile(dest);
    } catch {
      /* First acquisition. */
    }
    if (!bytes) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
      bytes = Buffer.from(await response.arrayBuffer());
      if (hash(bytes) !== expected)
        throw new Error(
          `${file}: upstream hash mismatch; review the pinned source before changing the manifest`,
        );
      await writeFile(dest + ".tmp", bytes);
      await rename(dest + ".tmp", dest);
    }
    if (hash(bytes) !== expected)
      throw new Error(`${file}: local hash mismatch; restore the pinned bytes`);
    console.log(`${file}: ${bytes.length} bytes verified`);
  }
  manifest.fonts.push({
    family: font.family,
    style: font.style,
    weight: font.weight,
    file: font.file,
    commit: font.commit,
    sourceUrl,
    sha256: font.sha256,
    license: "OFL-1.1",
    licenseFile,
    licenseUrl,
    licenseSha256: font.licenseSha256,
    changes:
      "Font bytes unchanged; local filename shortened for runtime URLs. Original copyright/license notices retained.",
  });
}
await writeFile(
  path.join(root, "manifest.json"),
  JSON.stringify(manifest, null, 2) + "\n",
);
