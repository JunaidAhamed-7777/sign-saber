import { arrangeAudio } from '../../src/audio/arrange';
import { monoForAnalysis } from '../../src/beatmap/dsp/resample';
import { sha256 } from '../../src/beatmap/bundled';
import { analyzeMono, mapFromAnalysis } from '../../src/beatmap/pipeline';
import { ANALYSIS_SR } from '../../src/core/constants';
import type { BeatmapV1, BundledTrackManifest } from '../../src/beatmap/types';

async function run(): Promise<void> {
  const checks: { name: string; passed: boolean; actual: unknown }[] = [];
  const arrangements: unknown[] = [];
  try {
    const library = (await (await fetch('/assets/tracks/manifest.json')).json()) as BundledTrackManifest;
    for (const track of library.tracks) {
      const sourceBytes = await (await fetch(track.audioUrl)).arrayBuffer();
      if ((await sha256(sourceBytes)) !== track.hashes.audioSha256)
        throw new Error('Original audio hash mismatch');
      const map = (await (await fetch(track.difficultyMaps.normal)).json()) as BeatmapV1;
      const metadata = (await (await fetch(`/assets/tracks/${track.slug}/generation.json`)).json()) as {
        analysis: { tempoConfidence: number };
      };
      const decoder = new OfflineAudioContext(1, 1, 44100);
      const original = await decoder.decodeAudioData(sourceBytes);
      const arranged = await arrangeAudio(
        original,
        { ...map.analysis, tempoConfidence: metadata.analysis.tempoConfidence },
        {
          title: track.title,
          artist: track.artist,
          source: 'bundled',
          sourceAudioSha256: track.hashes.audioSha256,
        },
      );
      const outputBytes = await arranged.file.arrayBuffer();
      const decoded = await decoder.decodeAudioData(outputBytes.slice(0));
      const mono = await monoForAnalysis(decoded);
      const canonical = new ArrayBuffer(mono.length * 4),
        view = new DataView(canonical);
      for (let i = 0; i < mono.length; i++) view.setFloat32(i * 4, mono[i]!, true);
      const outputHash = await sha256(outputBytes),
        pcmHash = await sha256(canonical);
      checks.push({
        name: `real 80-second WAV ${track.slug}`,
        passed:
          decoded.duration === 80 &&
          outputHash === arranged.edit.outputAudioSha256 &&
          pcmHash === arranged.edit.outputCanonicalPcmSha256,
        actual: {
          outputBytes: outputBytes.byteLength,
          decodedSeconds: decoded.duration,
          fileSha256: outputHash,
          canonicalPcmSha256: pcmHash,
        },
      });
      const analysis = analyzeMono(mono, ANALYSIS_SR, decoded.duration * 1000);
      const generated = mapFromAnalysis(
        analysis,
        { title: arranged.edit.outputTitle, artist: track.artist, source: 'upload', sourceHash: outputHash },
        'normal',
      );
      const mapBytes = new TextEncoder().encode(JSON.stringify(generated.map));
      const mapHash = await sha256(mapBytes.buffer);
      checks.push({
        name: `fresh derivative chart ${track.slug}`,
        passed:
          generated.map.song.durationMs === 80000 &&
          generated.map.song.sourceHash === outputHash &&
          outputHash !== track.hashes.audioSha256 &&
          generated.map.notes.length > 0,
        actual: {
          durationMs: generated.map.song.durationMs,
          notes: generated.map.notes.length,
          obstacles: generated.map.obstacles.length,
          mapSha256: mapHash,
          generatorVersion: generated.map.generatorVersion,
          warnings: generated.warnings,
        },
      });
      const rendered = arranged.buffer.getChannelData(0);
      checks.push({
        name: `continuous fades ${track.slug}`,
        passed:
          rendered[0] === 0 &&
          rendered.at(-1) === 0 &&
          arranged.edit.highlight.startMs === 10000 &&
          arranged.edit.highlight.endMs === 70000 &&
          arranged.edit.oldChartReused === false,
        actual: {
          firstSample: rendered[0],
          lastSample: rendered.at(-1),
          sourceStartMs: arranged.edit.sourceStartMs,
          sourceEndMs: arranged.edit.sourceEndMs,
          selectionReason: arranged.edit.selectionReason,
        },
      });
      arrangements.push({
        track: track.slug,
        edit: arranged.edit,
        generatedMapSha256: mapHash,
        generatedMapNotes: generated.map.notes.length,
      });
    }
    document.getElementById('result')!.textContent = JSON.stringify({
      lane: 'browser-audio-arrangement-correctness',
      userAgent: navigator.userAgent,
      passed: checks.every((check) => check.passed),
      checks,
      arrangements,
    });
  } catch (error) {
    document.getElementById('result')!.textContent = JSON.stringify({
      lane: 'browser-audio-arrangement-correctness',
      passed: false,
      checks,
      arrangements,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
void run().then(() =>
  fetch('/result', { method: 'POST', body: document.getElementById('result')!.textContent ?? '' }),
);
