/** Normative v1 chart and library contracts. docs/09-beatmap-format.md */
export type Difficulty = 'easy' | 'normal' | 'hard';
export type NoteType = 'slash' | 'smash' | 'beam';
export type CutDirection = 'any' | 'up' | 'down' | 'left' | 'right'; // only 'any' is used in v1
export type ObstacleKind = 'wallLeft' | 'wallRight' | 'bar'; // 'bar' is [STRETCH] (duck)
export type EventKind = 'drop' | 'build' | 'calm' | 'kick';

export interface BeatmapV1 {
  version: 1;
  generatorVersion: number; // bump when the generator's output changes meaningfully
  song: {
    title: string;
    artist: string;
    durationMs: number;
    bpm: number; // tracked tempo, 1 decimal
    beatOffsetMs: number; // periodic grid phase in [0, 60000/bpm), not first tracked beat
    sourceHash: string; // SHA-256 hex of the audio file bytes
    source: 'bundled' | 'upload' | 'youtube';
    audioUrl?: string; // bundled tracks only; uploads keep the File in memory
  };
  difficulty: Difficulty;
  approachMs: number; // spawn-to-hit-plane travel time for this difficulty
  notes: Note[]; // sorted by t ascending
  obstacles: Obstacle[]; // sorted by t ascending
  events: MusicEvent[]; // sorted by t ascending
  analysis: {
    // debugging + visualisation, not needed to play
    beats: number[]; // beat times (ms)
    onsets: Onset[]; // all validated onsets, including ones not turned into notes
    energy: number[]; // RMS energy envelope sampled every ENERGY_HOP_MS, 0..1
  };
}

export interface Note {
  id: number; // unique ascending non-negative integer within notes
  t: number; // hit time (ms, song time)
  type: NoteType;
  col: 0 | 1 | 2 | 3; // left → right from the player's point of view
  row: 0 | 1 | 2; // bottom → top
  dir: CutDirection; // 'any' in v1
  strength: number; // onset strength 0..1 (drives block scale/glow)
}

export interface Obstacle {
  id: number;
  t: number; // time the obstacle's leading face reaches the hit plane
  durationMs: number; // how long the obstacle occupies the hit plane
  kind: ObstacleKind;
}

export interface MusicEvent {
  t: number;
  kind: EventKind;
  intensity: number; // 0..1
}

export interface Onset {
  t: number;
  strength: number; // 0..1 normalized spectral flux
  band: 'low' | 'mid' | 'high';
}

export interface BundledTrackEntry {
  slug: string; // unique lowercase slug, stable selection identity
  title: string;
  artist: string;
  role: 'intro' | 'groove' | 'showcase'; // editorial guidance, not a difficulty restriction
  audioUrl: string; // local /assets/tracks/<slug>/audio.mp3
  coverUrl?: string; // local asset with its own rights record, or omit
  durationMs: number; // measured from the packaged decoded audio
  bpm: number | null; // confident analysis result; null means unknown
  preview: { startMs: number; durationMs: number }; // measured, in-track bounds
  difficultyMaps: Record<Difficulty, string>; // local easy/normal/hard JSON URLs
  generatorVersion: number;
  warnings: string[]; // preserve uncertain-tempo/onset-only disclosure
  hashes: {
    audioSha256: string;
    canonicalPcmSha256: string;
    maps: Record<Difficulty, string>;
  };
  rights: {
    sourceUrl: string; // provenance link; never fetched to play
    license: 'CC0-1.0' | 'CC-BY-4.0' | 'CC-BY-3.0';
    licenseUrl: string;
    attribution: string;
    changes: string; // actual edits/encoding, or explicitly unchanged
  };
}

export interface BundledTrackManifest {
  version: 1;
  tracks: BundledTrackEntry[];
}
