/** Honest copy for the labelled non-camera trials; the source decides every label. */
import { useStore } from '../state/store';
import { strings } from './strings';

export function trialCopy(source: 'annotations' | 'performer' | null) {
  const performer = source === 'performer';
  return {
    source: performer ? strings.performerReplay : strings.datasetSource,
    banner: performer ? strings.performerReplay : strings.datasetReplay,
    preparing: performer ? strings.performerLoading : strings.datasetPreparing,
    preroll: performer ? strings.performerPreroll : strings.datasetPreroll,
    limitations: performer ? strings.performerLimitations : strings.datasetLimitations,
    figure: performer ? strings.performerFigure : strings.datasetFigure,
    savedFigure: performer ? strings.performerFigure : strings.datasetSavedFigure,
    results: performer ? strings.performerResults : strings.datasetResults,
    motion: performer ? strings.performerMotion : strings.datasetMotion,
    motionAbout: performer ? strings.performerMotionAbout : strings.datasetMotionAbout,
    controls: strings.datasetControls,
  };
}
export function useTrialCopy() {
  return trialCopy(useStore((s) => s.trialSource));
}
