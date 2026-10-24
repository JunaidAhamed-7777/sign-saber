import { GENERATOR_VERSION, GEN_PROGRESS_WEIGHTS } from '../core/constants';
import type { Difficulty } from './types';
import type { AnalysisResult, GeneratorProgress, SongMeta } from './pipeline';
import { analyzeMono, GeneratorError, mapFromAnalysis } from './pipeline';

export type GenRequest =
  | {
      type: 'analyze';
      jobId: string;
      difficulty: Difficulty;
      mono: Float32Array;
      sr: number;
      durationMs: number;
      meta: SongMeta;
    }
  | { type: 'assign'; jobId: string; difficulty: Difficulty; meta: SongMeta; analysis?: AnalysisResult }
  | { type: 'cancel'; jobId: string };
export type GenResponse =
  | { type: 'progress'; jobId: string; stage: GeneratorProgress['stage']; fraction: number }
  | {
      type: 'analysis';
      jobId: string;
      sourceHash: string;
      analysis: AnalysisResult;
      generatorVersion: number;
    }
  | { type: 'done'; jobId: string; map: ReturnType<typeof mapFromAnalysis>['map']; warnings: string[] }
  | { type: 'error'; jobId: string; code: string; message: string };

let retained: { hash: string; analysis: AnalysisResult } | null = null;
self.onmessage = (event: MessageEvent<GenRequest>) => {
  const message = event.data;
  if (message.type === 'cancel') return; // Client termination makes cancellation independent of synchronous FFT work.
  const send = (response: GenResponse): void => self.postMessage(response);
  try {
    let analysis: AnalysisResult;
    if (message.type === 'analyze') {
      analysis = analyzeMono(message.mono, message.sr, message.durationMs, (p) =>
        send({ type: 'progress', jobId: message.jobId, ...p }),
      );
      retained = { hash: message.meta.sourceHash, analysis };
      send({
        type: 'analysis',
        jobId: message.jobId,
        sourceHash: message.meta.sourceHash,
        analysis,
        generatorVersion: GENERATOR_VERSION,
      });
    } else {
      if (message.analysis) retained = { hash: message.meta.sourceHash, analysis: message.analysis };
      if (!retained || retained.hash !== message.meta.sourceHash)
        throw new GeneratorError('invalid', 'Analysis cache is unavailable; choose this file again');
      analysis = retained.analysis;
    }
    const result = mapFromAnalysis(analysis, message.meta, message.difficulty);
    send({
      type: 'progress',
      jobId: message.jobId,
      stage: 'assign',
      fraction: 1 - GEN_PROGRESS_WEIGHTS.validate,
    });
    send({ type: 'progress', jobId: message.jobId, stage: 'validate', fraction: 1 });
    send({ type: 'done', jobId: message.jobId, ...result });
  } catch (error) {
    send({
      type: 'error',
      jobId: message.jobId,
      code: error instanceof GeneratorError ? error.code : 'invalid',
      message: error instanceof Error ? error.message : 'Audio analysis failed',
    });
  }
};
