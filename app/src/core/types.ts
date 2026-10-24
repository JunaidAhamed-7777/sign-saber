/** Framework-free shared data; see docs/02-architecture.md. */
export interface Vec2 { x: number; y: number; }
export interface Vec3 extends Vec2 { z: number; }
export interface Plane { normal: Vec3; point: Vec3; }
export type Hand = 'left' | 'right';
export type InputSource = 'live' | 'replay';
export interface BodyCalibration {
 centerX:number; shoulderWidthNorm:number; headY:number; physicalScale:number;
 capturedAt:number; identity:string;
}
export interface TrackingFrame {
  seq: number;              // monotonically increasing frame id
  tCapture: number;         // main performance timeline; sensor capture if available, otherwise frame callback receipt
  tInferDone: number;       // worker completion converted to the MAIN performance timeline (see [05])
  inferenceMs: number;      // worker-side wall time for hands + pose
  hands: HandRaw[];         // 0..2 entries
  pose: PoseRaw | null;
  mask: MaskFrame | null;   // present only when pose is present
}

export interface HandRaw {
  handedness: 'left' | 'right';   // the PLAYER's hand, after mirroring (see §Mirroring)
  score: number;                  // handedness confidence 0..1
  landmarks: Float32Array;        // 21 × (x, y, z) in MIRRORED image space; z is MediaPipe relative depth
  worldLandmarks: Float32Array;   // 21 × (x, y, z) metres, hand-centred (for finger angles)
}

export interface PoseRaw {
  landmarks: Float32Array;        // 33 × (x, y, z, visibility) in MIRRORED image space
  worldLandmarks: Float32Array;   // 33 × (x, y, z) metres, hip-centred
}

export interface MaskFrame {
  width: number;                  // MASK_W
  height: number;                 // MASK_H
  data: Uint8Array;               // width*height, row-major, top-left origin, ALREADY MIRRORED; 0..255 person confidence
}

export type Gesture = 'open' | 'fist' | 'point' | 'none';

export interface HandCursor {
  hand: 'left' | 'right';
  present: boolean;              // false → every other field is stale and MUST be ignored
  tCapture: number;              // from the TrackingFrame that produced this update
  gesture: Gesture;
  gestureConfidence: number;     // 0..1 from the classifier margin
  gestureHeldMs: number;         // how long the current gesture has been stable
  pos: Vec3;                     // measured palm centre on the PLAY PLANE (world metres, z = 0); never render-extrapolated
  vel: Vec3;                     // play-plane velocity, m/s, smoothed over VEL_WINDOW_FRAMES
  speed: number;                 // |vel|
  tip: Vec3;                     // index fingertip on the play plane (world metres)
  pointDir: Vec2;                // unit vector, play-plane direction from index MCP to fingertip
  bladeActive: boolean;          // speed ≥ BLADE_ON_SPEED (with hysteresis to BLADE_OFF_SPEED) and gesture === 'open'
  bladeLength: number;           // metres, 0 when inactive, see [12]
  charge: number;                // 0..1 beam charge, gesture === 'point' held for BEAM_CHARGE_MS → 1
  history: Vec3[];               // last TRAIL_HISTORY positions of `pos`, newest last, for the trail ribbon
}

export type Lean = 'left' | 'center' | 'right';

export interface BodyState {
  present: boolean;
  tCapture: number;
  centerX: number;        // shoulder-midpoint x, mirrored image space 0..1
  leanX: number;          // (centerX - calib.centerX) / calib.shoulderWidthNorm, clamped to [-2, 2]
  lean: Lean;             // thresholded with hysteresis: LEAN_ON / LEAN_OFF
  tilt: number;           // shoulder line angle in degrees, positive = player's right shoulder lower
  duck: boolean;          // [STRETCH] nose y below calib.headY + DUCK_DROP
  torsoSpeed: number;     // m/s physical estimate of shoulder-midpoint speed, for kinetic energy
}

export interface SessionStats {
  score: number; maxScore: number; accuracy: number;   // maxScore is a score ceiling; accuracy is unmultiplied base points / possible base points ([07])
  rank: 'SS' | 'S' | 'A' | 'B' | 'C' | 'D';
  maxCombo: number;
  counts: { perfect: number; great: number; good: number; miss: number; badcut: number; obstaclesHit: number; obstaclesDodged: number };
  kineticJoules: number; kcal: number;               // playful motion estimate; never measured exercise calories
  peakComboSongTimeMs: number;
}

export interface BandEnergies { low: number; mid: number; high: number; rms: number; }   // each 0..1, smoothed, read every frame
