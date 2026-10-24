/** Menu input is separate from capture-time scored gameplay. docs/25. */
import type { Gesture, Hand, Vec2 } from './types';
export interface CameraSetupState {
  state: 'not-set-up' | 'setting-up' | 'ready' | 'error';
  mode: 'browse' | 'camera-setup';
  calibrationValid: boolean;
  error: string | null;
}
export interface MenuPointerState {
  hand: Hand;
  visible: boolean;
  xCss: number;
  yCss: number;
  phase: 'unavailable' | 'idle' | 'hover' | 'armed' | 'confirming' | 'latched';
  targetId: string | null;
  progress: number;
}
export interface MenuActivation {
  targetId: string;
  screenEpoch: number;
  layoutEpoch: number;
  hand: Hand;
  tCapture: number;
}
export interface MenuRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface MenuReachBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}
export interface MenuTarget {
  id: string;
  bounds: MenuRect;
  enabled: boolean;
  nativeOnly: boolean;
  screenEpoch: number;
  layoutEpoch: number;
}
export interface MenuHandSample {
  hand: Hand;
  present: boolean;
  tCapture: number;
  seq: number;
  palm: Vec2;
  gesture: Gesture;
  confidence: number;
}
export interface MenuContext {
  enabled: boolean;
  screenEpoch: number;
  layoutEpoch: number;
  viewport: MenuRect;
  targets: readonly MenuTarget[];
}
