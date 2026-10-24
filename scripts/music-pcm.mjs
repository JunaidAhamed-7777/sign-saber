// Canonical build-time decode of the installed MP3, including explicit iTunes gapless metadata.
// Browser decodeAudioData already honors this metadata. Never add this trim as a gameplay offset.
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function synchsafe(bytes, at) {
  return (
    (bytes[at] << 21) |
    (bytes[at + 1] << 14) |
    (bytes[at + 2] << 7) |
    bytes[at + 3]
  );
}
export function readITunSmpb(bytes) {
  if (bytes.subarray(0, 3).toString("ascii") !== "ID3") return null;
  const version = bytes[3],
    end = Math.min(bytes.length, 10 + synchsafe(bytes, 6));
  if (![2, 3, 4].includes(version))
    throw new Error("Unsupported ID3 version in canonical acquisition");
  if (bytes[5] !== 0)
    throw new Error(
      "ID3 flags require explicit review before gapless canonical decode",
    );
  const idLength = version === 2 ? 3 : 4,
    headerLength = version === 2 ? 6 : 10;
  for (let at = 10; at + headerLength <= end;) {
    const id = bytes.subarray(at, at + idLength).toString("ascii");
    if (!/^[A-Z0-9]+$/.test(id)) break;
    const size =
      version === 2
        ? bytes.readUIntBE(at + 3, 3)
        : version === 4
          ? synchsafe(bytes, at + 4)
          : bytes.readUInt32BE(at + 4);
    if (size <= 0 || at + headerLength + size > end)
      throw new Error("Invalid ID3 frame bounds");
    const frame = bytes.subarray(at + headerLength, at + headerLength + size);
    if (id === "COM" || id === "COMM") {
      if (frame[0] !== 0 && frame.includes(Buffer.from("iTunSMPB")))
        throw new Error("Unsupported iTunSMPB text encoding");
      const terminator = frame.indexOf(0, 4);
      const description =
        terminator >= 0 ? frame.subarray(4, terminator).toString("latin1") : "";
      if (description === "iTunSMPB") {
        const text = frame
          .subarray(terminator + 1)
          .toString("latin1")
          .trim();
        const fields = text.split(/\s+/);
        if (
          fields.length < 4 ||
          !fields.slice(0, 4).every((value) => /^[0-9a-fA-F]+$/.test(value))
        )
          throw new Error("Invalid iTunSMPB hex fields");
        const [encoderDelaySamples, endPaddingSamples, originalSampleCount] =
          fields.slice(1, 4).map((value) => Number.parseInt(value, 16));
        if (
          ![encoderDelaySamples, endPaddingSamples, originalSampleCount].every(
            Number.isSafeInteger,
          ) ||
          encoderDelaySamples < 0 ||
          endPaddingSamples < 0 ||
          originalSampleCount <= 0
        )
          throw new Error("Invalid iTunSMPB sample counts");
        return { encoderDelaySamples, endPaddingSamples, originalSampleCount };
      }
    }
    at += headerLength + size;
  }
  return null;
}
export async function decodeCanonicalPcm(
  audioPath,
  tempDirectory,
  targetSampleRate,
) {
  const encoded = await readFile(audioPath);
  const probe = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "stream=sample_rate,channels",
        "-select_streams",
        "a:0",
        "-of",
        "json",
        audioPath,
      ],
      { encoding: "utf8" },
    ),
  );
  const sourceSampleRate = Number(probe.streams?.[0]?.sample_rate);
  if (!Number.isSafeInteger(sourceSampleRate) || sourceSampleRate <= 0)
    throw new Error("Cannot identify source sample rate");
  const rawPath = path.join(tempDirectory, "source-native.f32"),
    trimmedPath = path.join(tempDirectory, "source-trimmed.f32"),
    outputPath = path.join(tempDirectory, "canonical.f32");
  execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-i",
      audioPath,
      "-f",
      "f32le",
      "-acodec",
      "pcm_f32le",
      "-ac",
      "1",
      "-ar",
      String(sourceSampleRate),
      rawPath,
    ],
    { stdio: "pipe" },
  );
  let raw = await readFile(rawPath);
  if (raw.length % Float32Array.BYTES_PER_ELEMENT)
    throw new Error("Misaligned native decoded PCM");
  const decodedSourceSamples = raw.length / Float32Array.BYTES_PER_ELEMENT;
  const trim = readITunSmpb(encoded);
  let trimApplied = false;
  if (trim) {
    const untrimmedCount =
      trim.originalSampleCount +
      trim.encoderDelaySamples +
      trim.endPaddingSamples;
    if (decodedSourceSamples === untrimmedCount) {
      raw = raw.subarray(
        trim.encoderDelaySamples * Float32Array.BYTES_PER_ELEMENT,
        (decodedSourceSamples - trim.endPaddingSamples) *
          Float32Array.BYTES_PER_ELEMENT,
      );
      trimApplied = true;
    } else if (decodedSourceSamples !== trim.originalSampleCount) {
      throw new Error(
        `Canonical MP3 trim mismatch: decoded ${decodedSourceSamples}, expected ${untrimmedCount} untrimmed or ${trim.originalSampleCount} already trimmed; review decoder behavior`,
      );
    }
  }
  await writeFile(trimmedPath, raw);
  execFileSync(
    "ffmpeg",
    [
      "-v",
      "error",
      "-y",
      "-f",
      "f32le",
      "-ar",
      String(sourceSampleRate),
      "-ac",
      "1",
      "-i",
      trimmedPath,
      "-f",
      "f32le",
      "-acodec",
      "pcm_f32le",
      "-ac",
      "1",
      "-ar",
      String(targetSampleRate),
      outputPath,
    ],
    { stdio: "pipe" },
  );
  const pcm = await readFile(outputPath);
  return {
    pcm,
    decode: {
      sourceSampleRate,
      decodedSourceSamples,
      sourceSamplesAfterGaplessTrim:
        raw.length / Float32Array.BYTES_PER_ELEMENT,
      gaplessMetadata: trim,
      explicitTrimApplied: trimApplied,
    },
  };
}
