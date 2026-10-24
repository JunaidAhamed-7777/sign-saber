import { create } from 'zustand';
import type { BeatmapV1, BundledTrackEntry, Difficulty } from '../beatmap/types';
import type { CameraSetupState, MenuPointerState } from '../core/menuInput';
import type { GameState, PauseReason } from '../core/stateMachine';
import type { SessionStats } from '../core/types';
export interface DisplayState {
  state: GameState;
  epoch: number;
  pauseReason: PauseReason | null;
  library: BundledTrackEntry[];
  libraryLoading: boolean;
  libraryError: string | null;
  selectedSlug: string | null;
  map: BeatmapV1 | null;
  difficulty: Difficulty;
  loading: boolean;
  error: string | null;
  status: string;
  camera: CameraSetupState;
  /** Kind of the running camera stream source; null when no camera stream is set up. */
  cameraSource: 'webcam' | 'dataset' | null;
  cameraStage: string;
  calibrationReady: boolean;
  trackingReady: boolean;
  figureAvailable: boolean;
  maskAvailable: boolean;
  audioReady: boolean;
  preview: boolean;
  volume: number;
  generation: { active: boolean; fraction: number; stage: string };
  arrangement: {
    active: boolean;
    stage: string;
    fraction: number;
    ready: boolean;
    sourceTitle: string;
    durationMs: number | null;
    error: string | null;
  } | null;
  warnings: string[];
  countdown: number | null;
  hand: 'left' | 'right';
  pointer: MenuPointerState | null;
  hud: {
    score: number;
    combo: number;
    accuracy: number | null;
    multiplier: number;
    songTimeMs: number;
    durationMs: number;
    left: string;
    right: string;
    leftPresent: boolean;
    rightPresent: boolean;
    leftCharge: number;
    rightCharge: number;
    judgement: string;
  };
  results: SessionStats | null;
  highlightAt: number | null;
  calm: boolean;
  credits: boolean;
  stats: boolean;
  replay: boolean;
  fatal: string | null;
}
const initial: DisplayState = {
  state: 'BOOT',
  epoch: 0,
  pauseReason: null,
  library: [],
  libraryLoading: true,
  libraryError: null,
  selectedSlug: null,
  map: null,
  difficulty: 'normal',
  loading: false,
  error: null,
  status: '',
  camera: { state: 'not-set-up', mode: 'browse', calibrationValid: false, error: null },
  cameraSource: null,
  cameraStage: '',
  calibrationReady: false,
  trackingReady: false,
  figureAvailable: false,
  maskAvailable: false,
  audioReady: false,
  preview: false,
  volume: 0.8,
  generation: { active: false, fraction: 0, stage: '' },
  arrangement: null,
  warnings: [],
  countdown: null,
  hand: 'right',
  pointer: null,
  hud: {
    score: 0,
    combo: 0,
    accuracy: null,
    multiplier: 1,
    songTimeMs: 0,
    durationMs: 0,
    left: 'none',
    right: 'none',
    leftPresent: false,
    rightPresent: false,
    leftCharge: 0,
    rightCharge: 0,
    judgement: '',
  },
  results: null,
  highlightAt: null,
  calm: false,
  credits: false,
  stats: false,
  replay: false,
  fatal: null,
};
export const useStore = create<DisplayState>(() => initial);
export function display(patch: Partial<DisplayState>): void {
  useStore.setState(patch);
}
