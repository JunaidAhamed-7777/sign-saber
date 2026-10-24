/** Real scene objects with a mocked GPU boundary; no webcam or pixel/performance evidence. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type * as ThreeModule from 'three';
import { ArenaRenderer } from '../src/render/renderer';
import { TypedEmitter } from '../src/utils/emitter';
import type { GameEvents } from '../src/core/events';
import { syntheticFrame } from './tracking-fixtures';
import {
  ARENA_REACTIVE_GAIN,
  PLAY_CENTER_Y,
  PLAY_H,
  PLAY_W,
  MAX_FRAGMENTS,
  POOF_SPARKS,
} from '../src/core/constants';
vi.mock('three', async () => {
  const actual = await vi.importActual<typeof ThreeModule>('three');
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = { setAttribute: vi.fn(), remove: vi.fn() };
      autoClear = true;
      outputColorSpace = '';
      setPixelRatio = vi.fn();
      setClearColor = vi.fn();
      setSize = vi.fn();
      setScissorTest = vi.fn();
      setViewport = vi.fn();
      setScissor = vi.fn();
      clear = vi.fn();
      clearDepth = vi.fn();
      render = vi.fn();
      dispose = vi.fn();
    },
  };
});
const renderers: ArenaRenderer[] = [];
beforeEach(() => {
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('innerHeight', 720);
  vi.stubGlobal('devicePixelRatio', 1);
  vi.stubGlobal('fetch', async () => new Response('', { status: 404 }));
});
afterEach(() => {
  for (const renderer of renderers) renderer.dispose();
  renderers.length = 0;
  vi.unstubAllGlobals();
});
function create() {
  const events = new TypedEmitter<GameEvents>(),
    renderer = new ArenaRenderer({ append: vi.fn() } as unknown as HTMLElement, events);
  renderers.push(renderer);
  return { renderer, events };
}
describe('upper-body figure and restrained music response', () => {
  it('keeps beam rays separate from poofs, spawns no beam debris and shares the full effect budget', () => {
    const { renderer, events } = create();
    renderer.setMode('play');
    renderer.draw(1000);
    const note = {
      id: 1,
      t: 1000,
      type: 'beam' as const,
      col: 2 as const,
      row: 1 as const,
      dir: 'any' as const,
      strength: 1,
    };
    events.emit('beam:fire', {
      hand: 'right',
      from: { x: 0, y: 1.5, z: 0 },
      to: { x: 0.6, y: 2.1, z: -14 },
      note: null,
    });
    renderer.draw(1000);
    expect(renderer.effectOccupancy).toBe(0);
    const payload: GameEvents['note:hit'] = {
      note,
      judgement: 'perfect',
      timingErrorMs: 0,
      hand: 'right',
      impactPos: { x: 0.6, y: 2.1, z: -14 },
      impactVel: { x: 3, y: 0, z: 0 },
      scoreDelta: 100,
      combo: 1,
      multiplier: 1,
    };
    events.emit('note:hit', payload);
    renderer.draw(1200);
    expect(renderer.effectOccupancy).toBe(POOF_SPARKS);
    expect((renderer.scene.getObjectByName('debris_fragments') as THREE.InstancedMesh).count).toBe(0);
    for (let i = 2; i < 100; i++) {
      events.emit('note:hit', {
        ...payload,
        note: { ...note, id: i, type: i % 3 === 0 ? 'beam' : i % 3 === 1 ? 'smash' : 'slash' },
      });
      expect(renderer.effectOccupancy).toBeLessThanOrEqual(MAX_FRAGMENTS);
    }
    renderer.reset();
    expect(renderer.effectOccupancy).toBe(0);
  });
  it('places a head circle only at the actual visible nose and preserves owned frozen/saved positions', () => {
    const { renderer, events } = create(),
      frame = syntheticFrame(0, 1000);
    renderer.setMode('play');
    renderer.tracking(frame, true);
    renderer.draw(1000);
    const head = renderer.scene.getObjectByName('player_head_marker')!;
    expect(head.visible).toBe(true);
    expect(head.position.x).toBeCloseTo((frame.pose!.landmarks[0]! - 0.5) * PLAY_W);
    expect(head.position.y).toBeCloseTo(PLAY_CENTER_Y + (0.5 - frame.pose!.landmarks[1]!) * PLAY_H);
    const frozen = head.position.clone();
    renderer.hideTracking();
    renderer.setMode('paused');
    renderer.draw(5000);
    expect(head.visible).toBe(true);
    expect(head.position.equals(frozen)).toBe(true);
    renderer.setMode('play');
    renderer.tracking(syntheticFrame(1, 1300), true);
    renderer.draw(1300);
    events.emit('highlight:capture', { songTimeMs: 1300 });
    const saved = head.position.clone();
    const moved = syntheticFrame(2, 1400);
    moved.pose!.landmarks[0] = 0.8;
    renderer.tracking(moved, true);
    renderer.draw(1400);
    expect(head.position.equals(saved)).toBe(false);
    renderer.setMode('results');
    renderer.draw(1500);
    expect(head.position.equals(saved)).toBe(true);
    expect(renderer.highlightTimeMs).toBe(1300);
  });
  it('hides an uncertain nose and its entire neck segment instead of drawing an invented head', () => {
    const { renderer } = create(),
      frame = syntheticFrame(0, 1000);
    frame.pose!.landmarks[3] = 0;
    renderer.setMode('play');
    renderer.tracking(frame, true);
    renderer.draw(1000);
    expect(renderer.scene.getObjectByName('player_head_marker')!.visible).toBe(false);
    const skeleton = renderer.scene.getObjectByName('player_skeleton') as THREE.LineSegments,
      positions = skeleton.geometry.getAttribute('position');
    expect(positions.getY(positions.count - 1)).toBe(-100);
    expect(positions.getY(positions.count - 2)).toBe(-100);
  });
  it('reacts through emission only, holds Calm steady and rejects paused music updates', async () => {
    const { renderer } = create(),
      environment = new THREE.Group(),
      material = new THREE.MeshStandardMaterial({ color: 0x19f5ff }),
      mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material);
    mesh.name = 'arena_rail_cyan';
    environment.add(mesh);
    renderer.assets.assets.environment = environment;
    for (let i = 0; i < 12; i++) await Promise.resolve();
    renderer.setMusicBands({ low: 1, mid: 0.5, high: 0.5, rms: 0.5 });
    renderer.draw(1000);
    expect(material.emissiveIntensity).toBeCloseTo(0.4 + ARENA_REACTIVE_GAIN);
    renderer.setCalm(true);
    renderer.setMusicBands({ low: 0.5, mid: 0, high: 0, rms: 0 });
    renderer.draw(1100);
    expect(material.emissiveIntensity).toBe(0.4);
    renderer.setCalm(false);
    renderer.draw(1200);
    const frozen = material.emissiveIntensity;
    renderer.setMode('paused');
    renderer.setMusicBands({ low: 0, mid: 0, high: 0, rms: 0 });
    renderer.draw(5000);
    expect(material.emissiveIntensity).toBe(frozen);
  });
});
