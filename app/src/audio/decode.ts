/**
 * Sign Saber — audio/decode.ts
 *
 * Responsibility: decodeAudioData for playback and OfflineAudioContext resampling to ANALYSIS_SR for the generator.
 * Spec: docs/15-audio-playback-sync.md §Decoding
 * Inputs: ArrayBuffer
 * Outputs: AudioBuffer(s)
 *
 * Implemented for the first playable spine. Replay/unit evidence is separate from live-camera acceptance.
 */
import {
  ANALYSIS_SR,
  MAX_UPLOAD_BYTES,
  MIN_TRACK_MS,
  MAX_TRACK_MS,
  MAX_DECODED_PCM_BYTES,
} from '../core/constants';
import { applyGaplessTrim } from './gapless';

export function validateDecodedAudio(buffer: AudioBuffer): void {
  const durationMs = buffer.duration * 1000;
  if (!Number.isFinite(durationMs) || durationMs < MIN_TRACK_MS || durationMs > MAX_TRACK_MS) {
    throw new Error(`Choose audio between ${MIN_TRACK_MS / 1000} and ${MAX_TRACK_MS / 1000} seconds.`);
  }
  if (
    buffer.length <= 0 ||
    buffer.numberOfChannels <= 0 ||
    buffer.length * buffer.numberOfChannels * Float32Array.BYTES_PER_ELEMENT > MAX_DECODED_PCM_BYTES
  ) {
    throw new Error('Decoded audio is too large or empty. Choose a shorter file.');
  }
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const samples = buffer.getChannelData(channel);
    for (let index = 0; index < samples.length; index++)
      if (!Number.isFinite(samples[index])) throw new Error('Audio contains invalid samples.');
  }
}
export async function decodeForPlayback(bytes: ArrayBuffer, ctx: BaseAudioContext): Promise<AudioBuffer> {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES)
    throw new Error('Audio file is empty or exceeds the upload size limit.');
  let buffer: AudioBuffer;
  try {
    buffer = await ctx.decodeAudioData(bytes.slice(0));
  } catch {
    throw new Error('This browser could not decode that audio. Try MP3 or WAV.');
  }
  // Some Chromium builds ignore iTunSMPB; normalize to the same samples the canonical decode uses.
  buffer = applyGaplessTrim(buffer, new Uint8Array(bytes), (channels, length, rate) =>
    ctx.createBuffer(channels, length, rate),
  );
  validateDecodedAudio(buffer);
  return buffer;
}
export async function decodeForAnalysis(
  bytes: ArrayBuffer,
): Promise<{ mono: Float32Array<ArrayBuffer>; sampleRate: number }> {
  const decoder = new OfflineAudioContext(1, 1, ANALYSIS_SR);
  const buffer = await decodeForPlayback(bytes, decoder);
  const context = new OfflineAudioContext(1, Math.ceil(buffer.duration * ANALYSIS_SR), ANALYSIS_SR);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start();
  const result = await context.startRendering();
  source.disconnect();
  return { mono: result.getChannelData(0).slice(), sampleRate: ANALYSIS_SR };
}
