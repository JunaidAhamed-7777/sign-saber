/** Shared registry: docs/02, render sections: docs/10–13. Initial defaults, not measured tuning. */
export const PLAY_W = 5.33,
  PLAY_H = 3,
  PLAY_CENTER_Y = 1.5;
/** Lanes sit wide of the body so hands reach out to hit, keeping arms clear of the torso for tracking. */
export const LANE_X = [-2.15, -1.2, 1.2, 2.15] as const;
export const LANE_Y = [0.75, 1.5, 2.25] as const;
export const BLOCK_SIZE = 0.6,
  LANE_PITCH_DEG = 6,
  SPAWN_DISTANCE = 48,
  SILHOUETTE_Z = -1.4;
export const CAM_POS = { x: 0, y: 1.75, z: 4.6 },
  CAM_LOOK_AT = { x: 0, y: 1.35, z: -8 };
export const CAM_FOV_DEG = 55,
  BEAM_HOVER_Z = -14,
  BEAM_HOVER_Y_OFFSET = 0.6;
export const APPROACH_MS = { easy: 2600, normal: 2000, hard: 1600 } as const;
/** Runtime multiplier on chart approach time: slower blocks absorb camera/inference delay. */
export const APPROACH_SLOWDOWN = 2.17;
/** Contact zone scale over the visible block and palm radius; generous for webcam play. */
export const HIT_ZONE_SCALE = 2.5;
/** Minimum hand speed (m/s) for a block contact; gesture shape is not required. */
export const CONTACT_MIN_SPEED = 0.3;
export const WINDOW_PERFECT_MS = 60,
  WINDOW_GREAT_MS = 120,
  WINDOW_GOOD_MS = 200;
export const MISS_Z = 1.2,
  DESPAWN_Z = 3.5,
  BEAM_LEAD_MS = 1600,
  BEAM_ESCAPE_MS = 600;
export const BEAM_CHARGE_MS = 500,
  BEAM_AIM_RADIUS = 0.45,
  BEAM_ISOLATION_MS = 700;
export const INPUT_OFFSET_DEFAULT_MS = 0,
  INPUT_OFFSET_RANGE_MS = 150,
  WINDOW_SCALE = 1;
export const OBSTACLE_GRACE_MS = 120,
  BEAM_REFIRE_LOCK_MS = 150,
  EXTRAPOLATE_MAX_MS = 80,
  /** Display-only easing (ms) of hand cursors/trails toward the extrapolated cursor; never used for scoring. */
  HAND_DISPLAY_SMOOTH_MS = 45,
  INPUT_MAX_AGE_MS = 250;
export const SCORE_PERFECT = 100,
  SCORE_GREAT = 70,
  SCORE_GOOD = 40,
  SCORE_DODGE = 50,
  /** Points removed when the body touches a wall; walls never end or pause the run. */
  SCORE_WALL_PENALTY = 100;
export const MULTIPLIER_LADDER = [
  [0, 1],
  [5, 2],
  [15, 4],
  [30, 8],
] as const;
export const RANK_THRESHOLDS = { SS: 0.95, S: 0.9, A: 0.8, B: 0.65, C: 0.5 } as const;
export const HAND_MASS_KG = 2.5,
  TORSO_MASS_KG = 30,
  METABOLIC_EFFICIENCY = 0.25;
export const SWING_MIN_SPEED = 1,
  TORSO_SWING_MIN_SPEED = 0.3,
  HIGHLIGHT_MIN_COMBO = 5,
  HIGHLIGHT_DEBOUNCE_MS = 2000;
export const MILESTONE_COMBOS = [10, 25, 50, 100] as const;
export const GESTURE_CONFIRM_FRAMES = 3,
  GESTURE_DROP_FRAMES = 6,
  FINGER_EXT_ANGLE_DEG = 160,
  FINGER_CURL_ANGLE_DEG = 115;
export const ONE_EURO_MIN_CUTOFF = 1.2,
  ONE_EURO_BETA = 10,
  ONE_EURO_D_CUTOFF = 1,
  VEL_WINDOW_FRAMES = 3;
export const BLADE_ON_SPEED = 3,
  BLADE_OFF_SPEED = 1.8,
  SLASH_MIN_SPEED = 2.5,
  SMASH_MIN_SPEED = 1.2;
export const BLADE_LEN_MIN = 0.4,
  BLADE_LEN_MAX = 1.6,
  BLADE_FULL_SPEED = 12,
  TRAIL_HISTORY = 24,
  HAND_HIT_RADIUS = 0.22;
export const LEAN_ON = 0.55,
  LEAN_OFF = 0.35,
  DUCK_DROP = 0.12;
export const GESTURE_PALM_SIZE_MIN = 0.015,
  GESTURE_EDGE_ON_WIDTH = 0.35,
  GESTURE_TIP_REACH_MARGIN = 0.15;
/** 3D wrist→tip / wrist→MCP ratios: at or above EXT a finger is straight, at or below CURL it is folded. */
export const GESTURE_EXT_RATIO = 1.55,
  GESTURE_CURL_RATIO = 1.3;
export const GESTURE_CURL_REACH_MAX = 1.15,
  GESTURE_THUMB_OUT_MIN = 1.3,
  GESTURE_THUMB_IN_INDEX_MAX = 0.6,
  GESTURE_THUMB_IN_MIDDLE_MAX = 0.5;
export const GESTURE_CONFIDENCE_MIN = 0.25,
  GESTURE_FAST_OPEN_CONFIDENCE = 0.7,
  GESTURE_POINT_RELAX_DEG = 35;
export const GESTURE_CURL_MARGIN_ORIGIN = 0.7,
  GESTURE_CURL_MARGIN_SPAN = 0.6,
  POINT_DIR_MIN_M = 0.05,
  BEAM_CHARGE_DECAY = 3;
export const CAM_REQ_W = 1280,
  CAM_REQ_H = 720,
  CAM_REQ_FPS = 30,
  INFER_W = 640,
  INFER_H = 360,
  POSE_W = 320,
  POSE_H = 180;
export const MASK_W = 320,
  MASK_H = 180,
  TRACK_TARGET_HZ = 30,
  TRACKING_LOST_PAUSE_MS = 1500;
export const CALIB_PRESENCE_MS = 800,
  CALIB_SHOULDER_MIN = 0.08,
  CALIB_SHOULDER_MAX = 0.6;
export const CONTRAST_MASK_THRESHOLD = 0.65,
  CONTRAST_EDGE_GAIN = 1.5,
  LOW_LIGHT_MASK_MEAN = 0.55,
  LOW_LIGHT_MS = 1000,
  TWO_BODY_BLOB_AREA = 0.15;
export const WAVE_REVERSALS = 3,
  WAVE_WINDOW_MS = 1500,
  WAVE_MIN_AMPLITUDE = 0.06;
export const COUNTDOWN_STEPS = 3,
  START_COUNTDOWN_MS = 2000,
  RESUME_COUNTDOWN_MS = 1500,
  SONG_TAIL_MS = 1500;
export const TRACK_CONFIDENCE_MIN = 0.5,
  CALIB_VISIBILITY_MIN = 0.5,
  HAND_RESET_FRAMES = 2,
  HAND_IDENTITY_GRACE_MS = 300;
export const HAND_IDENTITY_MATCH_DIST = 0.15,
  HAND_IDENTITY_OVERRIDE_DIST = 0.08,
  TRACK_STALL_MS = 3000,
  TRACK_RECOVERY_MS = 5000;
export const TRACK_REGAIN_MS = 500,
  TRACK_RATE_TOLERANCE_MS = 2,
  TRACK_STATS_WINDOW = 30,
  DEBUG_TEXT_HZ = 4,
  WAVE_DEAD_BAND = 0.002;
export const BODY_FILTER_BETA = 0.02,
  BODY_SPEED_EMA = 0.5,
  LEAN_TILT_ASSIST_DEG = 15,
  DUCK_HYSTERESIS = 0.03;
/** Steady, framed time after which camera setup confirms and live play counts in without a click. */
export const CALIB_AUTO_CONFIRM_MS = 1000;
/** Display-only hold for the tracked figure, HUD hands and captions across slow inference frames. */
export const FIGURE_HOLD_MS = 700;
/** Corner camera view canvas size (px, 16:9). */
export const CAMERA_PIP_W = 320,
  CAMERA_PIP_H = 180;
export const CALIB_SAMPLE_MS = 500,
  CALIB_HAND_SEEN_MS = 2000,
  CALIB_ASSUMED_SHOULDER_M = 0.4;
export const SWING_REFRACTORY_MS = 150,
  SWING_TROUGH_RATIO = 0.5;
export const ANALYSIS_SR = 22050,
  FFT_SIZE = 2048,
  HOP = 512;
export const BAND_EDGES_HZ = { low: [20, 150], mid: [150, 2000], high: [2000, 10000] } as const;
export const ONSET_DELTA = 0.15,
  ONSET_MIN_GAP_MS = 80,
  ONSET_MIN_STRENGTH = 0.25;
export const BPM_MIN = 60,
  BPM_MAX = 200,
  BPM_PRIOR = 120,
  BEAT_TIGHTNESS = 100,
  SNAP_GRID = 4,
  SNAP_MAX_MS = 35;
export const MAX_DENSITY_PER_S = { easy: 0.75, normal: 1.5, hard: 2.5 } as const;
export const MIN_NOTE_GAP_MS = { easy: 700, normal: 400, hard: 260 } as const;
/** Most notes whose hit times fall inside one approach span, i.e. simultaneously on screen. */
export const MAX_VISIBLE_NOTES = { easy: 3, normal: 4, hard: 5 } as const;
export const MIN_SAME_CELL_GAP_MS = 400,
  MIN_OBSTACLE_GAP_MS = 3000,
  MIN_OBSTACLE_MS = 600,
  MAX_OBSTACLE_MS = 2400;
export const DROP_RISE_RATIO = 1.4,
  DROP_MIN_BUILD_MS = 8000,
  ENERGY_HOP_MS = 100,
  TEMPO_PRIOR_SIGMA_OCT = 0.9,
  TEMPO_MIN_CONFIDENCE = 0.35;
export const BEAM_SUSTAIN_MS = 500,
  BEAM_SUSTAIN_DB = 3;
/** Songs without flat sustains may still offer their most sustained mid/high onsets, within a hard ceiling. */
export const BEAM_SUSTAIN_PERCENTILE = 10,
  BEAM_SUSTAIN_MAX_DB = 12;
export const BEAM_MIN_SPACING_MS = { easy: 12000, normal: 8000, hard: 6000 } as const;
export const CHORD_WINDOW_MS = 20,
  CENTROID_ROW_HZ = [400, 2500] as const,
  WALL_NOTE_MARGIN_MS = 600;
export const MIN_TRACK_MS = 5000,
  MAX_TRACK_MS = 300000,
  MAX_UPLOAD_BYTES = 60 * 1024 * 1024,
  MAX_DECODED_PCM_BYTES = 128 * 1024 * 1024;
/** Playback decode keeps full-band audio; analysis still resamples to ANALYSIS_SR. */
export const PLAYBACK_DECODE_SR = 44100,
  GAPLESS_LENGTH_TOLERANCE_SAMPLES = 2;
export const ANALYSIS_CACHE_MAX = 30,
  GENERATOR_VERSION = 4;
export const DSP_EPSILON = 1e-12,
  ANALYSIS_PEAK_TARGET = 0.95,
  SILENCE_PEAK_MAX = 1e-4,
  STFT_LOG_GAIN = 10;
export const FLUX_NORM_PERCENTILE = 95,
  ENERGY_NORM_PERCENTILE = 98,
  ONSET_MEAN_PRE_FRAMES = 10,
  ONSET_MEAN_POST_FRAMES = 3,
  ONSET_MAX_RADIUS_FRAMES = 3;
export const ONSET_RAW_RMS_MIN = 0.002,
  TEMPO_DETREND_FRAMES = 16,
  TEMPO_HARMONIC_WEIGHT = 0.5,
  TEMPO_OCTAVE_SWITCH_RATIO = 1.15;
/** Fine beat-period search around the autocorrelation estimate (fractions of the period). */
export const TEMPO_REFINE_RANGE = 0.01,
  TEMPO_REFINE_STEP = 0.0001;
export const TEMPO_SUPPORT_MIN_STRENGTH = 0.4,
  TEMPO_MIN_SUPPORT_ONSETS = 4,
  BEAT_MIN_PERIOD_FACTOR = 0.5,
  BEAT_MAX_PERIOD_FACTOR = 2,
  BEAT_EDGE_PAD_PERIODS = 1;
export const UNSNAPPED_MIN_STRENGTH = 0.8,
  FREE_RHYTHM_MIN_STRENGTH = 0.4,
  SECTION_SMOOTH_MS = 4000,
  KICK_MIN_STRENGTH = 0.6,
  KICK_MIN_GAP_BEATS = 0.5;
export const DROP_BASELINE_END_MS = 1000,
  DROP_MIN_GAP_MS = 16000,
  DROP_MIN_ENERGY = 0.6,
  BUILD_WINDOW_MS = 8000,
  BUILD_DROP_LOOKAHEAD_MS = 4000;
export const BUILD_MAX_DIPS = 2,
  BUILD_MAX_DIP_DEPTH = 0.03,
  BUILD_MIN_RISE = 0.25,
  CALM_WINDOW_MS = 6000,
  CALM_MIN_GAP_MS = 12000,
  CALM_PERCENTILE = 25;
export const DENSITY_WINDOW_MS = 4000,
  FLOW_RESTART_GAP_MS = 1200;
export const FLOW_RESTART_SIDE = 'right' as const;
/** Quiet sections thin out: the local minimum gap is MIN_NOTE_GAP_MS / (floor + (1 − floor) · energy). */
export const DENSITY_ENERGY_FLOOR = 0.5,
  DENSITY_ENERGY_SMOOTH_MS = 2000;
/** A continuous phrase longer than PHRASE_MAX_MS receives a deliberate note-free rest of PHRASE_REST_MS. */
export const PHRASE_MAX_MS = { easy: 10000, normal: 14000, hard: 18000 } as const;
export const PHRASE_REST_MS = { easy: 2000, normal: 1600, hard: 1200 } as const;
/** Two-hand chords: strong multi-band accents only, never on Easy. */
export const CHORD_MIN_STRENGTH = 0.85;
export const CHORD_MIN_SPACING_MS = { easy: Infinity, normal: 6000, hard: 2500 } as const;
/** Local share of strong low-band hits that become smashes; the rest of the phrase is slashes. */
export const SMASH_MAX_SHARE = { easy: 0.4, normal: 0.4, hard: 0.45 } as const;
export const SMASH_MIN_LOW_STRENGTH = 0.5,
  GESTURE_MIX_WINDOW_MS = 8000;
/** Per-hand budget: a hand needs FOLLOW after its previous contact plus LEAD before the next one. */
export const FLOW_HAND_LEAD_MS = { strike: 350, beam: 720 } as const;
export const FLOW_HAND_FOLLOW_MS = { strike: 270, beam: 160 } as const;
export const FLOW_GESTURE_CHANGE_MS = 80;
export const FLOW_OUTER_ACCENT_EVERY = 4,
  FLOW_OUTER_ACCENT_MIN_STRENGTH = 0.7,
  FLOW_FULL_ROW_JUMP_MIN_GAP_MS = 400;
export const EASY_LOW_ROW_MIN_GAP_MS = 2000;
export const OBSTACLE_INTRO_MS = 8000;
export const OBSTACLE_PERIOD_BEATS = { easy: 32, normal: 16, hard: 12 } as const;
/** Planned wall cadence floor; the validator's MIN_OBSTACLE_GAP_MS remains the hard minimum. */
export const OBSTACLE_SPACING_MS = { easy: 16000, normal: 10000, hard: 7000 } as const;
export const OBSTACLE_DURATION_BEATS = { easy: 1.5, normal: 2, hard: 2 } as const;
export const EASY_OBSTACLE_MIN_GAP_MS = 12000;
export const GEN_PROGRESS_WEIGHTS = {
  stft: 0.45,
  flux: 0.05,
  onsets: 0.05,
  tempo: 0.1,
  beats: 0.05,
  energy: 0.05,
  assign: 0.2,
  validate: 0.05,
} as const;
export const GEN_WORK_CHUNK_MS = 8,
  GEN_MAX_RETRIES = 1;
export const SONG_START_LEAD_S = 0.15,
  ANALYSER_FFT = 1024;
export const BAND_LOW_HZ = [20, 150] as const,
  BAND_MID_HZ = [150, 2000] as const,
  BAND_HIGH_HZ = [2000, 10000] as const;
export const ANALYSER_SMOOTH = 0.6,
  ANALYSER_LOW_ATTACK = 0.3,
  ANALYSER_PEAK_DECAY_S = 4,
  ANALYSER_PEAK_FLOOR = 0.15,
  ANALYSER_RMS_GAIN = 3;
export const SFX_POLYPHONY = 6,
  SFX_PITCH_JITTER_CENTS = 35;
export const SFX_JUDGEMENT_RATE = { perfect: 1.03, great: 1, good: 0.97 } as const;
export const SFX_STOP_RAMP_S = 0.01,
  MASTER_GAIN_DEFAULT = 0.8,
  SFX_GAIN_DEFAULT = 1,
  DUCK_DB = -1.5,
  DUCK_ATTACK_S = 0.03,
  DUCK_RELEASE_S = 0.4;
export const UI_TEXT_HZ = 20,
  POP_LIFETIME_MS = 600,
  MAX_POPS = 6,
  STARTER_TRACK_MIN_COUNT = 3,
  MENU_LIBRARY_PAGE_SIZE = 3;
export const MENU_STAGE_MIN_FRACTION = 0.44,
  MENU_TARGET_MIN_PX = 72,
  MENU_TARGET_GAP_PX = 16;
export const MENU_REACH_BOUNDS = { left: 0.2, right: 0.8, top: 0.15, bottom: 0.85 } as const;
export const MENU_GESTURE_CONFIDENCE_MIN = 0.6,
  MENU_OPEN_ARM_MS = 160,
  MENU_POINT_CONFIRM_MS = 100,
  MENU_TRANSITION_GRACE_MS = 200;
export const MENU_POINT_MAX_MOVE_PX = 24,
  MENU_CLICK_COOLDOWN_MS = 350,
  MENU_TRACK_MAX_AGE_MS = 150,
  MENU_HANDOVER_COOLDOWN_MS = 500;
export const COMPANION_URL = 'http://localhost:8787',
  COMPANION_HEALTH_TIMEOUT_MS = 800,
  YT_HEALTH_INTERVAL_MS = 10000,
  COMPANION_POLL_MS = 500,
  COMPANION_MAX_VIDEO_MS = 720000;
// render sub-registries (docs10–13)
export const TARGET_FPS = 60,
  FLOOR_FPS = 40,
  BLOOM_RESOLUTION_SCALE = 0.5,
  MAX_LIVE_NOTES = 48,
  MAX_FRAGMENTS = 256,
  MAX_TRAIL_PARTICLES_PER_HAND = 256;
export const FRAGMENT_LIFETIME_MS = 1400,
  HALF_LIFETIME_MS = 1200,
  POOF_LIFETIME_MS = 700;
export const SIL_RIM_PX = 6,
  SIL_FILL_ALPHA = 0.78,
  SIL_MASK_LOW = 0.35,
  SIL_MASK_HIGH = 0.65,
  SIL_SKELETON_Z_OFFSET = -0.06,
  SIL_SKELETON_DEPTH_SCALE = 0.5;
export const KICK_DECAY_MS = 180,
  DROP_DECAY_MS = 900,
  SLICE_POOL = 12,
  SHATTER_POOL = 18,
  SLICE_SEPARATION_SPEED = 1.2,
  SLICE_INHERIT = 0.35,
  SHATTER_INHERIT = 0.5;
export const SHATTER_BURST_MIN = 2,
  SHATTER_BURST_MAX = 6,
  BADCUT_PUSHBACK_M = 0.8,
  BADCUT_MS = 220,
  OBSTACLE_ALPHA = 0.35,
  SPAWN_FADE_MS = 250;
export const HAND_TINT_LEFT = '#19F5FF',
  HAND_TINT_RIGHT = '#B36BFF',
  BLADE_SPINE_SAMPLES = 48,
  BLADE_CORE_W = 0.04,
  BLADE_GLOW_W = 0.14;
export const BLADE_MIX_ON_MS = 120,
  BLADE_MIX_OFF_MS = 250,
  ORBIT_R_MIN = 0.12,
  ORBIT_R_MAX = 0.22,
  BEAM_VISUAL_MS = 120,
  INDICATOR_R = 0.12;
export const FOG_DENSITY = 0.026,
  BG_COLOR = '#05060D',
  GRID_LINE_COLOR = '#1A2BFF',
  TRAUMA_DECAY_S = 0.6,
  SHAKE_MAX_M = 0.08,
  SHAKE_MAX_ROLL_DEG = 1.5;
export const TRAUMA_KICK = 0.25,
  TRAUMA_DROP = 0.7,
  TRAUMA_HIT = 0.12,
  TRAUMA_BADCUT = 0.18,
  TRAUMA_OBSTACLE = 0.5;
export const DROP_FOV_PUNCH_DEG = 7,
  DROP_DOLLY_M = 0.3,
  LEAN_PARALLAX_M = 0.15,
  BLOOM_THRESHOLD = 0.6,
  BLOOM_INTENSITY = 1.2;
export const CHROMA_DROP_OFFSET = 0.004,
  GLITCH_MS = 120,
  PYLON_SPACING_M = 8,
  PYLON_X = 5.5,
  HIGHLIGHT_RT_SIZE = 768;
// --- Original synthesized SFX and audio feel (docs02 §Audio; docs15 §6). Recipe internals are authored
// sound content inside audio/sfxSynth.ts, pinned by assets-src/audio/sfx-receipt.json. ---
/**
 * Momentary loudness (BS.1770, 400 ms window, LUFS) each rendered sound is normalized to, before the bus
 * and master gain. Loudness rather than peak keeps noisy cues consistent across seeds and sample rates.
 * Keys define `SfxId`.
 */
export const SFX_LOUDNESS_LUFS = {
  slash: -24,
  smash: -22.5,
  zap: -23,
  poof: -26.5,
  sparkle: -27,
  glint: -32,
  badcut: -24,
  miss: -34,
  wallWarn: -27,
  wallHit: -21.5,
  dodge: -25.5,
  combo: -21,
  milestone: -19,
  comboBreak: -34,
  drop: -15,
  count: -27,
  countGo: -24.5,
  countNeutral: -31.5,
  charge: -31.5,
  resultsHigh: -16,
  resultsLow: -19,
  resume: -30,
  uiHover: -42,
  uiConfirm: -30,
  uiBack: -32,
  uiSelect: -32,
  uiArm: -36,
  uiEnable: -24,
} as const;
/** No rendered sample exceeds this; a soft knee above SFX_PEAK_KNEE × ceiling shapes rare spikes. */
export const SFX_PEAK_CEILING_DBFS = -5,
  SFX_PEAK_KNEE = 0.85;
/** Calm renders are low-passed and normalized this much quieter (LU). */
export const SFX_CALM_LOUDNESS_DB = -3,
  SFX_CALM_LOWPASS_HZ = 4500;
/** Deterministic synthesis seed (mixed with the sound id) and seed for cosmetic pitch jitter. */
export const SFX_SEED = 0x5167_5abe;
/** Pitched cues fold the estimated track tonic into [root, 2·root); menus use a fixed root. */
export const SFX_DEFAULT_ROOT_HZ = 523.25,
  SFX_UI_ROOT_HZ = 880;
/** Combo/milestone transposition (semitones) by ladder/milestone index; pentatonic-safe intervals. */
export const SFX_COMBO_STEP_SEMITONES = { major: [0, 0, 4, 7], minor: [0, 0, 3, 7] } as const;
export const SFX_MILESTONE_SEMITONES = { major: [0, 4, 7, 12], minor: [0, 3, 7, 12] } as const;
/** Cheap tonal-centre estimate for SFX tuning only: FFT size/frames, analysed band and minimum profile correlation. */
export const SFX_TONIC_FFT = 4096,
  SFX_TONIC_FRAMES = 40,
  SFX_TONIC_MIN_HZ = 130,
  SFX_TONIC_MAX_HZ = 1760,
  SFX_TONIC_MIN_CORRELATION = 0.5;
/** Global voice cap across all sounds and per-sound overrides of `SFX_POLYPHONY`. */
export const SFX_MAX_VOICES = 24;
export const SFX_VOICE_LIMITS: Partial<Record<keyof typeof SFX_LOUDNESS_LUFS, number>> = {
  charge: 2,
  resultsHigh: 1,
  resultsLow: 1,
  drop: 2,
  wallWarn: 3,
  milestone: 2,
  combo: 3,
  uiEnable: 1,
  uiHover: 2,
};
/** Safety limiter on the SFX bus; Web Audio applies spec makeup gain, which the bus trims back out. */
export const SFX_LIMITER = { thresholdDb: -3, kneeDb: 0, ratio: 20, attackS: 0.001, releaseS: 0.08 } as const;
/** Spec/Blink compressor pre-delay; future-scheduled cues start this much earlier to compensate. */
export const SFX_LIMITER_LOOKAHEAD_S = 0.006;
/** Bounded rendered-buffer cache (LRU entries across voicings). */
export const SFX_CACHE_MAX_BUFFERS = 96;
/** An early-arriving hit sounds at its chart time if that is at most this far ahead (cosmetic only). */
export const SFX_BEAT_SNAP_MS = 40,
  SFX_LOOKAHEAD_MS = 120,
  SFX_LATE_SKIP_MS = 20;
/** Stereo placement: lane/hand pan, wall side pan, beam hand pan. */
export const SFX_PAN_LANE = 0.45,
  SFX_PAN_HAND = 0.1,
  SFX_PAN_WALL = 0.55,
  SFX_PAN_BEAM = 0.3;
/** Swing-speed dynamics for gesture hits: dB range and speed ratio (to the gesture minimum) for full level. */
export const SFX_DYNAMICS_DB = { min: -2, max: 1 } as const,
  SFX_DYNAMICS_FULL_RATIO = 2.5;
/** The wall-warning swell peaks this long after it starts, aligned to the wall reaching the player. */
export const SFX_WALL_WARN_LEAD_S = 0.52;
/** Charge cue starts above this charge, releases after this drop from its peak and fades over this time. */
export const SFX_CHARGE_START = 0.05,
  SFX_CHARGE_CANCEL_DROP = 0.1,
  SFX_RELEASE_S = 0.04;
/** Rate limits for repeated feedback, minimum broken combo for the soft break cue, final neutral tick rate. */
export const SFX_MISS_MIN_GAP_MS = 90,
  SFX_UI_MIN_GAP_MS = 45,
  SFX_BREAK_MIN_COMBO = 10,
  SFX_NEUTRAL_GO_RATE = 1.25;
// --- end synthesized SFX ---
// Admission limits and bounded telemetry (implementation registry additions).
export const VALIDATION_MAX_ERRORS = 32,
  ASSET_TEXT_MAX_CHARS = 512,
  MAX_ASSET_JSON_BYTES = 8 * 1024 * 1024;
export const TELEMETRY_CAPACITY = 36000;

export const ONSET_SPECTRAL_NOVELTY_MIN = 0.02,
  GEOMETRY_EPSILON = 1e-10;

export const ONSET_RMS_RISE_RATIO = 1.08;

export const TRACK_RECORD_MS = 20000,
  TRACK_RECORD_MAX_BYTES = 2 * 1024 * 1024;

export const RESAMPLE_TAPS = 64,
  RESAMPLE_PHASES = 1024;

export const UPPER_BODY_LAST_LANDMARK = 24,
  UPPER_BODY_MASK_FADE_NORM = 0.035;

export const TRACK_FIRST_RESULT_TIMEOUT_MS = 15000;
/** Capture restarts attempted after a stall before camera setup reports a failure. */
export const TRACK_STALL_RESTARTS = 3;
/** MediaPipe delegate when no `?tracker=` flag is given. */
export const TRACK_DEFAULT_DELEGATE: 'gpu' | 'cpu' = 'cpu';
export const ARRANGEMENT_VERSION = 1,
  ARRANGEMENT_TOTAL_MS = 80000,
  ARRANGEMENT_FADE_MS = 10000,
  ARRANGEMENT_HIGHLIGHT_MS = 60000;
export const ARRANGEMENT_SELECTION_HOP_MS = 1000,
  ARRANGEMENT_ENERGY_WEIGHT = 0.65,
  ARRANGEMENT_ONSET_WEIGHT = 0.35;
export const ARRANGEMENT_SILENCE_ENERGY = 0.08,
  ARRANGEMENT_SILENCE_PENALTY = 1;
export const DATASET_TRIAL_HZ = 30,
  DATASET_TRIAL_HOLD_MS = 10000;
export const DATASET_TRIAL_URL = '/assets/fixtures/coco-upper-body-trial.json';
export const DATASET_TRIAL_SHA256 = 'a04586b426d0ee9c66e29ee50fa95986eeaa62f45f6a4f48f85277c5144f59fd';
export const DATASET_TRIAL_CROP_FRACTION = 0.8;
export const ASSET_MODEL_MAX_BYTES = 1048576,
  MAX_LIVE_OBSTACLES = 8,
  GRAVITY_MPS2 = 9.8,
  GLYPH_FACE_OFFSET_M = 0.31;
export const ARENA_REACTIVE_GAIN = 2,
  SIL_HEAD_RADIUS_M = 0.11;

export const DATASET_TRIAL_MAX_SAMPLES = 100,
  DATASET_TRIAL_MAX_CATCHUP_FRAMES = 300;

// ── Begin dataset-camera / judgement-trace block (docs02 registry; docs05 §1.3; docs24 §9) ──
// A labelled canvas MediaStream fed through the unchanged live path. Never webcam evidence.
export const DATASET_CAMERA_MANIFEST_URL = '/dataset-camera/manifest.json',
  DATASET_CAMERA_MAX_ITEMS = 200,
  DATASET_CAMERA_MAX_FILE_BYTES = 4 * 1024 * 1024,
  DATASET_CAMERA_HOLD_MS = 5000,
  DATASET_CAMERA_HOLD_MIN_MS = 1000,
  DATASET_CAMERA_HOLD_MAX_MS = 60000,
  DATASET_CAMERA_SWEEP_FIRST_HOLD_MS = 20000,
  DATASET_CAMERA_TRANSITION_GUARD_MS = 300,
  DATASET_CAMERA_TIMELINE_CAPACITY = 1024,
  DATASET_CAMERA_MATCH_SHOULDER_FRACTION = 0.5,
  DATASET_CAMERA_PCK_SHOULDER_FRACTION = 0.5;
export const JUDGEMENT_TRACE_CAPACITY = 8192;
// Synthetic performer reel: rendered avatar in a virtual front camera (docs05 §1.3).
export const PERFORMER_REEL_RENDER_W = 960,
  PERFORMER_REEL_RENDER_H = 540,
  PERFORMER_REEL_CAMERA_DISTANCE_M = 3,
  PERFORMER_REEL_IDLE_SONG_MS = -60000,
  PERFORMER_REEL_TRUTH_POOL = 128;
// ── End dataset-camera / judgement-trace block ──

export const POOF_POOL = 6,
  POOF_SPARKS = 24,
  POOF_POWERDOWN_MS = 150,
  POOF_FLASH_DELAY_MS = 120,
  POOF_FLASH_MS = 100,
  POOF_RING_MS = 300;
export const POOF_FLASH_SIZE_M = 0.7,
  POOF_RING_START_M = 0.3,
  POOF_RING_END_M = 1.6,
  POOF_SPARK_SPEED_MIN = 1.5,
  POOF_SPARK_SPEED_MAX = 3,
  POOF_SPARK_SIZE_M = 0.03,
  POOF_GRAVITY_SCALE = 0.4,
  POOF_TARGET_SCALE = 1.6;
export const ARENA_BASE_EMISSION = 0.4;
export const MISS_DIM_MS = 150,
  TERMINAL_DIM_FACTOR = 0.25,
  BADCUT_TINT = 0xff1e3c;
export const BEAM_ESCAPE_RISE_M = 3,
  BEAM_ESCAPE_VISUAL_MS = 600;
export const SIL_JOINT_RADIUS_M = 0.045;

// QUALITY_*: single canonical cosmetic preset registry (docs16 §Quality tiers).
export const QUALITY_DPR_CAP = 1,
  QUALITY_MEDIUM_TALL_HEIGHT_PX = 1440,
  QUALITY_MEDIUM_TALL_RENDER_SCALE = 0.85;
export const QUALITY_TIER_PRESETS = Object.freeze({
  high: Object.freeze({
    renderScale: 1,
    bloomResolutionScale: BLOOM_RESOLUTION_SCALE,
    bloomMipLevels: 6,
    bloomIntensity: BLOOM_INTENSITY,
    chromaticAberration: 'optional-drop',
    antialiasing: 'smaa-medium',
    trailParticlesPerHand: MAX_TRAIL_PARTICLES_PER_HAND,
    ribbonLayers: 2,
    ribbonCoreWidened: false,
    ribbonSpineSamples: BLADE_SPINE_SAMPLES,
    tipSparks: true,
    beamNoiseOctaves: 2,
    skeleton: 'joints-and-bones',
    maskTaps: 9,
    maskTextures: 2,
    maskTemporalBlend: true,
    silhouetteHalo: true,
    handGlowSpots: true,
    fragmentCap: MAX_FRAGMENTS,
    smashGeometry: 'complete-authored-or-fallback',
    fragmentLifetimeScale: 1,
    poofSparks: POOF_SPARKS,
    aimAssistLine: 'optional',
    grid: 'antialiased-glow',
    maskUpload: 'distinct-new-only',
    dustPoints: 600,
    pylons: 14,
  } as const),
  medium: Object.freeze({
    renderScale: 1,
    bloomResolutionScale: 0.35,
    bloomMipLevels: 5,
    bloomIntensity: 1,
    chromaticAberration: 'off',
    antialiasing: 'fxaa',
    trailParticlesPerHand: 160,
    ribbonLayers: 2,
    ribbonCoreWidened: false,
    ribbonSpineSamples: BLADE_SPINE_SAMPLES,
    tipSparks: true,
    beamNoiseOctaves: 1,
    skeleton: 'joints-and-bones',
    maskTaps: 9,
    maskTextures: 2,
    maskTemporalBlend: true,
    silhouetteHalo: true,
    handGlowSpots: true,
    fragmentCap: 192,
    smashGeometry: 'complete-authored-or-fallback',
    fragmentLifetimeScale: 1,
    poofSparks: POOF_SPARKS,
    aimAssistLine: 'optional',
    grid: 'antialiased',
    maskUpload: 'distinct-new-only',
    dustPoints: 400,
    pylons: 14,
  } as const),
  low: Object.freeze({
    renderScale: 0.75,
    bloomResolutionScale: 0.25,
    bloomMipLevels: 4,
    bloomIntensity: 0.9,
    chromaticAberration: 'off',
    antialiasing: 'none',
    trailParticlesPerHand: 96,
    ribbonLayers: 1,
    ribbonCoreWidened: true,
    ribbonSpineSamples: 32,
    tipSparks: false,
    beamNoiseOctaves: 0,
    skeleton: 'joints',
    maskTaps: 5,
    maskTextures: 1,
    maskTemporalBlend: false,
    silhouetteHalo: false,
    handGlowSpots: true,
    fragmentCap: 128,
    smashGeometry: 'complete-eight-octant-fallback',
    fragmentLifetimeScale: 0.7,
    poofSparks: 12,
    aimAssistLine: 'off',
    grid: 'plain-antialiased',
    maskUpload: 'distinct-new-only',
    dustPoints: 200,
    pylons: 8,
  } as const),
});

// ---- Render polish registry (docs11–13, docs18): targets, post FX, arena response, hands. ----
// Registered in docs/11, 12 and 13 "Constants required" tables; keep both sides synchronized.
export const BLOCK_NEAR_GLOW_M = 8,
  BLOCK_FILL_ALPHA = 0.38,
  BLOCK_RIM_GAIN = 0.9,
  BLOCK_TRIM_GAIN = 1.05,
  BLOCK_TRIM_NEAR_GAIN = 0.75,
  BLOCK_CORE_SPIN_RAD_S = 0.9;
export const GLYPH_FRONT_GAIN = 1.15,
  GLYPH_EDGE_GAIN = 0.3,
  SHARD_INNER_GAIN = 1.25,
  SHARD_FLASH_MS = 80,
  SLICE_CAP_HEAT_MS = 300,
  SLICE_CAP_HEAT_GAIN = 2.5;
export const BLOOM_SMOOTHING = 0.3,
  BLOOM_RADIUS = 0.7,
  BLOOM_ACCENT_MAX = 0.3,
  VIGNETTE_DARKNESS = 0.45,
  VIGNETTE_OFFSET = 0.35;
export const ARENA_NEON_BASE = 1.4,
  ARENA_BAND_GAIN = 1.5,
  ARENA_BAND_BASE = 0.35,
  ARENA_TRANSIENT_GAIN = 2.5,
  ARENA_TRANSIENT_WINDOW_S = 1.2,
  ARENA_EMISSION_SLEW_PER_S = 3;
export const GRID_Y = -0.385,
  GRID_MINOR_M = 1,
  GRID_MAJOR_M = 4,
  GRID_FADE_START_M = 30,
  GRID_FADE_END_M = 75;
export const HORIZON_GLOW_W_M = 60,
  HORIZON_GLOW_H_M = 14,
  HORIZON_GLOW_Y = 4,
  HORIZON_GLOW_Z = -140,
  CAM_FAR_M = 400;
export const DUST_BOX_W_M = 12,
  DUST_BOX_H_M = 8,
  DUST_BOX_D_M = 60,
  DUST_SPEED_FRACTION = 0.3,
  DUST_SIZE_MIN_M = 0.02,
  DUST_SIZE_MAX_M = 0.05,
  DUST_ALPHA = 0.25;
// --- Synthetic performer: labelled trial input only, never live-camera evidence (docs/17) ---
export const PERFORMER_SHOULDER_WIDTH_NORM = 0.24,
  PERFORMER_SHOULDER_V = 0.36,
  PERFORMER_REST = { x: 0.75, y: 1.15 } as const,
  PERFORMER_SLASH_SPEED = 4.5,
  PERFORMER_SLASH_WINDUP_M = 0.75,
  PERFORMER_SLASH_FOLLOW_M = 0.4,
  PERFORMER_SLASH_CONTACT_MS = 75,
  PERFORMER_SMASH_SPEED = 3,
  PERFORMER_SMASH_DRAW_M = 0.62,
  PERFORMER_SMASH_FOLLOW_M = 0.1,
  PERFORMER_SMASH_CONTACT_MS = 55,
  PERFORMER_SETTLE_MARGIN_MS = 30,
  PERFORMER_TRAVEL_MIN_MS = 120,
  PERFORMER_RECOVER_MS = 80,
  PERFORMER_BEAM_CONFIRM_LEAD_MS = 60,
  PERFORMER_LEAN_SHOULDERS = 0.9,
  PERFORMER_LEAN_EASE_MS = 250;
// --- Interface layout and HUD presentation (docs02 §UI; docs14 §Motion) ---
/** Viewport bounds at or below which side rails reflow above/below the figure stage. Mirrored in ui/theme.css. */
export const MENU_COMPACT_MAX_WIDTH_PX = 1099,
  MENU_COMPACT_MAX_HEIGHT_PX = 699;
/** Exponential damping constant for displayed HUD score/combo values (docs14 §Motion). */
export const HUD_TWEEN_TAU_MS = 90;
/** Combo counts that trigger the HUD milestone callout. */
export const HUD_COMBO_MILESTONES = [10, 25, 50, 100] as const;
/** Half-width (viewport fraction) of the central torso band that judgement pop text is moved out of. */
export const HUD_POP_TORSO_CLEAR_FRACTION = 0.09;
/** Smallest broken combo that shows the HUD “Combo ended” note; shorter streaks break silently. */
export const HUD_COMBO_BREAK_MIN = 5;
// --- end interface layout and HUD presentation ---
// --- Rigged upper-body avatar (docs/10 §Avatar; docs/18 §Avatar). Retargeting/presentation only; never scoring. ---
export const AVATAR_URL = '/assets/models/avatar.glb';
/** Requested figure per fixed tier: the skinned avatar or the line-skeleton fallback. */
export const AVATAR_TIER_FIGURE = Object.freeze({
  high: 'avatar',
  medium: 'avatar',
  low: 'skeleton',
} as const);
/** World-landmark depth → play-space depth gain, and its clamp (play metres). */
export const AVATAR_DEPTH_GAIN = 0.6,
  AVATAR_DEPTH_MAX_M = 1.1;
/** Arm segments may lengthen this much so hands reach tracked wrists. */
export const AVATAR_STRETCH_MAX = 1.15;
/** Exponential smoothing time constants (ms): tracked bones, joints easing to neutral, root and scale. */
export const AVATAR_SMOOTH_MS = 85,
  AVATAR_MISSING_SMOOTH_MS = 320,
  AVATAR_ROOT_SMOOTH_MS = 95,
  AVATAR_SCALE_SMOOTH_MS = 450;
/** A briefly missing joint holds its last target this long before easing to the neutral pose. */
export const AVATAR_HOLD_MS = 250;
/** Joint limits (degrees) relative to the parent bone. */
export const AVATAR_LIMITS_DEG = Object.freeze({
  torsoTwist: 45,
  torsoLean: 60,
  head: 70,
  clavicle: 16,
  wrist: 85,
  mcpFlex: [-25, 95] as const,
  pipFlex: [-5, 110] as const,
  dipFlex: [-5, 85] as const,
  spread: 22,
  thumbBase: 50,
  thumbFlex: [-15, 75] as const,
});
/** Finger curl (0 straight … 1 fist) used when no hand landmarks exist. */
export const AVATAR_RELAXED_CURL = 0.22;
/** Illustrative idle: periods (s) and amplitudes (model metres / degrees). Static in Calm. */
export const AVATAR_IDLE = Object.freeze({
  breathPeriodS: 4.6,
  swayPeriodS: 7.4,
  lookPeriodS: 11.3,
  breathM: 0.006,
  swayM: 0.012,
  lookDeg: 6,
  armSwingM: 0.012,
  curlRange: 0.12,
});
/** Menu placeholder placement on the play plane: avatar scale and hip height (play metres). */
/** In the arena the avatar shows its back to the viewer (the player looks over its shoulders into the lane). */
export const AVATAR_FACE_AWAY = true;
export const AVATAR_PLACEHOLDER_SCALE = 4.4,
  AVATAR_PLACEHOLDER_HIP_Y = -0.3;
/** Holographic material: rim colours (DESIGN cyan→violet), fill, fresnel power and gains. */
export const AVATAR_RIM_COLOR_A = 0x19f5ff,
  AVATAR_RIM_COLOR_B = 0xb36bff,
  AVATAR_FILL_COLOR = 0x070b16,
  AVATAR_ACCENT_COLOR = 0x19f5ff,
  AVATAR_RIM_POWER = 2.6,
  AVATAR_RIM_GAIN = 1.5,
  AVATAR_ACCENT_GAIN = 2.2,
  AVATAR_AUDIO_GAIN = 0.9,
  AVATAR_OUTLINE_M = 0.0045;
// --- end rigged upper-body avatar ---
// Target families: Slash rhombic slab, Smash cracked fracture cube, Beam orb (docs11 §2, docs18).
export const SLASH_SLAB_DEPTH = 0.3,
  SMASH_CRACK_SCALE = 0.93,
  TARGET_FADE_IN_M = 10;
export const TARGET_GLYPH_SCALE = Object.freeze({ slash: 0.42, smash: 0.56, beam: 0.62 } as const);
export const BEAM_ORB_RADIUS = 0.27,
  GLYPH_PROUD_M = 0.012;
export const SHATTER_DEPTH_FRACTION = 0.35,
  SHATTER_RECEDE_MPS = 2.4;
// Hands (docs12): blade length spring and particle presence easing.
export const BLADE_LENGTH_SPRING_RAD_S = 22,
  HAND_PRESENCE_FADE_MS = 120,
  TRAIL_PARTICLE_SIZE_MIN_M = 0.012,
  TRAIL_PARTICLE_SIZE_MAX_M = 0.035;
export const SHATTER_PIECE_SCALE = 0.8,
  SHATTER_VISIBLE_FRACTION = 0.6;
// Hit spark bursts (docs11 payoff): bounded pool, closed-form motion.
export const HIT_SPARK_POOL = 10,
  HIT_SPARKS = 28,
  HIT_SPARK_SPEED_MIN = 1.8,
  HIT_SPARK_SPEED_MAX = 5.2,
  HIT_SPARK_LIFETIME_MS = 480,
  HIT_SPARK_SIZE_M = 0.045;
export const CAMERA_SHAKE_HZ = 12,
  CAMERA_BASS_FOV_DEG = 0.5;
export const TRAUMA_PERFECT = 0.15;
