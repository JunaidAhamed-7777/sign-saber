import { monoForAnalysis } from '../../src/beatmap/dsp/resample';
import { ANALYSIS_SR } from '../../src/core/constants';

interface Check {
  name: string;
  passed: boolean;
  actual: Record<string, number | boolean>;
}
const checks: Check[] = [];
const seconds = 6;
const sineAmplitude = 0.25;
const expectedRms = sineAmplitude / Math.sqrt(2);
const rms = (values: Float32Array, trim: number): number => {
  let sum = 0;
  for (let i = trim; i < values.length - trim; i++) sum += values[i]! ** 2;
  return Math.sqrt(sum / (values.length - trim * 2));
};
async function run(): Promise<void> {
  try {
    for (const sourceSr of [16000, 32000, 44100, 48000]) {
      const impulse = new AudioBuffer({
        length: sourceSr * seconds,
        sampleRate: sourceSr,
        numberOfChannels: 1,
      });
      impulse.getChannelData(0)[sourceSr * 2] = 1;
      const resampled = await monoForAnalysis(impulse);
      let peak = 0,
        total = 0;
      for (let i = 0; i < resampled.length; i++) {
        if (Math.abs(resampled[i]!) > Math.abs(resampled[peak]!)) peak = i;
        total += resampled[i]!;
      }
      const integralRatio = (total / ANALYSIS_SR) * sourceSr;
      const length = resampled.length,
        peakErrorSamples = Math.abs(peak - ANALYSIS_SR * 2);
      const owned = structuredClone(resampled, { transfer: [resampled.buffer as ArrayBuffer] });
      const transferDetached = resampled.byteLength === 0 && owned.length === length;
      const sourceRetained = impulse.getChannelData(0).length === sourceSr * seconds;
      checks.push({
        name: `impulse ${sourceSr}→${ANALYSIS_SR}`,
        passed:
          length === seconds * ANALYSIS_SR &&
          peakErrorSamples <= 1 &&
          Math.abs(integralRatio - 1) <= 0.05 &&
          transferDetached &&
          sourceRetained,
        actual: {
          sourceSr,
          outputSamples: length,
          peakErrorSamples,
          integralRatio,
          transferDetached,
          sourceRetained,
        },
      });
      const stereo = new AudioBuffer({
        length: sourceSr * seconds,
        sampleRate: sourceSr,
        numberOfChannels: 2,
      });
      for (let i = 0; i < stereo.length; i++) {
        const sample = sineAmplitude * Math.sin((i * 2 * Math.PI * 1000) / sourceSr);
        stereo.getChannelData(0)[i] = sample;
        stereo.getChannelData(1)[i] = -sample;
      }
      const cancel = await monoForAnalysis(stereo),
        antiPhaseRms = rms(cancel, ANALYSIS_SR);
      checks.push({
        name: `antiphase stereo ${sourceSr}`,
        passed: antiPhaseRms <= 1e-7,
        actual: { sourceSr, antiPhaseRms },
      });
      for (let i = 0; i < stereo.length; i++) stereo.getChannelData(1)[i] = stereo.getChannelData(0)[i]!;
      const same = await monoForAnalysis(stereo),
        actualRms = rms(same, ANALYSIS_SR);
      checks.push({
        name: `1 kHz amplitude ${sourceSr}`,
        passed: Math.abs(actualRms - expectedRms) / expectedRms <= 0.01,
        actual: { sourceSr, expectedRms, actualRms },
      });
    }
    const high = new AudioBuffer({ length: 48000 * seconds, sampleRate: 48000, numberOfChannels: 1 });
    for (let i = 0; i < high.length; i++)
      high.getChannelData(0)[i] = sineAmplitude * Math.sin((i * 2 * Math.PI * 16000) / 48000);
    const lowPassed = await monoForAnalysis(high),
      aliasRms = rms(lowPassed, ANALYSIS_SR);
    checks.push({
      name: '16 kHz rejects above analysis Nyquist',
      passed: aliasRms <= 0.01,
      actual: { aliasRms },
    });
    const library = (await (await fetch('/assets/tracks/manifest.json')).json()) as {
      tracks: { slug: string; durationMs: number }[];
    };
    for (const entry of library.tracks) {
      const bytes = await (await fetch(`/assets/tracks/${entry.slug}/audio.mp3`)).arrayBuffer();
      const canonical = new Float32Array(await (await fetch(`/canonical-start/${entry.slug}`)).arrayBuffer());
      for (const sampleRate of [22050, 44100, 48000]) {
        const decoder = new OfflineAudioContext(1, 1, sampleRate);
        const decoded = await decoder.decodeAudioData(bytes.slice(0));
        const durationErrorMs = decoded.duration * 1000 - entry.durationMs;
        checks.push({
          name: `gapless ${entry.slug} at ${sampleRate}`,
          passed: Math.abs(durationErrorMs) <= 1000 / ANALYSIS_SR + Number.EPSILON * entry.durationMs,
          actual: {
            sampleRate,
            decodedSamples: decoded.length,
            decodedDurationMs: decoded.duration * 1000,
            canonicalDurationMs: entry.durationMs,
            durationErrorMs,
          },
        });
        if (sampleRate === 44100) {
          const prefix = new AudioBuffer({
            length: sampleRate * 2,
            sampleRate,
            numberOfChannels: decoded.numberOfChannels,
          });
          for (let channel = 0; channel < prefix.numberOfChannels; channel++)
            prefix.copyToChannel(decoded.getChannelData(channel).subarray(0, prefix.length), channel);
          const native = await monoForAnalysis(prefix);
          let bestLag = 0,
            bestCorrelation = -Infinity;
          // These are explicit synthetic/asset test search bounds, not game tunables.
          for (let lag = -1024; lag <= 1024; lag++) {
            let xy = 0,
              xx = 0,
              yy = 0;
            for (let i = 1024; i < canonical.length - 1024; i += 16) {
              const x = canonical[i]!,
                y = native[i + lag]!;
              xy += x * y;
              xx += x * x;
              yy += y * y;
            }
            const correlation = xy / Math.sqrt(xx * yy);
            if (correlation > bestCorrelation) {
              bestCorrelation = correlation;
              bestLag = lag;
            }
          }
          checks.push({
            name: `source sample zero ${entry.slug}`,
            passed: Math.abs(bestLag) <= 1 && bestCorrelation >= 0.99,
            actual: { bestLagAnalysisSamples: bestLag, bestCorrelation },
          });
        }
      }
    }
    document.getElementById('result')!.textContent = JSON.stringify({
      lane: 'synthetic-browser-audio-correctness',
      userAgent: navigator.userAgent,
      analysisSampleRate: ANALYSIS_SR,
      passed: checks.every((check) => check.passed),
      checks,
    });
  } catch (error) {
    document.getElementById('result')!.textContent = JSON.stringify({
      lane: 'synthetic-browser-audio-correctness',
      passed: false,
      checks,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
void run().then(() =>
  fetch('/result', { method: 'POST', body: document.getElementById('result')!.textContent ?? '' }),
);
