/** Real scene objects with a mocked GPU boundary; no webcam or pixel/performance evidence. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import type * as ThreeModule from 'three';
import { ArenaRenderer } from '../src/render/renderer';
import { TypedEmitter } from '../src/utils/emitter';
import type { GameEvents } from '../src/core/events';
import { syntheticFrame } from './tracking-fixtures';
import { createLiveNote, notePosition } from '../src/game/liveObjects';
import {
  ARENA_REACTIVE_GAIN,
  PLAY_CENTER_Y,
  PLAY_H,
  PLAY_W,
  MAX_FRAGMENTS,
  MAX_LIVE_NOTES,
  POOF_SPARKS,
  BEAM_ESCAPE_VISUAL_MS,
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
  it('keeps live required cues ahead of terminal follow-through when the shared target pool is full', () => {
    const { renderer } = create(),
      notes = Array.from({ length: MAX_LIVE_NOTES + 1 }, (_, index) => {
        const live = createLiveNote({
          id: index,
          t: 1000,
          type: index === MAX_LIVE_NOTES ? 'smash' : 'beam',
          col: 2,
          row: 1,
          dir: 'any',
          strength: 1,
        });
        live.spawned = true;
        if (index !== MAX_LIVE_NOTES) live.state = 'escaped';
        return live;
      });
    renderer.setMode('play');
    renderer.draw(1000, notes);
    expect((renderer.scene.getObjectByName('lane_targets') as THREE.InstancedMesh).count).toBe(
      MAX_LIVE_NOTES,
    );
    expect((renderer.scene.getObjectByName('target_glyph_smash') as THREE.InstancedMesh).count).toBe(1);
    expect((renderer.scene.getObjectByName('target_glyph_beam') as THREE.InstancedMesh).count).toBe(
      MAX_LIVE_NOTES - 1,
    );
  });
  it('retains the required glyph after one Bad Cut, freezes it on pause and never changes authoritative state', () => {
    const { renderer, events } = create(),
      live = createLiveNote({ id: 0, t: 1000, type: 'smash', col: 2, row: 1, dir: 'any', strength: 1 }),
      notes = [live];
    live.spawned = true;
    notePosition(live.note, 1000, 10000, live.pos);
    renderer.setApproachMs(10000);
    renderer.setMode('play');
    renderer.draw(1000, notes);
    live.state = 'badcut';
    const state = JSON.stringify(live),
      badcut = vi.fn(),
      miss = vi.fn();
    events.on('note:badcut', badcut);
    events.on('note:miss', miss);
    Object.freeze(live.note);
    Object.freeze(live.pos);
    Object.freeze(live);
    events.emit('note:badcut', { note: live.note, hand: 'right', gesture: 'open' });
    renderer.draw(1110, notes);
    const targets = renderer.scene.getObjectByName('lane_targets') as THREE.InstancedMesh,
      glyphs = renderer.scene.getObjectByName('target_glyph_smash') as THREE.InstancedMesh,
      armor = renderer.scene.getObjectByName('target_armor') as THREE.InstancedMesh,
      matrix = new THREE.Matrix4();
    expect(targets.count).toBe(1);
    expect(glyphs.count).toBe(1);
    expect(armor.count).toBe(1);
    targets.getMatrixAt(0, matrix);
    const frozen = matrix.clone();
    renderer.setMode('paused');
    renderer.draw(5000, notes);
    targets.getMatrixAt(0, matrix);
    expect(matrix.equals(frozen)).toBe(true);
    renderer.setMode('play');
    renderer.draw(10000, notes);
    expect(targets.count).toBe(0);
    expect(glyphs.count).toBe(0);
    expect(badcut).toHaveBeenCalledTimes(1);
    expect(miss).not.toHaveBeenCalled();
    expect(renderer.effectOccupancy).toBe(0);
    expect(JSON.stringify(live)).toBe(state);
    expect(() => renderer.setApproachMs(NaN)).toThrow('Invalid chart approach time');
    expect(() => renderer.setApproachMs(0)).toThrow('Invalid chart approach time');
  });
  it('removes aim assistance from escaped beam targets without dropping their glyph or spawning destruction', () => {
    const { renderer, events } = create(),
      live = createLiveNote({ id: 0, t: 1000, type: 'beam', col: 2, row: 1, dir: 'any', strength: 1 }),
      notes = [live];
    live.spawned = true;
    renderer.setMode('play');
    renderer.draw(1250, notes);
    const reticles = renderer.scene.getObjectByName('target_reticles') as THREE.InstancedMesh,
      rings = renderer.scene.getObjectByName('target_rings') as THREE.InstancedMesh,
      glyphs = renderer.scene.getObjectByName('target_glyph_beam') as THREE.InstancedMesh;
    expect(reticles.count).toBe(1);
    live.state = 'escaped';
    events.emit('note:miss', { note: live.note });
    renderer.draw(1250 + BEAM_ESCAPE_VISUAL_MS / 2, notes);
    expect(reticles.count).toBe(0);
    expect(rings.count).toBe(1);
    expect(glyphs.count).toBe(1);
    expect(renderer.effectOccupancy).toBe(0);
    renderer.draw(1250 + BEAM_ESCAPE_VISUAL_MS, notes);
    expect(rings.count).toBe(0);
    expect(glyphs.count).toBe(0);
    expect(live.state).toBe('escaped');
  });
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
