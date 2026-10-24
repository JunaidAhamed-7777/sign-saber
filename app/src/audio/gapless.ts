/**
 * Sign Saber — audio/gapless.ts
 *
 * Responsibility: honour explicit iTunes gapless metadata (iTunSMPB) when a browser's MP3 decoder
 * returns the untrimmed encoder delay/padding. Mirrors scripts/music-pcm.mjs (canonical build decode).
 * Spec: docs/15-audio-playback-sync.md §Decoding
 * Inputs: original file bytes, decoded AudioBuffer
 * Outputs: canonical AudioBuffer (trimmed only when the decoded length proves it was untrimmed)
 *
 * This is decode normalization, never a gameplay or audio-latency offset.
 */
import { GAPLESS_LENGTH_TOLERANCE_SAMPLES } from '../core/constants';
export interface GaplessTrim {
  encoderDelaySamples: number;
  endPaddingSamples: number;
  originalSampleCount: number;
}
const ID3_HEADER_BYTES = 10;
const MPEG_SAMPLE_RATES: Record<number, readonly number[]> = {
  3: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  0: [11025, 12000, 8000],
};
const LAYER3_KBPS: Record<'v1' | 'v2', readonly number[]> = {
  v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
function synchsafe(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at]! & 0x7f) << 21) |
    ((bytes[at + 1]! & 0x7f) << 14) |
    ((bytes[at + 2]! & 0x7f) << 7) |
    (bytes[at + 3]! & 0x7f)
  );
}
function uint(bytes: Uint8Array, at: number, length: number): number {
  let value = 0;
  for (let i = 0; i < length; i++) value = value * 256 + bytes[at + i]!;
  return value;
}
function ascii(bytes: Uint8Array, from: number, to: number): string {
  let text = '';
  for (let i = from; i < to; i++) text += String.fromCharCode(bytes[i]!);
  return text;
}
/** Byte length of a leading ID3v2 tag, including an optional footer; 0 when absent. */
export function id3Length(bytes: Uint8Array): number {
  if (bytes.length < ID3_HEADER_BYTES || ascii(bytes, 0, 3) !== 'ID3') return 0;
  const footer = (bytes[5]! & 0x10) !== 0 ? ID3_HEADER_BYTES : 0;
  return Math.min(bytes.length, ID3_HEADER_BYTES + synchsafe(bytes, 6) + footer);
}
/** iTunSMPB COMM frame from an unsynchronised ID3v2.2–2.4 tag, or null when absent/unsupported. */
export function readITunSmpb(bytes: Uint8Array): GaplessTrim | null {
  if (bytes.length < ID3_HEADER_BYTES || ascii(bytes, 0, 3) !== 'ID3') return null;
  const version = bytes[3]!;
  // Unsynchronisation/extended headers are not used by the bundled files; refuse rather than guess.
  if (![2, 3, 4].includes(version) || (bytes[5]! & 0xc0) !== 0) return null;
  const end = Math.min(bytes.length, ID3_HEADER_BYTES + synchsafe(bytes, 6));
  const idLength = version === 2 ? 3 : 4;
  const headerLength = version === 2 ? 6 : 10;
  for (let at = ID3_HEADER_BYTES; at + headerLength <= end;) {
    const id = ascii(bytes, at, at + idLength);
    if (!/^[A-Z0-9]+$/.test(id)) break;
    const size =
      version === 2
        ? uint(bytes, at + 3, 3)
        : version === 4
          ? synchsafe(bytes, at + 4)
          : uint(bytes, at + 4, 4);
    if (size <= 0 || at + headerLength + size > end) return null;
    const start = at + headerLength;
    if ((id === 'COM' || id === 'COMM') && bytes[start] === 0) {
      let terminator = -1;
      for (let i = start + 4; i < start + size; i++)
        if (bytes[i] === 0) {
          terminator = i;
          break;
        }
      if (terminator >= 0 && ascii(bytes, start + 4, terminator) === 'iTunSMPB') {
        const fields = ascii(bytes, terminator + 1, start + size)
          .replace(/\0/g, ' ')
          .trim()
          .split(/\s+/);
        if (fields.length < 4 || !fields.slice(0, 4).every((field) => /^[0-9a-fA-F]+$/.test(field)))
          return null;
        const [encoderDelaySamples, endPaddingSamples, originalSampleCount] = fields
          .slice(1, 4)
          .map((field) => Number.parseInt(field, 16)) as [number, number, number];
        if (
          ![encoderDelaySamples, endPaddingSamples, originalSampleCount].every(Number.isSafeInteger) ||
          originalSampleCount <= 0
        )
          return null;
        return { encoderDelaySamples, endPaddingSamples, originalSampleCount };
      }
    }
    at = start + size;
  }
  return null;
}
/** Sample rate of the first MPEG layer III frame, confirmed by the following frame header. */
export function mp3SampleRate(bytes: Uint8Array): number | null {
  for (let at = id3Length(bytes); at + 4 <= bytes.length; at++) {
    if (bytes[at] !== 0xff || (bytes[at + 1]! & 0xe0) !== 0xe0) continue;
    const version = (bytes[at + 1]! >> 3) & 3;
    const layer = (bytes[at + 1]! >> 1) & 3;
    const bitrateIndex = bytes[at + 2]! >> 4;
    const rateIndex = (bytes[at + 2]! >> 2) & 3;
    const rates = MPEG_SAMPLE_RATES[version];
    if (!rates || layer !== 1 || rateIndex === 3 || bitrateIndex === 0 || bitrateIndex === 15) continue;
    const sampleRate = rates[rateIndex]!;
    const kbps = LAYER3_KBPS[version === 3 ? 'v1' : 'v2'][bitrateIndex]!;
    const padding = (bytes[at + 2]! >> 1) & 1;
    const frameBytes = Math.floor(((version === 3 ? 144 : 72) * kbps * 1000) / sampleRate) + padding;
    const next = at + frameBytes;
    if (next + 2 > bytes.length) return sampleRate;
    if (bytes[next] === 0xff && (bytes[next + 1]! & 0xe0) === 0xe0) return sampleRate;
  }
  return null;
}
/**
 * Returns the buffer unchanged when it already has the trimmed length (the decoder honoured the
 * metadata) or when no consistent metadata exists. Trims only when the decoded length matches the
 * untrimmed count, so a valid file is never shortened twice.
 */
export function applyGaplessTrim(
  buffer: AudioBuffer,
  bytes: Uint8Array,
  create: (channels: number, length: number, sampleRate: number) => AudioBuffer,
): AudioBuffer {
  const trim = readITunSmpb(bytes);
  const sourceRate = trim ? mp3SampleRate(bytes) : null;
  if (!trim || !sourceRate) return buffer;
  const ratio = buffer.sampleRate / sourceRate;
  const tolerance = Math.ceil(ratio) + GAPLESS_LENGTH_TOLERANCE_SAMPLES;
  const untrimmed = (trim.originalSampleCount + trim.encoderDelaySamples + trim.endPaddingSamples) * ratio;
  if (Math.abs(buffer.length - trim.originalSampleCount * ratio) <= tolerance) return buffer;
  if (Math.abs(buffer.length - untrimmed) > tolerance) return buffer;
  const first = Math.round(trim.encoderDelaySamples * ratio);
  const length = Math.min(buffer.length - first, Math.round(trim.originalSampleCount * ratio));
  if (first < 0 || length <= 0) return buffer;
  const trimmed = create(buffer.numberOfChannels, length, buffer.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++)
    trimmed.copyToChannel(buffer.getChannelData(channel).subarray(first, first + length), channel);
  return trimmed;
}
