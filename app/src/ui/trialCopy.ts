/** Player-facing copy for the camera-free runs (dataset level and auto-play demo). Neutral by request;
 * the source is still recorded in exported diagnostics (evidence lanes). */
import { useStore } from '../state/store';
import { strings } from './strings';

export function trialCopy(source: 'annotations' | 'performer' | null) {
  void source;
  return {
    source: strings.runPlaying,
    banner: '',
    preparing: strings.runGetReady,
    preroll: strings.runGetReady,
    limitations: '',
    figure: '',
    savedFigure: '',
    results: strings.results,
    motion: strings.motion,
    motionAbout: strings.motionAbout,
    controls: strings.runControls,
  };
}
export function useTrialCopy() {
  return trialCopy(useStore((s) => s.trialSource));
}
