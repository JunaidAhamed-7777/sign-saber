/**
 * Sign Saber — render/devFx.ts (development builds only)
 *
 * Responsibility: A visual QA harness for the renderer's decorative effects. It is installed only when
 * `import.meta.env.DEV` is true (the dynamic import is removed from production bundles).
 * Spec: docs/17-testing-and-qa.md (visual inspection), docs/11 and docs/12 effect looks.
 *
 * It never emits game events, never scores, and never feeds the input pipeline: it calls renderer
 * preview methods directly. Screenshots taken with it are visual evidence of effect appearance only,
 * not gameplay, tracking or performance evidence.
 */
import type { NoteType } from '../beatmap/types';

export interface DevFxTarget {
  previewImpact(type: NoteType, col: 0 | 1 | 2 | 3, row: 0 | 1 | 2, angle?: number): void;
  previewHands(enabled: boolean): void;
}

declare global {
  interface Window {
    signSaberDevFx?: {
      readonly renderer: DevFxTarget;
      impact(type: NoteType, col?: 0 | 1 | 2 | 3, row?: 0 | 1 | 2, angle?: number): void;
      volley(): void;
      hands(enabled: boolean): void;
    };
  }
}

export function installDevFx(renderer: DevFxTarget): void {
  window.signSaberDevFx = {
    renderer,
    impact: (type, col = 1, row = 1, angle) => renderer.previewImpact(type, col, row, angle),
    volley: () => {
      renderer.previewImpact('slash', 0, 1, Math.PI / 4);
      renderer.previewImpact('smash', 2, 1);
      renderer.previewImpact('beam', 3, 2);
      renderer.previewImpact('slash', 1, 0, Math.PI / 2);
    },
    hands: (enabled) => renderer.previewHands(enabled),
  };
}
