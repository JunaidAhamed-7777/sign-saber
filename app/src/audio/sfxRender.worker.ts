/**
 * Sign Saber — audio/sfxRender.worker.ts
 *
 * Responsibility: Off-main-thread SFX synthesis and tonal-centre analysis.
 * Spec: docs/15-audio-playback-sync.md §6 SFX bus
 * Inputs: SfxWorkerRequest
 * Outputs: SfxWorkerResponse (rendered channels are transferred, not copied)
 */
import { renderSfx } from './sfxSynth';
import type { SfxId, SfxVoicing } from './sfxSynth';
import { estimateFromFrames } from './tonic';
import type { TonalCenter } from './tonic';

export type SfxWorkerRequest =
  | { type: 'render'; key: string; id: SfxId; sampleRate: number; voicing: SfxVoicing }
  | { type: 'tonic'; key: string; frames: Float32Array; sampleRate: number };
export type SfxWorkerResponse =
  | { type: 'render'; key: string; channels: Float32Array[] }
  | { type: 'tonic'; key: string; center: TonalCenter | null }
  | { type: 'error'; key: string; message: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SfxWorkerRequest>) => void) | null;
  postMessage(message: SfxWorkerResponse, transfer?: Transferable[]): void;
};
scope.onmessage = (event) => {
  const request = event.data;
  try {
    if (request.type === 'render') {
      const channels = renderSfx(request.id, request.sampleRate, request.voicing);
      scope.postMessage(
        { type: 'render', key: request.key, channels },
        channels.map((channel) => channel.buffer),
      );
    } else if (request.type === 'tonic') {
      scope.postMessage({
        type: 'tonic',
        key: request.key,
        center: estimateFromFrames(request.frames, request.sampleRate),
      });
    }
  } catch (error) {
    scope.postMessage({
      type: 'error',
      key: request.key,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
