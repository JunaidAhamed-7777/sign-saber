/** Same-origin authored geometry with complete, prebuilt procedural fallbacks. Never loads on a hit. */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Vec3 } from '../core/types';
import { ASSET_MODEL_MAX_BYTES } from '../core/constants';

export type GeometryAsset =
  'armor' | 'beam_ring' | 'glyphs' | 'pylon' | 'block_fractured' | 'arena_environment' | 'block_shell';
export interface ShardAsset {
  geometry: THREE.BufferGeometry;
  offset: Vec3;
}
export interface ArenaAssets {
  armor: THREE.BufferGeometry;
  beamRing: THREE.BufferGeometry;
  glyphs: Record<'slash' | 'smash' | 'beam', THREE.BufferGeometry>;
  /** Directional cut chevron pointing +Y; drawn only for notes whose `dir` is not `any`. */
  glyphArrow: THREE.BufferGeometry;
  /** 1 m bevelled glass shell; per-vertex `aTrim` is 1 on the emissive bevel trims. */
  blockShell: THREE.BufferGeometry;
  /** Faceted inner light core of the block, centred at the origin. */
  blockCore: THREE.BufferGeometry;
  /** Pylon with per-vertex `aTrim` = 1 on the recessed strip and lit crown. */
  pylon: THREE.BufferGeometry;
  /** Centroid-local shards; per-vertex `aInner` is 1 on fracture (cross-section) faces. */
  shards: ShardAsset[];
  shardMode: 'procedural-eight' | 'authored-eight' | 'authored-fourteen';
  environment: THREE.Group | null;
}
export interface AssetStatus {
  state: 'loading' | 'authored' | 'fallback';
  error: string | null;
}
const ASSET_NAMES: readonly GeometryAsset[] = [
  'armor',
  'beam_ring',
  'glyphs',
  'pylon',
  'block_fractured',
  'arena_environment',
  'block_shell',
];

/** Validate binary framing and ban external resources before GLTFLoader can follow a URI. */
export function validateLocalGlb(bytes: ArrayBuffer): void {
  if (bytes.byteLength < 20 || bytes.byteLength > ASSET_MODEL_MAX_BYTES)
    throw new Error('Model file is empty or exceeds the local asset budget.');
  const view = new DataView(bytes);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.byteLength
  )
    throw new Error('Invalid GLB2 header.');
  const length = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || length > bytes.byteLength - 20)
    throw new Error('Missing GLB JSON chunk.');
  const json: unknown = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, length)));
  if (!json || typeof json !== 'object') throw new Error('Invalid model description.');
  const record = json as { buffers?: unknown[]; images?: unknown[]; extensionsRequired?: unknown[] };
  for (const entries of [record.buffers, record.images])
    for (const entry of entries ?? [])
      if (entry && typeof entry === 'object' && 'uri' in entry)
        throw new Error('Models must contain only local embedded resources.');
  if (record.extensionsRequired?.some((extension) => extension === 'KHR_draco_mesh_compression'))
    throw new Error('Compressed model requires an unsupported decoder.');
}
export function signedGeometryVolume(geometry: THREE.BufferGeometry): number {
  const p = geometry.getAttribute('position'),
    index = geometry.getIndex();
  let volume = 0;
  const count = index?.count ?? p.count;
  for (let i = 0; i < count; i += 3) {
    const a = index ? index.getX(i) : i,
      b = index ? index.getX(i + 1) : i + 1,
      c = index ? index.getX(i + 2) : i + 2;
    volume +=
      (p.getX(a) * (p.getY(b) * p.getZ(c) - p.getZ(b) * p.getY(c)) +
        p.getY(a) * (p.getZ(b) * p.getX(c) - p.getX(b) * p.getZ(c)) +
        p.getZ(a) * (p.getX(b) * p.getY(c) - p.getY(b) * p.getX(c))) /
      6;
  }
  return volume;
}
function merge(parts: THREE.BufferGeometry[], keep: readonly string[] = []): THREE.BufferGeometry {
  const normalized = parts.map((part) => {
    const out = part.index ? part.toNonIndexed() : part.clone();
    for (const name of Object.keys(out.attributes))
      if (name !== 'position' && name !== 'normal' && !keep.includes(name)) out.deleteAttribute(name);
    if (!out.getAttribute('normal')) out.computeVertexNormals();
    return out;
  });
  const geometry = mergeGeometries(normalized, false);
  for (const part of normalized) part.dispose();
  for (const part of parts) part.dispose();
  return geometry;
}
function box(w: number, h: number, d: number, x = 0, y = 0, z = 0): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}
/** Adds a constant per-vertex float attribute (for example a material-derived surface flag). */
function tag(geometry: THREE.BufferGeometry, name: string, value: number): THREE.BufferGeometry {
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(count).fill(value), 1));
  return geometry;
}
function glyph(kind: 'slash' | 'smash' | 'beam'): THREE.BufferGeometry {
  const parts = [box(0.38, 0.32, 0.05, 0, -0.1, 0)];
  if (kind === 'slash') {
    for (let i = 0; i < 4; i++) parts.push(box(0.075, 0.28, 0.05, -0.135 + i * 0.09, 0.18, 0));
    parts.push(box(0.22, 0.08, 0.05, -0.25, -0.04, 0));
  } else if (kind === 'smash') {
    for (let i = 0; i < 4; i++) parts.push(box(0.09, 0.12, 0.05, -0.15 + i * 0.1, 0.12, 0));
  } else {
    parts.push(box(0.085, 0.44, 0.05, -0.1, 0.2, 0));
    parts.push(box(0.12, 0.09, 0.05, 0.2, -0.05, 0));
  }
  return merge(parts);
}
function chevron(): THREE.BufferGeometry {
  const arm = (angle: number, x: number): THREE.BufferGeometry =>
    new THREE.BoxGeometry(0.42, 0.13, 0.04).rotateZ(angle).translate(x, 0.02, 0);
  return merge([arm(Math.PI / 4, -0.14), arm(-Math.PI / 4, 0.14)]);
}
/** Fallback shell: an unbevelled unit cube; the block shader derives its edge trims procedurally. */
function fallbackShell(): THREE.BufferGeometry {
  return tag(new THREE.BoxGeometry(1, 1, 1).toNonIndexed(), 'aTrim', 0);
}
export function fallbackShards(): ShardAsset[] {
  const result: ShardAsset[] = [];
  for (let index = 0; index < 8; index++) {
    const offset = { x: index & 1 ? 0.25 : -0.25, y: index & 2 ? 0.25 : -0.25, z: index & 4 ? 0.25 : -0.25 },
      geometry = box(0.5, 0.5, 0.5),
      position = geometry.getAttribute('position'),
      normal = geometry.getAttribute('normal'),
      inner = new Float32Array(position.count);
    // Faces lying on the cube's internal x/y/z = 0 planes are fracture (inner) surfaces.
    for (let i = 0; i < position.count; i++) {
      const world =
        Math.abs(normal.getX(i)) > 0.5
          ? position.getX(i) + offset.x
          : Math.abs(normal.getY(i)) > 0.5
            ? position.getY(i) + offset.y
            : position.getZ(i) + offset.z;
      inner[i] = Math.abs(world) < 1e-6 ? 1 : 0;
    }
    geometry.setAttribute('aInner', new THREE.BufferAttribute(inner, 1));
    result.push({ geometry, offset });
  }
  return result;
}
function fallbackAssets(): ArenaAssets {
  const armor = merge([
    box(0.84, 0.06, 0.84, 0, 0.55, 0),
    box(0.84, 0.06, 0.84, 0, -0.55, 0),
    box(0.06, 0.84, 0.84, 0.55, 0, 0),
    box(0.06, 0.84, 0.84, -0.55, 0, 0),
  ]);
  // Fallback pylon has no recessed strip, so its aTrim mask is empty (body only).
  const pylon = tag(new THREE.CylinderGeometry(0.15, 0.25, 6, 6).translate(0, 3, 0), 'aTrim', 0);
  return {
    armor,
    beamRing: new THREE.TorusGeometry(0.42, 0.03, 8, 48),
    glyphs: { slash: glyph('slash'), smash: glyph('smash'), beam: glyph('beam') },
    glyphArrow: chevron(),
    blockShell: fallbackShell(),
    blockCore: new THREE.IcosahedronGeometry(0.17, 0),
    pylon,
    shards: fallbackShards(),
    shardMode: 'procedural-eight',
    environment: null,
  };
}
interface ExtractOptions {
  /** Convert the glTF COLOR_0 red channel into a float `aTrim` mask (0 when absent). */
  readonly trim?: boolean;
  /** Tag primitives whose material is named `inner` with `aInner` = 1. */
  readonly inner?: boolean;
}
function meshGeometry(
  scene: THREE.Object3D,
  name: string,
  options: ExtractOptions = {},
): { geometry: THREE.BufferGeometry; offset: Vec3 } {
  const node = scene.getObjectByName(name);
  if (!node) throw new Error(`Model is missing ${name}.`);
  scene.updateMatrixWorld(true);
  const center = new THREE.Vector3();
  node.getWorldPosition(center);
  const parts: THREE.BufferGeometry[] = [];
  node.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const geometry = child.geometry.clone().applyMatrix4(child.matrixWorld);
      geometry.translate(-center.x, -center.y, -center.z);
      if (options.trim) {
        const color = geometry.getAttribute('color'),
          trim = new Float32Array(geometry.getAttribute('position').count);
        if (color) for (let i = 0; i < trim.length; i++) trim[i] = color.getX(i) > 0.5 ? 1 : 0;
        geometry.setAttribute('aTrim', new THREE.BufferAttribute(trim, 1));
      }
      if (options.inner) {
        const material = (Array.isArray(child.material) ? child.material[0] : child.material) as
          THREE.Material | undefined;
        tag(geometry, 'aInner', material?.name === 'inner' ? 1 : 0);
      }
      parts.push(geometry);
    }
  });
  if (!parts.length) throw new Error(`Model node ${name} contains no geometry.`);
  const keep = [...(options.trim ? ['aTrim'] : []), ...(options.inner ? ['aInner'] : [])];
  return { geometry: merge(parts, keep), offset: { x: center.x, y: center.y, z: center.z } };
}
function disposeSource(scene: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>(),
    materials = new Set<THREE.Material>();
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        materials.add(material);
    }
  });
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
}

export class AssetRegistry {
  readonly assets = fallbackAssets();
  readonly status: Record<GeometryAsset, AssetStatus> = Object.fromEntries(
    ASSET_NAMES.map((name) => [name, { state: 'loading', error: null }]),
  ) as Record<GeometryAsset, AssetStatus>;
  readonly ownedGeometries = new Set<THREE.BufferGeometry>();
  readonly ownedMaterials = new Set<THREE.Material>();
  private readonly abort = new AbortController();
  private disposed = false;
  constructor() {
    this.collect(this.assets);
  }
  private extract(
    scene: THREE.Object3D,
    name: string,
    options: ExtractOptions = {},
  ): { geometry: THREE.BufferGeometry; offset: Vec3 } {
    const asset = meshGeometry(scene, name, options);
    this.ownedGeometries.add(asset.geometry);
    return asset;
  }
  private collect(assets: ArenaAssets): void {
    for (const geometry of [
      assets.armor,
      assets.beamRing,
      assets.pylon,
      assets.glyphArrow,
      assets.blockShell,
      assets.blockCore,
      ...Object.values(assets.glyphs),
      ...assets.shards.map((s) => s.geometry),
    ])
      this.ownedGeometries.add(geometry);
  }
  async load(): Promise<ArenaAssets> {
    await Promise.all(
      ASSET_NAMES.map(async (name) => {
        let scene: THREE.Group | null = null;
        try {
          const url = `/assets/models/${name}.glb`,
            response = await fetch(url, { signal: this.abort.signal });
          if (!response.ok) throw new Error(`Local ${name} model unavailable (${response.status}).`);
          const bytes = await response.arrayBuffer();
          validateLocalGlb(bytes);
          const gltf = await new GLTFLoader().parseAsync(bytes, '/assets/models/');
          scene = gltf.scene;
          if (this.disposed) {
            disposeSource(scene);
            return;
          }
          if (name === 'arena_environment') {
            for (const required of [
              'arena_floor',
              'arena_rail_cyan',
              'arena_rail_magenta',
              'arena_horizon_ring',
            ])
              if (!scene.getObjectByName(required)) throw new Error(`Arena model is missing ${required}.`);
            this.assets.environment = scene;
            scene.traverse((object) => {
              if (object instanceof THREE.Mesh) {
                this.ownedGeometries.add(object.geometry);
                for (const m of Array.isArray(object.material) ? object.material : [object.material])
                  this.ownedMaterials.add(m);
              }
            });
            scene = null;
          } else if (name === 'block_fractured') {
            const names: string[] = [];
            scene.traverse((object) => {
              if (/^shard_\d\d$/.test(object.name)) names.push(object.name);
            });
            names.sort();
            if (names.length !== 8 && names.length !== 14)
              throw new Error('Fractured model must have all eight fallback or fourteen authored shards.');
            for (let i = 0; i < names.length; i++)
              if (names[i] !== `shard_${String(i).padStart(2, '0')}`)
                throw new Error('Fractured shard names are incomplete.');
            const shards = names.map((node) => this.extract(scene!, node, { inner: true }));
            let volume = 0;
            for (const shard of shards) {
              volume += Math.abs(signedGeometryVolume(shard.geometry));
              const p = shard.geometry.getAttribute('position');
              for (let i = 0; i < p.count; i++)
                if (
                  Math.abs(p.getX(i) + shard.offset.x) > 0.501 ||
                  Math.abs(p.getY(i) + shard.offset.y) > 0.501 ||
                  Math.abs(p.getZ(i) + shard.offset.z) > 0.501
                )
                  throw new Error('Shard lies outside its unit cube.');
            }
            if (volume < 0.98 || volume > 1.02) throw new Error('Fractured cube volume check failed.');
            this.assets.shards = shards;
            this.assets.shardMode = shards.length === 14 ? 'authored-fourteen' : 'authored-eight';
          } else if (name === 'glyphs') {
            const glyphs = {
                slash: this.extract(scene, 'glyph_palm').geometry,
                smash: this.extract(scene, 'glyph_fist').geometry,
                beam: this.extract(scene, 'glyph_point').geometry,
              },
              arrow = this.extract(scene, 'glyph_arrow').geometry;
            this.assets.glyphs = glyphs;
            this.assets.glyphArrow = arrow;
          } else if (name === 'block_shell') {
            const shell = this.extract(scene, 'block_shell', { trim: true }).geometry,
              core = this.extract(scene, 'block_core').geometry;
            this.assets.blockShell = shell;
            this.assets.blockCore = core;
          } else if (name === 'armor') this.assets.armor = this.extract(scene, 'armor_plates').geometry;
          else if (name === 'beam_ring') this.assets.beamRing = this.extract(scene, 'beam_ring').geometry;
          else this.assets.pylon = this.extract(scene, 'pylon', { trim: true }).geometry;
          this.collect(this.assets);
          this.status[name] = { state: 'authored', error: null };
        } catch (error) {
          if (!this.disposed)
            this.status[name] = {
              state: 'fallback',
              error: error instanceof Error ? error.message : String(error),
            };
        } finally {
          if (scene) disposeSource(scene);
        }
      }),
    );
    return this.assets;
  }
  stop(): void {
    this.disposed = true;
    this.abort.abort();
  }
  collectDisposal(geometries: Set<THREE.BufferGeometry>, materials: Set<THREE.Material>): void {
    for (const g of this.ownedGeometries) geometries.add(g);
    for (const m of this.ownedMaterials) materials.add(m);
  }
}
