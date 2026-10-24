/** Pooled lane renderer; camera imagery never enters this scene. */
import * as THREE from 'three';
import type { TrackingFrame, HandCursor, SessionStats, BandEnergies } from '../core/types';
import type { LiveNote, LiveObstacle } from '../game/liveObjects';
import type { GameEvents } from '../core/events';
import type { TypedEmitter } from '../utils/emitter';
import { AssetRegistry } from './assets';
import { ShatterPool } from './shatter';
import { SlicePool } from './slices';
import { beamAimTarget } from '../game/hit';
import {
  BG_COLOR,
  BLOCK_SIZE,
  CAM_FOV_DEG,
  CAM_LOOK_AT,
  CAM_POS,
  FOG_DENSITY,
  GRID_LINE_COLOR,
  MASK_H,
  MASK_W,
  MAX_LIVE_NOTES,
  PLAY_CENTER_Y,
  PLAY_H,
  PLAY_W,
  SILHOUETTE_Z,
  HAND_TINT_LEFT,
  HAND_TINT_RIGHT,
  MAX_FRAGMENTS,
  FRAGMENT_LIFETIME_MS,
  SHATTER_BURST_MIN,
  SHATTER_BURST_MAX,
  OBSTACLE_ALPHA,
  POOF_LIFETIME_MS,
  BEAM_VISUAL_MS,
  GLYPH_FACE_OFFSET_M,
  MAX_LIVE_OBSTACLES,
  PYLON_SPACING_M,
  PYLON_X,
  BEAM_AIM_RADIUS,
  ARENA_REACTIVE_GAIN,
  SIL_HEAD_RADIUS_M,
} from '../core/constants';
const colors = { slash: 0x19f5ff, smash: 0xff2bd6, beam: 0xffc32b };
const scratch = new THREE.Object3D();
const tint = new THREE.Color();
const aimTarget = { x: 0, y: 0, z: 0 };
const connections = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
] as const;
interface Effect {
  active: boolean;
  birth: number;
  life: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  color: number;
  rotation: number;
}
export class ArenaRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly assets = new AssetRegistry();
  private assetPending = false;
  private disposed = false;
  private readonly armorMaterial = new THREE.MeshStandardMaterial({
    color: 0x2a2238,
    emissive: 0x411336,
    metalness: 0.9,
    roughness: 0.35,
  });
  private readonly ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffc32b });
  private readonly glyphMaterial = new THREE.MeshBasicMaterial({ color: 0xe8f1ff, depthTest: true });
  private readonly armor = new THREE.InstancedMesh(
    this.assets.assets.armor,
    this.armorMaterial,
    MAX_LIVE_NOTES,
  );
  private readonly beamRings = new THREE.InstancedMesh(
    this.assets.assets.beamRing,
    this.ringMaterial,
    MAX_LIVE_NOTES,
  );
  private readonly reticles = new THREE.InstancedMesh(
    new THREE.RingGeometry(BEAM_AIM_RADIUS - 0.015, BEAM_AIM_RADIUS, 48),
    new THREE.MeshBasicMaterial({ color: 0xffc32b, transparent: true, opacity: 0.35, depthWrite: false }),
    MAX_LIVE_NOTES,
  );
  private readonly glyphMeshes: Record<'slash' | 'smash' | 'beam', THREE.InstancedMesh> = {
    slash: new THREE.InstancedMesh(this.assets.assets.glyphs.slash, this.glyphMaterial, MAX_LIVE_NOTES),
    smash: new THREE.InstancedMesh(this.assets.assets.glyphs.smash, this.glyphMaterial, MAX_LIVE_NOTES),
    beam: new THREE.InstancedMesh(this.assets.assets.glyphs.beam, this.glyphMaterial, MAX_LIVE_NOTES),
  };
  private readonly pylons = new THREE.InstancedMesh(
    this.assets.assets.pylon,
    new THREE.MeshStandardMaterial({ color: 0x19283e, emissive: 0x081f2a, metalness: 0.5, roughness: 0.6 }),
    12,
  );
  private readonly shatter: ShatterPool;
  private readonly slices: SlicePool;
  private renderedNotes: readonly LiveNote[] = [];
  private environment: THREE.Group | null = null;
  private readonly beamLines: THREE.Line[] = [];
  private readonly beamBirth = [-Infinity, -Infinity];
  private readonly camera = new THREE.PerspectiveCamera(CAM_FOV_DEG, 16 / 9, 0.05, 100);
  private readonly cubeGeometry = new THREE.BoxGeometry(BLOCK_SIZE, BLOCK_SIZE, BLOCK_SIZE);
  private readonly cubeMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.22,
    metalness: 0.55,
    emissive: 0x223344,
  });
  private readonly blocks = new THREE.InstancedMesh(this.cubeGeometry, this.cubeMaterial, MAX_LIVE_NOTES);
  private readonly fragmentGeometry = new THREE.BoxGeometry(1, 1, 1);
  private readonly fragmentMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
  });
  private readonly fragments = new THREE.InstancedMesh(
    this.fragmentGeometry,
    this.fragmentMaterial,
    MAX_FRAGMENTS,
  );
  private readonly effects: Effect[] = Array.from({ length: MAX_FRAGMENTS }, () => ({
    active: false,
    birth: 0,
    life: 0,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    size: 0,
    color: 0,
    rotation: 0,
  }));
  private effectIndex = 0;
  private readonly edges: THREE.LineSegments[] = [];
  private readonly glyphs: THREE.LineSegments[] = [];
  private readonly walls: THREE.Mesh[] = [];
  private readonly maskData = new Uint8Array(MASK_W * MASK_H);
  private readonly mask = new THREE.DataTexture(this.maskData, MASK_W, MASK_H, THREE.RedFormat);
  private readonly silhouette: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly joints = new Float32Array((connections.length + 1) * 6);
  private readonly skeleton: THREE.LineSegments;
  private readonly handMeshes: THREE.Mesh[] = [];
  private readonly handLines: THREE.Line[] = [];
  private readonly savedJoints = new Float32Array((connections.length + 1) * 6);
  private readonly savedMask = new Uint8Array(MASK_W * MASK_H);
  private readonly frozenJoints = new Float32Array((connections.length + 1) * 6);
  private readonly headMarker = new THREE.Mesh(
    new THREE.RingGeometry(SIL_HEAD_RADIUS_M * 0.84, SIL_HEAD_RADIUS_M, 32),
    new THREE.MeshBasicMaterial({ color: 0x64eaff, transparent: true, opacity: 0.8, depthTest: false }),
  );
  private headPresent = false;
  private frozenHeadPresent = false;
  private savedHeadPresent = false;
  private readonly frozenHead = { x: 0, y: 0, z: 0 };
  private readonly savedHead = { x: 0, y: 0, z: 0 };
  private readonly bands: BandEnergies = { low: 0, mid: 0, high: 0, rms: 0 };
  private readonly neonMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly frozenMask = new Uint8Array(MASK_W * MASK_H);
  private frozenPose = false;
  private frozenMaskPresent = false;
  private snapshotValid = false;
  private snapshotAt: number | null = null;
  private savedHasMask = false;
  private savedHasPose = false;
  private hasMask = false;
  private hasPose = false;
  private visible = false;
  private currentTime = 0;
  private unsubscribe: (() => void)[] = [];
  private menuStage: HTMLElement | null = null;
  private mode: 'menu' | 'play' | 'paused' | 'results' = 'menu';
  private calm = false;
  constructor(container: HTMLElement, events: TypedEmitter<GameEvents>) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.autoClear = false;
    this.renderer.setClearColor(BG_COLOR);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    container.append(this.renderer.domElement);
    this.camera.position.set(CAM_POS.x, CAM_POS.y, CAM_POS.z);
    this.camera.lookAt(CAM_LOOK_AT.x, CAM_LOOK_AT.y, CAM_LOOK_AT.z);
    this.scene.fog = new THREE.FogExp2(BG_COLOR, FOG_DENSITY);
    this.scene.add(new THREE.AmbientLight(0xc3ddff, 2));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(2, 6, 3);
    this.scene.add(light);
    const grid = new THREE.GridHelper(100, 50, GRID_LINE_COLOR, 0x102234);
    grid.position.y = -0.35;
    this.scene.add(grid);
    this.scene.add(
      this.armor,
      this.beamRings,
      this.reticles,
      this.pylons,
      ...Object.values(this.glyphMeshes),
    );
    for (const mesh of [this.armor, this.beamRings, this.reticles, ...Object.values(this.glyphMeshes)]) {
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
    }
    this.pylons.frustumCulled = false;
    for (let i = 0; i < 12; i++) {
      scratch.position.set(i % 2 === 0 ? -PYLON_X : PYLON_X, 0, -Math.floor(i / 2) * PYLON_SPACING_M);
      scratch.rotation.set(0, 0, 0);
      scratch.scale.setScalar(1);
      scratch.updateMatrix();
      this.pylons.setMatrixAt(i, scratch.matrix);
    }
    this.pylons.instanceMatrix.needsUpdate = true;
    this.shatter = new ShatterPool(this.scene, this.assets.assets.shards);
    this.slices = new SlicePool(this.scene);
    this.blocks.frustumCulled = false;
    this.blocks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.blocks);
    this.fragments.frustumCulled = false;
    this.fragments.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.fragments);
    const edgeGeometry = new THREE.EdgesGeometry(this.cubeGeometry);
    const glyphGeometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.16, -0.16, 0.31),
      new THREE.Vector3(0.16, 0.16, 0.31),
    ]);
    for (let i = 0; i < MAX_LIVE_NOTES; i++) {
      const edge = new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({ color: 0x19f5ff }));
      edge.visible = false;
      this.edges.push(edge);
      this.scene.add(edge);
      const glyph = new THREE.LineSegments(glyphGeometry, new THREE.LineBasicMaterial({ color: 0xffffff }));
      glyph.visible = false;
      this.glyphs.push(glyph);
      this.scene.add(glyph);
    }
    const wallArrowGeometry = new THREE.BufferGeometry();
    wallArrowGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(
        new Float32Array([
          -0.4, 0, 0.51, 0.4, 0, 0.51, 0.15, 0.2, 0.51, 0.4, 0, 0.51, 0.15, -0.2, 0.51, 0.4, 0, 0.51,
        ]),
        3,
      ),
    );
    const wallArrowMaterial = new THREE.LineBasicMaterial({
      color: 0xe8f1ff,
      transparent: true,
      opacity: 0.9,
    });
    for (let i = 0; i < MAX_LIVE_OBSTACLES; i++) {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(PLAY_W / 2, PLAY_H, 1),
        new THREE.MeshBasicMaterial({
          color: 0xff1e3c,
          transparent: true,
          opacity: OBSTACLE_ALPHA,
          depthWrite: false,
          wireframe: false,
        }),
      );
      wall.visible = false;
      wall.add(new THREE.LineSegments(wallArrowGeometry, wallArrowMaterial));
      this.walls.push(wall);
      this.scene.add(wall);
    }
    this.mask.minFilter = THREE.LinearFilter;
    this.mask.magFilter = THREE.LinearFilter;
    const k = (SILHOUETTE_Z - CAM_POS.z) / -CAM_POS.z;
    this.silhouette = new THREE.Mesh(
      new THREE.PlaneGeometry(PLAY_W * k, PLAY_H * k),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          mask: { value: this.mask },
          color: { value: new THREE.Color(0x19f5ff) },
          pixel: { value: new THREE.Vector2(1 / MASK_W, 1 / MASK_H) },
        },
        vertexShader:
          'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader:
          'uniform sampler2D mask; uniform vec3 color; uniform vec2 pixel; varying vec2 vUv; void main(){vec2 uv=vec2(vUv.x,1.0-vUv.y);float m=texture2D(mask,uv).r;float edge=abs(m-texture2D(mask,uv+vec2(pixel.x*2.0,0.0)).r)+abs(m-texture2D(mask,uv+vec2(0.0,pixel.y*2.0)).r);float fill=smoothstep(.35,.65,m);gl_FragColor=vec4(color*(.25+edge*2.5),fill*.35+edge*.8);}',
      }),
    );
    this.silhouette.position.set(0, CAM_POS.y + (PLAY_CENTER_Y - CAM_POS.y) * k, SILHOUETTE_Z);
    this.silhouette.visible = false;
    this.scene.add(this.silhouette);
    const skeletonGeometry = new THREE.BufferGeometry();
    skeletonGeometry.setAttribute('position', new THREE.BufferAttribute(this.joints, 3));
    this.skeleton = new THREE.LineSegments(
      skeletonGeometry,
      new THREE.LineBasicMaterial({ color: 0x64eaff, transparent: true, opacity: 0.7, depthTest: false }),
    );
    this.skeleton.frustumCulled = false;
    this.skeleton.name = 'player_skeleton';
    this.skeleton.visible = false;
    this.scene.add(this.skeleton);
    this.headMarker.name = 'player_head_marker';
    this.headMarker.visible = false;
    this.scene.add(this.headMarker);
    for (const color of [HAND_TINT_LEFT, HAND_TINT_RIGHT]) {
      const hand = new THREE.Mesh(
        new THREE.TorusGeometry(0.12, 0.025, 8, 24),
        new THREE.MeshBasicMaterial({ color, depthTest: false }),
      );
      hand.visible = false;
      this.handMeshes.push(hand);
      this.scene.add(hand);
      const lineGeometry = new THREE.BufferGeometry();
      lineGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 3), 3));
      const line = new THREE.Line(
        lineGeometry,
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8, depthTest: false }),
      );
      line.frustumCulled = false;
      line.visible = false;
      this.handLines.push(line);
      this.scene.add(line);
    }
    this.unsubscribe.push(
      events.on('note:hit', (e) => this.impact(e)),
      events.on('highlight:capture', () => this.capture()),
      events.on('beam:fire', (event) => this.fireBeam(event)),
    );
    for (let hand = 0; hand < 2; hand++) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({ color: 0xffc32b, transparent: true, opacity: 1, depthTest: false }),
      );
      line.visible = false;
      line.frustumCulled = false;
      this.beamLines.push(line);
      this.scene.add(line);
    }
    this.scene.traverse((object) => {
      if (object instanceof THREE.AmbientLight || object instanceof THREE.DirectionalLight)
        object.layers.enable(1);
      else if (object !== this.scene && object !== this.pylons && object !== grid) object.layers.set(1);
    });
    void this.assets.load().then(() => {
      if (this.disposed) return;
      this.assetPending = true;
      if (this.mode !== 'play' && this.mode !== 'paused') this.applyAssets();
    });
    this.resize();
  }
  setStage(stage: HTMLElement | null): void {
    this.menuStage = stage;
  }
  setMode(mode: 'menu' | 'play' | 'paused' | 'results'): void {
    if (this.mode !== 'play' && this.mode !== 'paused' && this.assetPending) this.applyAssets();
    this.mode = mode;
    if (mode === 'results' || mode === 'paused') {
      for (const mesh of this.handMeshes) mesh.visible = false;
      for (const line of this.handLines) line.visible = false;
    }
    if (mode === 'results' && this.snapshotValid) {
      this.hasMask = this.savedHasMask;
      this.hasPose = this.savedHasPose;
      this.headPresent = this.savedHeadPresent;
      this.headMarker.position.set(this.savedHead.x, this.savedHead.y, this.savedHead.z);
      this.joints.set(this.savedJoints);
      this.maskData.set(this.savedMask);
      this.mask.needsUpdate = true;
      (this.skeleton.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
    if (mode === 'paused' && this.frozenPose) {
      this.hasPose = true;
      this.hasMask = this.frozenMaskPresent;
      this.headPresent = this.frozenHeadPresent;
      this.headMarker.position.set(this.frozenHead.x, this.frozenHead.y, this.frozenHead.z);
      this.joints.set(this.frozenJoints);
      this.maskData.set(this.frozenMask);
      this.mask.needsUpdate = true;
      (this.skeleton.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
  }
  setCalm(calm: boolean): void {
    this.calm = calm;
  }
  setMusicBands(bands: BandEnergies): void {
    if (this.mode === 'paused') return;
    for (const band of ['low', 'mid', 'high', 'rms'] as const)
      this.bands[band] = Number.isFinite(bands[band]) ? Math.max(0, Math.min(1, bands[band])) : 0;
  }
  get highlightTimeMs(): number | null {
    return this.snapshotAt;
  }
  get hasFrozenFigure(): boolean {
    return this.frozenPose;
  }
  get hasMaskFrame(): boolean {
    return this.hasMask;
  }
  resize(): void {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }
  tracking(frame: TrackingFrame, visible: boolean): void {
    if (this.mode === 'paused' || this.mode === 'results') return;
    this.visible = visible;
    this.hasPose = !!frame.pose;
    this.headPresent = !!frame.pose && frame.pose.landmarks[3]! >= 0.5;
    if (this.headPresent && frame.pose)
      this.headMarker.position.set(
        (frame.pose.landmarks[0]! - 0.5) * PLAY_W,
        PLAY_CENTER_Y + (0.5 - frame.pose.landmarks[1]!) * PLAY_H,
        -0.05,
      );
    this.hasMask =
      !!frame.pose &&
      !!frame.mask &&
      frame.mask.width === MASK_W &&
      frame.mask.height === MASK_H &&
      frame.mask.data.length === MASK_W * MASK_H;
    if (frame.mask && this.hasMask) {
      this.maskData.set(frame.mask.data);
      this.mask.needsUpdate = true;
    }
    if (frame.pose) {
      for (let i = 0; i < connections.length; i++) {
        const c = connections[i]!;
        const segmentVisible =
          frame.pose.landmarks[c[0] * 4 + 3]! >= 0.5 && frame.pose.landmarks[c[1] * 4 + 3]! >= 0.5;
        for (let j = 0; j < 2; j++) {
          const index = c[j]!;
          const dst = i * 6 + j * 3;
          const p = frame.pose.landmarks;
          this.joints[dst] = (p[index * 4]! - 0.5) * PLAY_W;
          this.joints[dst + 1] = PLAY_CENTER_Y + (0.5 - p[index * 4 + 1]!) * PLAY_H;
          this.joints[dst + 2] = -0.06;
          if (!segmentVisible) {
            this.joints[dst] = 0;
            this.joints[dst + 1] = -100;
          }
        }
      }
      const p = frame.pose.landmarks,
        at = connections.length * 6;
      if (this.headPresent && p[11 * 4 + 3]! >= 0.5 && p[12 * 4 + 3]! >= 0.5) {
        this.joints[at] = this.headMarker.position.x;
        this.joints[at + 1] = this.headMarker.position.y - SIL_HEAD_RADIUS_M;
        this.joints[at + 2] = -0.06;
        this.joints[at + 3] = ((p[11 * 4]! + p[12 * 4]!) / 2 - 0.5) * PLAY_W;
        this.joints[at + 4] = PLAY_CENTER_Y + (0.5 - (p[11 * 4 + 1]! + p[12 * 4 + 1]!) / 2) * PLAY_H;
        this.joints[at + 5] = -0.06;
      } else {
        this.joints[at] = this.joints[at + 3] = 0;
        this.joints[at + 1] = this.joints[at + 4] = -100;
        this.joints[at + 2] = this.joints[at + 5] = -0.06;
      }
      (this.skeleton.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
    if (visible && this.hasPose) {
      this.frozenJoints.set(this.joints);
      if (this.hasMask) this.frozenMask.set(this.maskData);
      this.frozenPose = true;
      this.frozenMaskPresent = this.hasMask;
      this.frozenHeadPresent = this.headPresent;
      Object.assign(this.frozenHead, this.headMarker.position);
    }
  }
  hideTracking(): void {
    this.visible = false;
    this.hasMask = false;
    this.hasPose = false;
    this.headPresent = false;
    this.headMarker.visible = false;
    for (const mesh of this.handMeshes) mesh.visible = false;
    for (const line of this.handLines) line.visible = false;
  }
  setFrozenTime(time: number): void {
    if (Number.isFinite(time)) this.currentTime = time;
  }
  hands(hands: readonly HandCursor[]): void {
    if (this.mode === 'paused' || this.mode === 'results') return;
    for (let i = 0; i < 2; i++) {
      const hand = hands[i];
      const mesh = this.handMeshes[i]!;
      const line = this.handLines[i]!;
      mesh.visible = !!hand?.present && this.visible;
      line.visible = !!hand?.present && this.visible && hand.gesture === 'open';
      if (!hand?.present) continue;
      mesh.position.set(hand.pos.x, hand.pos.y, 0.05);
      mesh.scale.setScalar(hand.gesture === 'fist' ? 0.6 : 1 + hand.charge * 0.4);
      (mesh.material as THREE.MeshBasicMaterial).color.set(
        hand.gesture === 'point'
          ? 0xffc32b
          : hand.gesture === 'fist'
            ? 0xff2bd6
            : i === 0
              ? HAND_TINT_LEFT
              : HAND_TINT_RIGHT,
      );
      const positions = line.geometry.attributes.position as THREE.BufferAttribute;
      const count = Math.min(24, hand.history.length);
      for (let j = 0; j < count; j++) {
        const p = hand.history[hand.history.length - count + j]!;
        positions.setXYZ(j, p.x, p.y, 0.04);
      }
      positions.needsUpdate = true;
      line.geometry.setDrawRange(0, count);
    }
  }
  draw(time: number, notes: readonly LiveNote[] = [], obstacles: readonly LiveObstacle[] = []): void {
    this.renderedNotes = notes;
    if (this.mode !== 'paused') this.currentTime = time;
    let count = 0,
      armorCount = 0,
      beamCount = 0,
      slashGlyphs = 0,
      smashGlyphs = 0,
      beamGlyphs = 0;
    const play = this.mode === 'play' || this.mode === 'paused';
    for (const edge of this.edges) edge.visible = false;
    for (const glyph of this.glyphs) glyph.visible = false;
    if (play)
      for (const live of notes) {
        if (!live.spawned || live.state !== 'live' || count >= MAX_LIVE_NOTES || live.pos.z > 4) continue;
        scratch.position.set(live.pos.x, live.pos.y, live.pos.z);
        scratch.rotation.set(0, 0, live.rotation);
        scratch.scale.setScalar(live.note.type === 'beam' ? 1.6 : 1);
        scratch.updateMatrix();
        this.blocks.setMatrixAt(count, scratch.matrix);
        tint.setHex(colors[live.note.type]);
        this.blocks.setColorAt(count, tint);
        const edge = this.edges[count]!;
        edge.visible = true;
        edge.position.copy(scratch.position);
        edge.rotation.copy(scratch.rotation);
        edge.scale.copy(scratch.scale);
        (edge.material as THREE.LineBasicMaterial).color.copy(tint);
        if (live.note.type === 'smash') {
          scratch.scale.setScalar(BLOCK_SIZE);
          scratch.updateMatrix();
          this.armor.setMatrixAt(armorCount++, scratch.matrix);
        }
        if (live.note.type === 'beam') {
          scratch.scale.setScalar(BLOCK_SIZE * 1.6);
          scratch.updateMatrix();
          this.beamRings.setMatrixAt(beamCount, scratch.matrix);
          beamAimTarget(live.note, aimTarget);
          scratch.position.set(aimTarget.x, aimTarget.y, 0.03);
          scratch.rotation.set(0, 0, 0);
          scratch.scale.setScalar(1);
          scratch.updateMatrix();
          this.reticles.setMatrixAt(beamCount++, scratch.matrix);
        }
        scratch.position.set(
          live.pos.x,
          live.pos.y,
          live.pos.z + GLYPH_FACE_OFFSET_M * (live.note.type === 'beam' ? 1.6 : 1),
        );
        scratch.rotation.set(0, 0, 0);
        scratch.scale.setScalar(BLOCK_SIZE * 0.72 * (live.note.type === 'beam' ? 1.6 : 1));
        scratch.updateMatrix();
        const glyphIndex =
          live.note.type === 'slash'
            ? slashGlyphs++
            : live.note.type === 'smash'
              ? smashGlyphs++
              : beamGlyphs++;
        this.glyphMeshes[live.note.type].setMatrixAt(glyphIndex, scratch.matrix);
        count++;
      }
    this.blocks.count = count;
    this.blocks.instanceMatrix.needsUpdate = true;
    if (this.blocks.instanceColor) this.blocks.instanceColor.needsUpdate = true;
    this.armor.count = armorCount;
    this.beamRings.count = beamCount;
    this.reticles.count = beamCount;
    this.glyphMeshes.slash.count = slashGlyphs;
    this.glyphMeshes.smash.count = smashGlyphs;
    this.glyphMeshes.beam.count = beamGlyphs;
    this.armor.instanceMatrix.needsUpdate = true;
    this.beamRings.instanceMatrix.needsUpdate = true;
    this.reticles.instanceMatrix.needsUpdate = true;
    this.glyphMeshes.slash.instanceMatrix.needsUpdate = true;
    this.glyphMeshes.smash.instanceMatrix.needsUpdate = true;
    this.glyphMeshes.beam.instanceMatrix.needsUpdate = true;
    for (const wall of this.walls) wall.visible = false;
    let wallCount = 0;
    if (play)
      for (const live of obstacles) {
        if (!live.spawned || live.state !== 'live' || wallCount >= this.walls.length || live.zBack > 4)
          continue;
        const wall = this.walls[wallCount++]!;
        wall.visible = true;
        wall.position.set(
          live.obstacle.kind === 'wallLeft' ? -PLAY_W / 4 : PLAY_W / 4,
          PLAY_CENTER_Y,
          (live.zFront + live.zBack) / 2,
        );
        wall.scale.z = Math.max(0.1, live.zFront - live.zBack);
        if (wall.children[0]) wall.children[0].scale.x = live.obstacle.kind === 'wallLeft' ? 1 : -1;
      }
    let fragments = 0;
    for (const effect of this.effects) {
      if (!effect.active) continue;
      const age = this.currentTime - effect.birth;
      if (age < 0 || age > effect.life) {
        effect.active = false;
        continue;
      }
      const t = age / 1000;
      scratch.position.set(
        effect.x + effect.vx * t,
        effect.y + effect.vy * t - 2 * t * t,
        effect.z + effect.vz * t,
      );
      scratch.rotation.set(effect.rotation * t, t, 0);
      scratch.scale.setScalar(effect.size * (1 - age / effect.life));
      scratch.updateMatrix();
      this.fragments.setMatrixAt(fragments, scratch.matrix);
      tint.setHex(effect.color);
      this.fragments.setColorAt(fragments, tint);
      fragments++;
    }
    this.fragments.count = fragments;
    this.fragments.visible = play;
    this.fragments.instanceMatrix.needsUpdate = true;
    if (this.fragments.instanceColor) this.fragments.instanceColor.needsUpdate = true;
    this.shatter.update(this.currentTime, play, this.calm);
    this.slices.update(this.currentTime, play, this.calm);
    for (let hand = 0; hand < 2; hand++) {
      const age = this.currentTime - this.beamBirth[hand]!;
      const line = this.beamLines[hand]!;
      line.visible = play && age >= 0 && age < BEAM_VISUAL_MS;
      (line.material as THREE.LineBasicMaterial).opacity = Math.max(0, 1 - age / BEAM_VISUAL_MS);
    }
    const bodyVisible =
      this.mode === 'results' ? this.snapshotValid : this.mode === 'paused' ? this.frozenPose : this.visible;
    this.silhouette.visible = bodyVisible && this.hasMask;
    this.skeleton.visible = bodyVisible && this.hasPose;
    this.headMarker.visible = bodyVisible && this.headPresent;
    for (const material of this.neonMaterials)
      material.emissiveIntensity = this.calm ? 0.4 : 0.4 + this.bands.low * ARENA_REACTIVE_GAIN;
    const rect = this.mode !== 'play' ? this.menuStage?.getBoundingClientRect() : null;
    this.camera.fov = CAM_FOV_DEG;
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, innerWidth, innerHeight);
    this.renderer.clear();
    if (rect) {
      this.camera.layers.set(0);
      this.renderer.render(this.scene, this.camera);
      this.renderer.clearDepth();
      const width = Math.max(1, rect.width),
        height = Math.max(1, rect.height);
      this.renderer.setViewport(rect.left, innerHeight - rect.bottom, width, height);
      this.renderer.setScissor(rect.left, innerHeight - rect.bottom, width, height);
      this.renderer.setScissorTest(true);
      this.camera.aspect = width / height;
      this.camera.fov = Math.max(
        CAM_FOV_DEG,
        (2 * Math.atan(PLAY_W / (2 * CAM_POS.z * this.camera.aspect)) * 180) / Math.PI,
      );
      this.camera.layers.set(1);
    } else {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.layers.enableAll();
    }
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    this.renderer.setScissorTest(false);
  }
  private impact(e: GameEvents['note:hit']): void {
    if (e.note.type === 'slash') {
      let live: LiveNote | null = null;
      for (const note of this.renderedNotes)
        if (note.note.id === e.note.id) {
          live = note;
          break;
        }
      this.slices.trigger(e, this.currentTime, live?.pos ?? e.impactPos, live?.rotation ?? 0);
      this.trimEffects(Math.max(0, MAX_FRAGMENTS - this.shatter.occupancy - this.slices.occupancy));
      return;
    }
    if (e.note.type === 'smash') this.shatter.trigger(e, this.currentTime);
    const count = e.note.type === 'smash' ? 4 : 6;
    for (let i = 0; i < count; i++) {
      const slot = this.effects[this.effectIndex++ % this.effects.length]!;
      const angle = (i / count) * Math.PI * 2 + e.note.id;
      const speed =
        SHATTER_BURST_MIN + ((SHATTER_BURST_MAX - SHATTER_BURST_MIN) * ((e.note.id * 17 + i * 13) % 31)) / 31;
      Object.assign(slot, {
        active: true,
        birth: this.currentTime,
        life: e.note.type === 'smash' ? FRAGMENT_LIFETIME_MS : POOF_LIFETIME_MS,
        x: e.impactPos.x,
        y: e.impactPos.y,
        z: e.impactPos.z,
        vx: Math.cos(angle) * speed,
        vy: this.calm ? 0 : Math.sin(angle) * speed,
        vz: 1,
        size: BLOCK_SIZE * 0.3,
        color: colors[e.note.type],
        rotation: this.calm ? 0 : angle,
      });
    }
    this.trimEffects(Math.max(0, MAX_FRAGMENTS - this.shatter.occupancy - this.slices.occupancy));
  }
  private trimEffects(capacity: number): void {
    let count = 0;
    for (const effect of this.effects) if (effect.active) count++;
    while (count > capacity) {
      let oldest: Effect | null = null;
      for (const effect of this.effects)
        if (effect.active && (!oldest || effect.birth < oldest.birth)) oldest = effect;
      if (!oldest) break;
      oldest.active = false;
      count--;
    }
  }
  private fireBeam(event: GameEvents['beam:fire']): void {
    const index = event.hand === 'left' ? 0 : 1,
      line = this.beamLines[index]!,
      positions = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    positions.setXYZ(0, event.from.x, event.from.y, event.from.z);
    positions.setXYZ(1, event.to.x, event.to.y, event.to.z);
    positions.needsUpdate = true;
    this.beamBirth[index] = this.currentTime;
  }
  private applyAssets(): void {
    if (!this.assetPending) return;
    this.assetPending = false;
    const assets = this.assets.assets;
    this.armor.geometry = assets.armor;
    this.beamRings.geometry = assets.beamRing;
    this.pylons.geometry = assets.pylon;
    for (const type of ['slash', 'smash', 'beam'] as const)
      this.glyphMeshes[type].geometry = assets.glyphs[type];
    this.shatter.configure(assets.shards);
    if (assets.environment && this.environment !== assets.environment) {
      this.environment = assets.environment;
      this.environment.traverse((object) => {
        object.layers.set(0);
        if (object instanceof THREE.Mesh)
          for (const material of Array.isArray(object.material) ? object.material : [object.material])
            if (material instanceof THREE.MeshStandardMaterial) {
              if (/rail|ring|strip|grid/.test(object.name)) {
                material.emissive.copy(material.color);
                material.emissiveIntensity = 0.4;
                if (!this.neonMaterials.includes(material)) this.neonMaterials.push(material);
              }
            }
      });
      this.scene.add(this.environment);
      this.pylons.visible = false;
    }
  }
  capture(): void {
    if (!this.visible || !this.hasPose) return;
    this.savedJoints.set(this.joints);
    this.savedMask.set(this.maskData);
    this.savedHasMask = this.hasMask;
    this.savedHasPose = this.hasPose;
    this.savedHeadPresent = this.headPresent;
    Object.assign(this.savedHead, this.headMarker.position);
    this.snapshotValid = true;
    this.snapshotAt = this.currentTime;
  }
  finish(_stats: SessionStats): void {
    if (!this.snapshotValid) this.capture();
  }
  reset(): void {
    for (const e of this.effects) e.active = false;
    this.snapshotValid = false;
    this.snapshotAt = null;
    this.frozenPose = false;
    this.headPresent = this.frozenHeadPresent = this.savedHeadPresent = false;
    this.headMarker.visible = false;
    this.effectIndex = 0;
    this.currentTime = 0;
    this.bands.low = this.bands.mid = this.bands.high = this.bands.rms = 0;
    this.shatter.reset();
    this.slices.reset();
    this.beamBirth[0] = this.beamBirth[1] = -Infinity;
  }
  dispose(): void {
    this.disposed = true;
    this.assets.stop();
    this.shatter.dispose();
    this.slices.dispose();
    this.renderedNotes = [];
    for (const off of this.unsubscribe) off();
    this.unsubscribe = [];
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.assets.collectDisposal(geometries, materials);
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
        geometries.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m);
        if (o instanceof THREE.InstancedMesh) o.dispose();
      }
    });
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    this.mask.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
