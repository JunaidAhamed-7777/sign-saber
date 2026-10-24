import { ANALYSIS_SR, ASSET_TEXT_MAX_CHARS, GENERATOR_VERSION, MAX_UPLOAD_BYTES } from '../core/constants';
import type { BeatmapV1, Difficulty } from './types';
import type { AnalysisResult, GeneratorProgress, SongMeta } from './pipeline';
import type { GenRequest, GenResponse } from './generator.worker';
import { GeneratorError } from './pipeline';
import { BeatmapCache } from './cache';
import { validAnalysis } from './cache';
import { sha256 } from './bundled';
import { isBoundedText, isFiniteNumber, isRecord, validateBeatmap } from './validate';
import { monoForAnalysis } from './dsp/resample';
import { decodeForPlayback } from '../audio/decode';

export interface GeneratedSong {
  map: BeatmapV1;
  warnings: string[];
  buffer: AudioBuffer;
}
interface Pending {
  id: string;
  sourceHash: string;
  difficulty: Difficulty;
  resolve: (value: { map: BeatmapV1; warnings: string[] }) => void;
  reject: (reason: Error) => void;
  progress: ((value: GeneratorProgress) => void) | undefined;
}

/** One source/job at a time. Supersession rejects immediately and kills synchronous worker work. */
export class GeneratorClient {
  private worker: Worker | null = null;
  private pending: Pending | null = null;
  private epoch = 0;
  private cancelCurrent: (() => void) | null = null;
  private readonly cache = new BeatmapCache();
  constructor(private readonly decodeContext?: BaseAudioContext) {}
  private getWorker(): Worker {
    if (!this.worker) {
      const worker = new Worker(new URL('./generator.worker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      const fail = (message: string): void => {
        this.pending?.reject(new Error(message));
        this.pending = null;
        worker.terminate();
        if (this.worker === worker) this.worker = null;
      };
      worker.onmessage = (event: MessageEvent<unknown>) => {
        if (this.worker !== worker) return;
        const raw = event.data,
          current = this.pending;
        if (!current) return;
        if (!isRecord(raw) || typeof raw.jobId !== 'string') {
          fail('The audio worker returned an invalid message. Retry or choose bundled music.');
          return;
        }
        if (raw.jobId !== current.id) return;
        const response = raw as unknown as GenResponse;
        if (response.type === 'progress') {
          if (
            !['stft', 'flux', 'onsets', 'tempo', 'beats', 'energy', 'assign', 'validate'].includes(
              response.stage,
            ) ||
            !isFiniteNumber(response.fraction) ||
            response.fraction < 0 ||
            response.fraction > 1
          ) {
            fail('The audio worker returned invalid progress. Retry this file.');
            return;
          }
          current.progress?.({ stage: response.stage, fraction: response.fraction });
        } else if (response.type === 'analysis') {
          if (
            response.generatorVersion !== GENERATOR_VERSION ||
            response.sourceHash !== current.sourceHash ||
            !validAnalysis(response.analysis)
          ) {
            fail('The audio worker returned invalid analysis. Retry this file.');
            return;
          }
          void this.cache.putAnalysis(response.sourceHash, response.analysis).catch(() => {
            /* Storage is optional. */
          });
        } else if (response.type === 'done') {
          const checked = validateBeatmap(response.map);
          if (
            !checked.valid ||
            !checked.map ||
            checked.map.song.sourceHash !== current.sourceHash ||
            checked.map.difficulty !== current.difficulty ||
            !Array.isArray(response.warnings) ||
            response.warnings.length > ASSET_TEXT_MAX_CHARS ||
            !response.warnings.every(isBoundedText)
          ) {
            fail('The audio worker returned an invalid chart. Retry or choose bundled music.');
            return;
          }
          this.pending = null;
          current.resolve({ map: checked.map, warnings: response.warnings });
        } else if (response.type === 'error') {
          this.pending = null;
          current.reject(
            new Error(
              isBoundedText(response.message)
                ? response.message
                : 'Audio analysis failed. Retry or choose bundled music.',
            ),
          );
        } else fail('The audio worker returned an unknown message. Retry this file.');
      };
      worker.onerror = (event) => {
        if (this.worker !== worker) return;
        const error = new Error(
          event.message || 'The audio analysis worker stopped. Retry or choose bundled music.',
        );
        this.pending?.reject(error);
        this.pending = null;
        this.worker?.terminate();
        this.worker = null;
      };
    }
    return this.worker;
  }
  async generate(
    file: File,
    difficulty: Difficulty,
    onProgress?: (value: GeneratorProgress) => void,
    metadata?: { title: string; artist: string },
  ): Promise<GeneratedSong> {
    this.cancel();
    const epoch = this.epoch;
    const warnings: string[] = [];
    const cancelled = new Promise<never>((_, reject) => {
      this.cancelCurrent = () => reject(new GeneratorError('cancelled', 'Audio analysis cancelled'));
    });
    const current = (): void => {
      if (epoch !== this.epoch) throw new GeneratorError('cancelled', 'Audio analysis cancelled');
    };
    const run = async (): Promise<GeneratedSong> => {
      if (metadata && (!isBoundedText(metadata.title) || !isBoundedText(metadata.artist)))
        throw new GeneratorError('invalid', 'Invalid local audio title/artist metadata');
      const title =
        metadata?.title ?? (file.name.replace(/\.[^.]+$/, '').slice(0, ASSET_TEXT_MAX_CHARS) || 'Untitled');
      const artist = metadata?.artist ?? 'Local audio';
      if (!file.size || file.size > MAX_UPLOAD_BYTES)
        throw new GeneratorError(
          'tooLarge',
          `Choose a non-empty audio file smaller than ${MAX_UPLOAD_BYTES / 1024 / 1024} MiB`,
        );
      onProgress?.({ stage: 'read', fraction: 0 });
      const bytes = await file.arrayBuffer();
      current();
      const sourceHash = await sha256(bytes);
      current();
      let cached: { map: BeatmapV1; warnings: string[] } | undefined, analysis: AnalysisResult | undefined;
      try {
        cached = await this.cache.get(sourceHash, difficulty);
        if (!cached) analysis = await this.cache.getAnalysis(sourceHash);
      } catch {
        warnings.push('cacheUnavailable');
      }
      current();
      onProgress?.({ stage: 'decode', fraction: 0 });
      const decoder = this.decodeContext ?? new OfflineAudioContext(1, 1, ANALYSIS_SR * 2);
      const buffer = await decodeForPlayback(bytes, decoder);
      current();
      if (cached) {
        onProgress?.({ stage: 'cache', fraction: 1 });
        return {
          ...cached,
          map: { ...cached.map, song: { ...cached.map.song, title, artist } },
          warnings: [...new Set([...cached.warnings, ...warnings])],
          buffer,
        };
      }
      const meta: SongMeta = { title, artist, sourceHash, source: 'upload' };
      const jobId = `generation-${epoch}`;
      let request: GenRequest;
      let transfer: Transferable[] = [];
      if (analysis) request = { type: 'assign', jobId, difficulty, meta, analysis };
      else {
        onProgress?.({ stage: 'resample', fraction: 0 });
        const mono = await monoForAnalysis(buffer, current);
        current();
        request = {
          type: 'analyze',
          jobId,
          difficulty,
          meta,
          mono,
          sr: ANALYSIS_SR,
          durationMs: (mono.length / ANALYSIS_SR) * 1000,
        };
        transfer = [mono.buffer as ArrayBuffer];
      }
      const generated = await new Promise<{ map: BeatmapV1; warnings: string[] }>((resolve, reject) => {
        this.pending = { id: jobId, sourceHash, difficulty, resolve, reject, progress: onProgress };
        this.getWorker().postMessage(request, transfer);
      });
      current();
      try {
        await this.cache.put(generated.map, generated.warnings);
      } catch {
        warnings.push('cacheUnavailable');
      }
      current();
      return { ...generated, warnings: [...new Set([...generated.warnings, ...warnings])], buffer };
    };
    try {
      return await Promise.race([run(), cancelled]);
    } finally {
      if (epoch === this.epoch) this.cancelCurrent = null;
    }
  }
  cancel(): void {
    this.epoch++;
    this.cancelCurrent?.();
    this.cancelCurrent = null;
    this.pending?.reject(new GeneratorError('cancelled', 'Audio analysis cancelled'));
    this.pending = null;
    this.worker?.terminate();
    this.worker = null;
  }
  dispose(): void {
    this.cancel();
    void this.cache.close().catch(() => {
      /* Optional cache cleanup. */
    });
  }
}
