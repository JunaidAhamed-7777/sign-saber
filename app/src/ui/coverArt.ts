/**
 * Procedural cover art model. Each local track gets a stable, distinct cover derived only from its own
 * metadata (slug, title, role, duration, tempo): no external image, network request or rights record.
 */
export type CoverAccent = 'cyan' | 'magenta' | 'gold';
export interface CoverSource {
  slug: string;
  title: string;
  role?: 'intro' | 'groove' | 'showcase';
  durationMs?: number;
  bpm?: number | null;
}
export interface CoverModel {
  accent: CoverAccent;
  /** Spectrum bar heights in viewBox units (0..64 grid), left to right. */
  bars: number[];
  /** Saber slash endpoints in viewBox units. */
  slash: [number, number, number, number];
  /** Concentric ring radii centred on (ringX, ringY). */
  rings: number[];
  ringX: number;
  ringY: number;
  initial: string;
}
const ACCENTS: Record<NonNullable<CoverSource['role']>, CoverAccent> = {
  intro: 'cyan',
  groove: 'magenta',
  showcase: 'gold',
};
const ACCENT_ORDER: readonly CoverAccent[] = ['cyan', 'magenta', 'gold'];
const BAR_COUNT = 9;
const VIEW = 64;
/** FNV-1a 32-bit hash: stable across platforms and sessions. */
export function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
/** Mulberry32 PRNG seeded from the hash; deterministic per track. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const round = (value: number): number => Math.round(value * 10) / 10;
export function coverModel(track: CoverSource): CoverModel {
  const seed = hashString(`${track.slug}|${track.title}`);
  const next = random(seed);
  const accent = track.role ? ACCENTS[track.role] : ACCENT_ORDER[seed % ACCENT_ORDER.length]!;
  const bars: number[] = [];
  // A smooth seeded envelope reads as a waveform rather than noise.
  const phase = next() * Math.PI * 2;
  const tempo = track.bpm && Number.isFinite(track.bpm) ? track.bpm / 60 : 1 + next();
  for (let i = 0; i < BAR_COUNT; i++) {
    const wave = 0.5 + 0.5 * Math.sin(phase + i * tempo * 0.9);
    bars.push(round(8 + wave * 18 + next() * 10));
  }
  const tilt = 10 + next() * 26;
  const slash: [number, number, number, number] = [
    round(6 + next() * 8),
    round(VIEW - tilt),
    round(VIEW - 6),
    round(tilt - 4),
  ];
  const minutes = Math.max(1, Math.round((track.durationMs ?? 120_000) / 60_000));
  const rings: number[] = [];
  for (let i = 0; i < Math.min(4, minutes); i++) rings.push(round(6 + i * 5));
  const initial = (track.title.trim()[0] ?? '♪').toUpperCase();
  return {
    accent,
    bars,
    slash,
    rings,
    ringX: round(40 + next() * 14),
    ringY: round(12 + next() * 10),
    initial,
  };
}
