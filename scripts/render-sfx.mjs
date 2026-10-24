// Render the original synthesized SFX offline for audition and a reproducible receipt.
// The game synthesizes the same buffers at runtime (app/src/audio/sfxSynth.ts); nothing here is loaded
// by the app. Usage (from the repository root):
//   node scripts/render-sfx.mjs [--out <dir>] [--receipt] [--check] [--ffmpeg] [--rate 48000]
//   --out      write 32-bit float WAV files (full and calm sets) for listening
//   --receipt  rewrite assets-src/audio/sfx-receipt.json (hashes + measurements at the receipt rate)
//   --check    fail if the current renders differ from the committed receipt hashes
//   --ffmpeg   cross-check peak and momentary loudness with ffmpeg's ebur128 filter (needs ffmpeg on PATH)
import { register } from "node:module";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

register("./beatmap-typescript-loader.mjs", import.meta.url);
const { SFX_IDS, renderSfx, DEFAULT_VOICING, sfxLoudness } = await import("../app/src/audio/sfxSynth.ts");
const { measureSfx } = await import("../app/src/audio/sfxMetrics.ts");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const receiptPath = path.join(root, "assets-src", "audio", "sfx-receipt.json");
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : (args[index + 1] ?? null);
};
const rate = Number(option("--rate") ?? 48000);
const out = option("--out");
if (!Number.isInteger(rate) || rate < 8000) throw new Error("--rate must be an integer sample rate");

function wav(channels, sampleRate) {
  const frames = channels[0].length,
    count = channels.length,
    bytes = frames * count * 4;
  const buffer = Buffer.alloc(44 + bytes);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + bytes, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(3, 20); // IEEE float
  buffer.writeUInt16LE(count, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * count * 4, 28);
  buffer.writeUInt16LE(count * 4, 32);
  buffer.writeUInt16LE(32, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(bytes, 40);
  for (let frame = 0; frame < frames; frame++)
    for (let channel = 0; channel < count; channel++)
      buffer.writeFloatLE(channels[channel][frame], 44 + (frame * count + channel) * 4);
  return buffer;
}
const pcmHash = (channels) => {
  const hash = createHash("sha256");
  for (const channel of channels) hash.update(Buffer.from(channel.buffer, channel.byteOffset, channel.byteLength));
  return hash.digest("hex");
};
const round = (value, digits = 2) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : null);

const rows = [];
if (out) await mkdir(out, { recursive: true });
for (const calm of [false, true]) {
  for (const id of SFX_IDS) {
    const voicing = { ...DEFAULT_VOICING, calm };
    const started = performance.now();
    const channels = renderSfx(id, rate, voicing);
    const renderMs = performance.now() - started;
    const measured = measureSfx(channels, rate);
    const name = `${id}${calm ? ".calm" : ""}`;
    let ffmpeg = null;
    if (out) {
      const file = path.join(out, `${name}.wav`);
      await writeFile(file, wav(channels, rate));
      if (args.includes("--ffmpeg")) ffmpeg = ebur128(file);
    }
    rows.push({
      id: name,
      seconds: round(measured.seconds, 3),
      channels: measured.channels,
      targetLufs: sfxLoudness(id, calm),
      peakDb: round(measured.peakDb),
      bodyRmsDb: round(measured.bodyRmsDb),
      momentaryLufs: round(measured.momentaryLufs),
      centroidHz: Math.round(measured.centroidHz),
      renderMs: round(renderMs, 1),
      sha256: pcmHash(channels),
      ...(ffmpeg ? { ffmpeg } : {}),
    });
  }
}

/** Independent cross-check: ffmpeg's BS.1770 meter on the cue followed by 0.5 s of silence. */
function ebur128(file) {
  const result = spawnSync(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-i", file, "-af", "apad=pad_dur=0.5,ebur128=peak=sample", "-f", "null", "-"],
    { encoding: "utf8" },
  );
  if (result.error) throw new Error(`ffmpeg unavailable: ${result.error.message}`);
  const text = result.stderr ?? "";
  const momentary = [...text.matchAll(/ M:\s*(-?[\d.]+)/g)].map((match) => Number(match[1]));
  const peak = text.slice(text.lastIndexOf("Summary:")).match(/Peak:\s*(-?[\d.]+) dBFS/);
  return {
    momentaryMaxLufs: momentary.length ? Math.max(...momentary) : null,
    samplePeakDbfs: peak ? Number(peak[1]) : null,
  };
}

console.table(rows.map(({ sha256, ffmpeg, ...row }) => ({ ...row, ...(ffmpeg ? { ffM: ffmpeg.momentaryMaxLufs, ffPeak: ffmpeg.samplePeakDbfs } : {}), sha: sha256.slice(0, 10) })));

const receipt = {
  schema: 1,
  generator: "app/src/audio/sfxSynth.ts via scripts/render-sfx.mjs",
  license: "MIT (original procedural synthesis; no recordings or third-party audio)",
  sampleRate: rate,
  voicing: { rootHz: DEFAULT_VOICING.rootHz },
  note: "SHA-256 of little-endian float32 PCM, channels concatenated. Hashes pin the recipes at this rate and voicing; runtime renders at the device rate and the estimated track tonic.",
  sounds: Object.fromEntries(rows.map(({ id, renderMs, ffmpeg, ...row }) => [id, row])),
};
if (args.includes("--receipt")) {
  if (rate !== 48000) throw new Error("The committed receipt is pinned at 48000 Hz");
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + "\n");
  console.log(`Wrote ${path.relative(root, receiptPath)}`);
}
if (args.includes("--check")) {
  const committed = JSON.parse(await readFile(receiptPath, "utf8"));
  const changed = rows.filter((row) => committed.sounds[row.id]?.sha256 !== row.sha256).map((row) => row.id);
  if (changed.length) {
    console.error(`SFX renders differ from the receipt: ${changed.join(", ")}. Re-run with --receipt after review.`);
    process.exitCode = 1;
  } else console.log(`All ${rows.length} renders match the receipt.`);
}
