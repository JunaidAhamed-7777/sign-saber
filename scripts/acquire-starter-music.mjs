#!/usr/bin/env node
// Explicit developer acquisition only. Runtime playback never contacts the publisher.
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import path from "node:path";

const root = fileURLToPath(
  new URL("../app/public/assets/tracks/", import.meta.url),
);
const origin = "https://incompetech.com/music/royalty-free/";
const wanted = [
  { slug: "pamgaea", isrc: "USUAN1300036", role: "intro" },
  { slug: "electro-cabello", isrc: "USUAN1400048", role: "groove" },
  { slug: "cipher", isrc: "USUAN1100844", role: "showcase" },
];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function get(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} from ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
const catalogBytes = await get(`${origin}pieces.json`);
const catalog = JSON.parse(catalogBytes.toString("utf8"));
for (const entry of wanted) {
  const track = catalog.find((item) => item.isrc === entry.isrc);
  if (!track) throw new Error(`Official catalog no longer lists ${entry.isrc}`);
  const sourceUrl = `${origin}index.html?isrc=${entry.isrc}`;
  const page = await get(sourceUrl);
  // Current official track template explicitly supplies the 4.0 attribution.
  if (
    !page
      .toString("utf8")
      .includes("Licensed under Creative Commons: By Attribution 4.0 License")
  ) {
    throw new Error(
      `License requires review for ${track.title}; no file will be acquired`,
    );
  }
  const folder = path.join(root, entry.slug);
  await mkdir(folder, { recursive: true });
  const downloadUrl = `${origin}mp3-royaltyfree/${encodeURIComponent(track.filename)}`;
  const dest = path.join(folder, "audio.mp3");
  let audio, previous;
  try {
    audio = await readFile(dest);
  } catch {
    /* Acquire missing asset. */
  }
  if (audio) {
    try {
      previous = JSON.parse(
        await readFile(path.join(folder, "acquisition.json"), "utf8"),
      );
    } catch {
      throw new Error(
        `${entry.slug}: an unverified audio file exists; move it aside before acquisition`,
      );
    }
    if (sha(audio) !== previous.audioSha256)
      throw new Error(
        `${entry.slug}: packaged bytes no longer match the acquisition record`,
      );
  }
  if (!audio) {
    audio = await get(downloadUrl);
    if (
      audio.length < 1024 ||
      audio.subarray(0, 32).toString().includes("<html")
    )
      throw new Error("Invalid audio response");
    await writeFile(`${dest}.tmp`, audio);
    await rename(`${dest}.tmp`, dest);
  }
  const attribution = `"${track.title}" Kevin MacLeod (incompetech.com)\nLicensed under Creative Commons: By Attribution 4.0 License\nhttps://creativecommons.org/licenses/by/4.0/`;
  const evidence = {
    version: 1,
    acquiredAt: previous?.acquiredAt ?? new Date().toISOString(),
    verifiedAt: new Date().toISOString(),
    ...entry,
    title: track.title,
    artist: "Kevin MacLeod",
    sourceUrl,
    downloadUrl,
    license: "CC-BY-4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    licensingPage: `${origin}licenses/`,
    licenseEvidence:
      "Official track-page template includes By Attribution 4.0 attribution for the catalog-selected title.",
    catalogEntry: track,
    catalogSha256: sha(catalogBytes),
    trackPageSha256: sha(page),
    audioSha256: sha(audio),
    audioBytes: audio.length,
    changes:
      "Packaged original downloaded MP3 bytes unchanged. Analysis and generated maps are separate; previews use playback offsets without editing the file.",
  };
  await writeFile(
    path.join(folder, "acquisition.json"),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  await writeFile(
    path.join(folder, "ATTRIBUTION.txt"),
    `${attribution}\n\nSource: ${sourceUrl}\nDownload: ${downloadUrl}\nChanges: ${evidence.changes}\nAcquired: ${evidence.acquiredAt}\nSHA-256: ${evidence.audioSha256}\nMusic retains its Creative Commons license and is not MIT licensed. No artist endorsement is implied.\n`,
  );
  console.log(
    `${entry.slug}: ${audio.length} bytes, SHA-256 ${evidence.audioSha256}`,
  );
}
