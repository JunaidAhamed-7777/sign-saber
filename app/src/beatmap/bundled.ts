import {
  ASSET_TEXT_MAX_CHARS,
  GENERATOR_VERSION,
  MAX_ASSET_JSON_BYTES,
  MAX_TRACK_MS,
  MIN_TRACK_MS,
} from '../core/constants';
import type { BeatmapV1, BundledTrackEntry, BundledTrackManifest, Difficulty } from './types';
import {
  isBoundedText,
  isFiniteNumber,
  isHash,
  isLocalTrackAsset,
  isRecord,
  validateBeatmap,
} from './validate';

export async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
export function validateBundledManifest(value: unknown): BundledTrackManifest {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Array.isArray(value.tracks) ||
    value.tracks.length > Math.floor(MAX_ASSET_JSON_BYTES / ASSET_TEXT_MAX_CHARS)
  )
    throw new Error('Invalid starter-library manifest');
  const seen = new Set<string>();
  for (const raw of value.tracks) {
    if (
      !isRecord(raw) ||
      typeof raw.slug !== 'string' ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw.slug) ||
      raw.slug.length > ASSET_TEXT_MAX_CHARS ||
      seen.has(raw.slug)
    )
      throw new Error('Invalid or duplicate starter-song identity');
    const slug = raw.slug;
    seen.add(slug);
    const bad = (field: string): never => {
      throw new Error(`Invalid ${slug} catalog field: ${field}`);
    };
    if (!isBoundedText(raw.title) || !isBoundedText(raw.artist)) bad('title/artist');
    if (!['intro', 'groove', 'showcase'].includes(raw.role as string)) bad('role');
    if (!isLocalTrackAsset(raw.audioUrl, slug, 'audio.mp3')) bad('audioUrl');
    if (raw.coverUrl !== undefined && !isLocalTrackAsset(raw.coverUrl, slug, 'cover.webp')) bad('coverUrl');
    if (!isFiniteNumber(raw.durationMs) || raw.durationMs < MIN_TRACK_MS || raw.durationMs > MAX_TRACK_MS)
      bad('durationMs');
    if (raw.bpm !== null && (!isFiniteNumber(raw.bpm) || raw.bpm < 40 || raw.bpm > 240)) bad('bpm');
    if (raw.generatorVersion !== GENERATOR_VERSION) bad('generatorVersion');
    if (
      !isRecord(raw.preview) ||
      !isFiniteNumber(raw.preview.startMs) ||
      !isFiniteNumber(raw.preview.durationMs) ||
      raw.preview.startMs < 0 ||
      raw.preview.durationMs <= 0 ||
      raw.preview.startMs + raw.preview.durationMs > (raw.durationMs as number)
    )
      bad('preview');
    if (!isRecord(raw.difficultyMaps) || !isRecord(raw.hashes) || !isRecord(raw.hashes.maps))
      bad('maps/hashes');
    const paths = raw.difficultyMaps as Record<string, unknown>,
      hashes = raw.hashes as Record<string, unknown>,
      maps = hashes.maps as Record<string, unknown>;
    for (const difficulty of ['easy', 'normal', 'hard']) {
      if (!isLocalTrackAsset(paths[difficulty], slug, `${difficulty}.json`) || !isHash(maps[difficulty]))
        bad(`${difficulty} map`);
    }
    if (!isHash(hashes.audioSha256) || !isHash(hashes.canonicalPcmSha256)) bad('audio/PCM hashes');
    if (
      !Array.isArray(raw.warnings) ||
      raw.warnings.length > ASSET_TEXT_MAX_CHARS ||
      !raw.warnings.every(isBoundedText)
    )
      bad('warnings');
    if (!isRecord(raw.rights)) bad('rights');
    const rights = raw.rights as Record<string, unknown>;
    if (
      !['CC0-1.0', 'CC-BY-3.0', 'CC-BY-4.0'].includes(rights.license as string) ||
      !isBoundedText(rights.attribution) ||
      !isBoundedText(rights.changes)
    )
      bad('rights credit/license');
    for (const field of ['sourceUrl', 'licenseUrl']) {
      if (!isBoundedText(rights[field])) bad(field);
      let url: URL;
      try {
        url = new URL(rights[field] as string);
      } catch {
        bad(field);
      }
      if (url!.protocol !== 'https:') bad(field);
    }
  }
  return value as unknown as BundledTrackManifest;
}
async function localBytes(url: string, maxBytes?: number): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Local asset unavailable (${response.status}): ${url}`);
  const bytes = await response.arrayBuffer();
  if (maxBytes !== undefined && bytes.byteLength > maxBytes) throw new Error('Local JSON asset is too large');
  return bytes;
}
export async function loadBundledLibrary(): Promise<BundledTrackEntry[]> {
  const bytes = await localBytes('/assets/tracks/manifest.json', MAX_ASSET_JSON_BYTES);
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  return validateBundledManifest(parsed).tracks;
}
export async function loadBundledMap(track: BundledTrackEntry, difficulty: Difficulty): Promise<BeatmapV1> {
  const bytes = await localBytes(track.difficultyMaps[difficulty], MAX_ASSET_JSON_BYTES);
  if ((await sha256(bytes)) !== track.hashes.maps[difficulty])
    throw new Error(`${track.title}: chart hash mismatch; restore the packaged assets`);
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  const result = validateBeatmap(parsed);
  if (!result.valid || !result.map)
    throw new Error(
      `${track.title}: invalid chart: ${result.errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`,
    );
  const map = result.map;
  if (
    map.difficulty !== difficulty ||
    map.song.sourceHash !== track.hashes.audioSha256 ||
    map.song.source !== 'bundled' ||
    map.song.audioUrl !== track.audioUrl ||
    map.song.title !== track.title ||
    map.song.artist !== track.artist ||
    map.song.durationMs !== track.durationMs ||
    map.generatorVersion !== track.generatorVersion
  )
    throw new Error(`${track.title}: chart/catalog identity mismatch`);
  return map;
}
export async function loadBundledAudioBytes(track: BundledTrackEntry): Promise<ArrayBuffer> {
  if (!isLocalTrackAsset(track.audioUrl, track.slug, 'audio.mp3')) throw new Error('Unsafe local audio path');
  const bytes = await localBytes(track.audioUrl);
  if ((await sha256(bytes)) !== track.hashes.audioSha256)
    throw new Error(`${track.title}: audio hash mismatch; restore the packaged file`);
  return bytes;
}
