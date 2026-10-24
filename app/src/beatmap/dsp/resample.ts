import {
  ANALYSIS_SR,
  DSP_EPSILON,
  GEN_WORK_CHUNK_MS,
  RESAMPLE_PHASES,
  RESAMPLE_TAPS,
} from '../../core/constants';

let tableRate = 0;
let coefficientTable: Float32Array | null = null;
function coefficients(sourceSr: number): Float32Array {
  if (coefficientTable && tableRate === sourceSr) return coefficientTable;
  const cutoff = Math.min(1, ANALYSIS_SR / sourceSr);
  const table = new Float32Array(RESAMPLE_PHASES * RESAMPLE_TAPS);
  const half = RESAMPLE_TAPS / 2;
  for (let phase = 0; phase < RESAMPLE_PHASES; phase++) {
    const fraction = phase / RESAMPLE_PHASES;
    let total = 0;
    for (let tap = 0; tap < RESAMPLE_TAPS; tap++) {
      const x = tap - half + 1 - fraction;
      const angle = Math.PI * cutoff * x;
      const sinc = Math.abs(angle) <= DSP_EPSILON ? 1 : Math.sin(angle) / angle;
      const window = Math.abs(x) >= half ? 0 : 0.5 + 0.5 * Math.cos((Math.PI * x) / half);
      const value = cutoff * sinc * window;
      table[phase * RESAMPLE_TAPS + tap] = value;
      total += value;
    }
    for (let tap = 0; tap < RESAMPLE_TAPS; tap++)
      table[phase * RESAMPLE_TAPS + tap] = table[phase * RESAMPLE_TAPS + tap]! / total;
  }
  coefficientTable = table;
  tableRate = sourceSr;
  return table;
}

/** Equal-weight mono and zero-phase band-limited conversion into an owned transferable buffer.
 * AudioBufferSourceNode's native rate conversion did not pass the alias/impulse fixtures;
 * analysis therefore uses explicit windowed-sinc coefficients instead of that conversion.
 */
export async function monoForAnalysis(
  buffer: AudioBuffer,
  checkCancelled?: () => void,
): Promise<Float32Array<ArrayBuffer>> {
  if (
    !Number.isFinite(buffer.sampleRate) ||
    buffer.sampleRate <= 0 ||
    buffer.length <= 0 ||
    buffer.numberOfChannels <= 0
  )
    throw new Error('Invalid decoded audio buffer');
  const mono = new Float32Array(buffer.length);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, channel) =>
    buffer.getChannelData(channel),
  );
  if (channels.some((channel) => channel.length !== buffer.length))
    throw new Error('Decoded channel length mismatch');
  let lastYield = performance.now();
  const checkpoint = async (): Promise<void> => {
    checkCancelled?.();
    if (performance.now() - lastYield >= GEN_WORK_CHUNK_MS) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      lastYield = performance.now();
      checkCancelled?.();
    }
  };
  const sourceChunk = Math.max(1, Math.ceil((buffer.sampleRate * GEN_WORK_CHUNK_MS) / 1000));
  for (let first = 0; first < mono.length; first += sourceChunk) {
    const end = Math.min(mono.length, first + sourceChunk);
    for (let sample = first; sample < end; sample++) {
      let sum = 0;
      for (const channel of channels) {
        if (!Number.isFinite(channel[sample]!)) throw new Error('Decoded audio contains invalid samples');
        sum += channel[sample]!;
      }
      mono[sample] = sum / channels.length;
    }
    await checkpoint();
  }
  if (buffer.sampleRate === ANALYSIS_SR) return mono;
  const table = coefficients(buffer.sampleRate);
  const output = new Float32Array(Math.ceil((buffer.length * ANALYSIS_SR) / buffer.sampleRate));
  const half = RESAMPLE_TAPS / 2;
  const outputChunk = Math.max(1, Math.ceil((ANALYSIS_SR * GEN_WORK_CHUNK_MS) / 1000));
  for (let first = 0; first < output.length; first += outputChunk) {
    const end = Math.min(output.length, first + outputChunk);
    for (let sample = first; sample < end; sample++) {
      const position = (sample * buffer.sampleRate) / ANALYSIS_SR,
        base = Math.floor(position);
      const phase = Math.min(RESAMPLE_PHASES - 1, Math.floor((position - base) * RESAMPLE_PHASES));
      const start = base - half + 1,
        offset = phase * RESAMPLE_TAPS;
      let value = 0;
      for (let tap = 0; tap < RESAMPLE_TAPS; tap++) value += (mono[start + tap] ?? 0) * table[offset + tap]!;
      output[sample] = value;
    }
    await checkpoint();
  }
  return output;
}
