#!/usr/bin/env node
// Requires ffmpeg on PATH. Decode once to canonical mono f32le, then use the app's real DSP/assignment/validator.
import { register } from "node:module";
import { readFile, writeFile, mkdtemp, rm, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import { decodeCanonicalPcm } from "./music-pcm.mjs";

register("./beatmap-typescript-loader.mjs", import.meta.url);
const { analyzeMono, mapFromAnalysis } =
  await import("../app/src/beatmap/pipeline.ts");
const { ANALYSIS_SR, GENERATOR_VERSION } =
  await import("../app/src/core/constants.ts");
const { validateBundledManifest } =
  await import("../app/src/beatmap/bundled.ts");
const root = fileURLToPath(
  new URL("../app/public/assets/tracks/", import.meta.url),
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const slugs = ["pamgaea", "electro-cabello", "cipher"];
const tracks = [];
const pendingWrites = [];
const ffmpegVersion = execFileSync("ffmpeg", ["-version"], {
  encoding: "utf8",
}).split("\n")[0];
const temp = await mkdtemp(path.join(tmpdir(), "sign-saber-music-"));
try {
  for (const slug of slugs) {
    const dir = path.join(root, slug),
      audio = await readFile(path.join(dir, "audio.mp3"));
    const acquisition = JSON.parse(
      await readFile(path.join(dir, "acquisition.json"), "utf8"),
    );
    if (sha(audio) !== acquisition.audioSha256)
      throw new Error(`${slug}: acquired audio was modified`);
    const { pcm, decode } = await decodeCanonicalPcm(
      path.join(dir, "audio.mp3"),
      temp,
      ANALYSIS_SR,
    );
    const copied = new Uint8Array(pcm.length);
    copied.set(pcm);
    const mono = new Float32Array(copied.buffer);
    const durationMs = (mono.length / ANALYSIS_SR) * 1000;
    const start = performance.now();
    const analysis = analyzeMono(mono, ANALYSIS_SR, durationMs);
    const maps = {},
      difficultyMaps = {},
      counts = {};
    for (const difficulty of ["easy", "normal", "hard"]) {
      const { map } = mapFromAnalysis(
        analysis,
        {
          title: acquisition.title,
          artist: acquisition.artist,
          source: "bundled",
          sourceHash: sha(audio),
          audioUrl: `/assets/tracks/${slug}/audio.mp3`,
        },
        difficulty,
      );
      const text = JSON.stringify(map, null, 2) + "\n";
      pendingWrites.push([path.join(dir, `${difficulty}.json`), text]);
      maps[difficulty] = sha(Buffer.from(text));
      difficultyMaps[difficulty] = `/assets/tracks/${slug}/${difficulty}.json`;
      counts[difficulty] = {
        notes: map.notes.length,
        obstacles: map.obstacles.length,
        slash: map.notes.filter((n) => n.type === "slash").length,
        smash: map.notes.filter((n) => n.type === "smash").length,
        beam: map.notes.filter((n) => n.type === "beam").length,
      };
    }
    const warnings = [...analysis.warnings];
    if (Math.abs(Number(acquisition.catalogEntry.bpm) - analysis.bpm) > 2)
      warnings.push("catalogTempoDiscrepancy");
    warnings.push("humanRhythmAndComfortReviewPending");
    const entry = {
      slug,
      title: acquisition.title,
      artist: acquisition.artist,
      role: acquisition.role,
      audioUrl: `/assets/tracks/${slug}/audio.mp3`,
      durationMs,
      bpm: analysis.warnings.includes("lowTempoConfidence")
        ? null
        : analysis.bpm,
      preview: {
        startMs: analysis.onsets[0]?.t ?? 0,
        durationMs: Math.min(15000, durationMs - (analysis.onsets[0]?.t ?? 0)),
      },
      difficultyMaps,
      generatorVersion: GENERATOR_VERSION,
      warnings,
      hashes: { audioSha256: sha(audio), canonicalPcmSha256: sha(pcm), maps },
      rights: {
        sourceUrl: acquisition.sourceUrl,
        license: acquisition.license,
        licenseUrl: acquisition.licenseUrl,
        attribution: `"${acquisition.title}" Kevin MacLeod (incompetech.com). Licensed under Creative Commons: By Attribution 4.0 License.`,
        changes: acquisition.changes,
      },
    };
    tracks.push(entry);
    pendingWrites.push([
      path.join(dir, "generation.json"),
      JSON.stringify(
        {
          version: 1,
          generatorVersion: GENERATOR_VERSION,
          sourceHash: sha(audio),
          canonicalPcmSha256: sha(pcm),
          canonicalDecode: {
            tool: ffmpegVersion,
            format: "f32le",
            channels: 1,
            sampleRate: ANALYSIS_SR,
            samples: mono.length,
            durationMs,
            ...decode,
          },
          analysis: {
            detectedBpm: analysis.bpm,
            catalogBpm: Number(acquisition.catalogEntry.bpm),
            tempoConfidence: analysis.tempoConfidence,
            onsets: analysis.onsets.length,
            beats: analysis.beats.length,
          },
          maps: counts,
          warnings,
          checks:
            "All difficulty maps passed the shared runtime structural, density, beam, wall and ergonomic validator. This is algorithmic validation, not human musical/playability evidence.",
          developmentGenerationMs: performance.now() - start,
        },
        null,
        2,
      ) + "\n",
    ]);
    console.log(
      `${slug}: ${durationMs.toFixed(2)} ms PCM; detector ${analysis.bpm} BPM, confidence ${analysis.tempoConfidence.toFixed(3)}; ${JSON.stringify(counts)}`,
    );
  }
  const manifest = { version: 1, tracks };
  validateBundledManifest(manifest);
  pendingWrites.push([
    path.join(root, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  ]);
  // Validate the complete pack before replacing any installed chart. Manifest is committed last.
  for (const [dest, text] of pendingWrites) {
    const stage = dest + "." + process.pid + ".tmp";
    await writeFile(stage, text);
    await rename(stage, dest);
  }
} finally {
  const resolved = path.resolve(temp),
    base = path.resolve(tmpdir()) + path.sep;
  if (
    !resolved.startsWith(base) ||
    !path.basename(resolved).startsWith("sign-saber-music-")
  )
    throw new Error("Refusing cleanup outside the music temp directory");
  await rm(resolved, { recursive: true, force: true });
}
