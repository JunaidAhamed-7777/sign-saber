import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { TextEncoder } from 'node:util';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import * as THREE from 'three';
import {
  AssetRegistry,
  fallbackShards,
  signedGeometryVolume,
  validateLocalGlb,
} from '../src/render/assets.ts';
import { ShatterPool } from '../src/render/shatter.ts';
import { FRAGMENT_LIFETIME_MS, MAX_FRAGMENTS } from '../src/core/constants.ts';
const { Response } = globalThis;
const registries = [];
function dispose(registry) {
  const geometries = new Set(),
    materials = new Set();
  registry.stop();
  registry.collectDisposal(geometries, materials);
  for (const g of geometries) g.dispose();
  for (const m of materials) m.dispose();
}
afterEach(() => {
  for (const registry of registries) dispose(registry);
  registries.length = 0;
  vi.unstubAllGlobals();
});
function registry() {
  const value = new AssetRegistry();
  registries.push(value);
  return value;
}
function glb(json) {
  const encoded = new TextEncoder().encode(JSON.stringify(json)),
    length = Math.ceil(encoded.length / 4) * 4,
    bytes = new ArrayBuffer(20 + length),
    view = new DataView(bytes);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, length, true);
  view.setUint32(16, 0x4e4f534a, true);
  const data = new Uint8Array(bytes, 20);
  data.fill(32);
  data.set(encoded);
  return bytes;
}
describe('local authored assets and verified complete fallbacks', () => {
  it('rejects corrupt, oversized and external-resource models before the loader follows a URI', () => {
    expect(() => validateLocalGlb(new ArrayBuffer(32))).toThrow('header');
    expect(() => validateLocalGlb(new ArrayBuffer(1024 * 1024 + 1))).toThrow('budget');
    expect(() =>
      validateLocalGlb(
        glb({ asset: { version: '2.0' }, images: [{ uri: 'https://example.invalid/image.png' }] }),
      ),
    ).toThrow('embedded');
    expect(() =>
      validateLocalGlb(
        glb({ asset: { version: '2.0' }, extensionsRequired: ['KHR_draco_mesh_compression'] }),
      ),
    ).toThrow('decoder');
  });
  it('prepares eight closed octants whose volumes reconstruct the full unit cube', () => {
    const shards = fallbackShards();
    expect(shards).toHaveLength(8);
    expect(
      shards.reduce((total, shard) => total + Math.abs(signedGeometryVolume(shard.geometry)), 0),
    ).toBeCloseTo(1, 10);
    for (const shard of shards) {
      expect(Math.abs(shard.offset.x)).toBe(0.25);
      expect(Math.abs(shard.offset.y)).toBe(0.25);
      expect(Math.abs(shard.offset.z)).toBe(0.25);
      shard.geometry.dispose();
    }
  });
  it('loads all actual Blender GLBs through the browser loader and validates complete authored shards', async () => {
    const fetched = [];
    vi.stubGlobal('fetch', async (url) => {
      fetched.push(url);
      const bytes = await readFile(new URL(`../public${url}`, import.meta.url));
      return new Response(bytes);
    });
    const assets = registry();
    await assets.load();
    expect(fetched).toHaveLength(7);
    expect(fetched.every((url) => url.startsWith('/assets/models/'))).toBe(true);
    expect(
      Object.values(assets.status).every((status) => status.state === 'authored'),
      JSON.stringify(assets.status),
    ).toBe(true);
    expect(assets.assets.shardMode).toBe('authored-fourteen');
    expect(assets.assets.shards).toHaveLength(14);
    // Fracture faces are tagged so the shard shader can light the cross-sections.
    for (const shard of assets.assets.shards) {
      const inner = shard.geometry.getAttribute('aInner');
      expect(inner.count).toBe(shard.geometry.getAttribute('position').count);
    }
    expect(
      assets.assets.shards.some((s) => Array.from(s.geometry.getAttribute('aInner').array).includes(1)),
    ).toBe(true);
    const trim = assets.assets.blockShell.getAttribute('aTrim').array;
    expect(Array.from(trim).includes(1) && Array.from(trim).includes(0)).toBe(true);
    expect(Array.from(assets.assets.pylon.getAttribute('aTrim').array).includes(1)).toBe(true);
    expect(assets.assets.glyphArrow.getAttribute('position').count).toBeGreaterThan(0);
    expect(
      assets.assets.shards.reduce(
        (total, shard) => total + Math.abs(signedGeometryVolume(shard.geometry)),
        0,
      ),
    ).toBeCloseTo(1, 5);
    expect(assets.assets.environment.getObjectByName('arena_horizon_ring')).toBeTruthy();
  });
  it('keeps every procedural subsystem ready when local model acquisition fails', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
    const assets = registry();
    await assets.load();
    expect(Object.values(assets.status).every((status) => status.state === 'fallback')).toBe(true);
    expect(assets.assets.shardMode).toBe('procedural-eight');
    expect(assets.assets.shards).toHaveLength(8);
    expect(assets.assets.glyphs.slash.getAttribute('position').count).toBeGreaterThan(0);
  });
  it('rejects an incomplete glyph group and retains the entire prior fallback group', async () => {
    vi.stubGlobal('fetch', async (url) => {
      let bytes = await readFile(new URL(`../public${url}`, import.meta.url));
      if (url.endsWith('/glyphs.glb')) {
        bytes = Buffer.from(bytes);
        const at = bytes.indexOf('glyph_palm');
        expect(at).toBeGreaterThan(0);
        bytes.write('badxx_palm', at, 'utf8');
      }
      return new Response(bytes);
    });
    const assets = registry(),
      fallback = assets.assets.glyphs;
    await assets.load();
    expect(assets.status.glyphs.state).toBe('fallback');
    expect(assets.assets.glyphs).toBe(fallback);
    expect(assets.status.glyphs.error).toContain('glyph_palm');
  });
  it('pools shatter transforms, freezes exactly by song time and recycles decorative overflow', () => {
    const scene = new THREE.Scene(),
      shards = fallbackShards(),
      pool = new ShatterPool(scene, shards);
    const event = Object.freeze({
      note: Object.freeze({ id: 1, t: 1000, type: 'smash', col: 2, row: 1, dir: 'any', strength: 1 }),
      impactPos: Object.freeze({ x: 0.6, y: 1.5, z: 0 }),
      impactVel: Object.freeze({ x: 3, y: 0, z: 0 }),
    });
    for (let i = 0; i < 40; i++) pool.trigger(event, 0);
    expect(pool.occupancy).toBeLessThanOrEqual(MAX_FRAGMENTS);
    expect(scene.children).toHaveLength(8);
    pool.update(100, true, false);
    const before = scene.children.map((mesh) => Array.from(mesh.instanceMatrix.array));
    pool.update(100, true, false);
    expect(scene.children.map((mesh) => Array.from(mesh.instanceMatrix.array))).toEqual(before);
    for (const matrix of before) expect(matrix.every(Number.isFinite)).toBe(true);
    pool.update(FRAGMENT_LIFETIME_MS + 1, true, false);
    expect(pool.occupancy).toBe(0);
    expect(scene.children.every((mesh) => mesh.count === 0)).toBe(true);
    pool.reset();
    pool.dispose();
    for (const shard of shards) shard.geometry.dispose();
    expect(scene.children).toHaveLength(0);
  });
});
