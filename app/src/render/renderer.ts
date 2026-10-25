/** Pooled lane renderer; camera imagery never enters this scene. */
import * as THREE from 'three';
import type { TrackingFrame, HandCursor, SessionStats, BandEnergies, Vec3 } from '../core/types';
import type { Note, NoteType } from '../beatmap/types';
import type { LiveNote, LiveObstacle } from '../game/liveObjects';
import type { GameEvents } from '../core/events';
import type { TypedEmitter } from '../utils/emitter';
import { AssetRegistry, crackedBody, fallbackShards } from './assets';
import { diamondFaces } from './slicer';
import type { ShardAsset } from './assets';
import { ShatterPool } from './shatter';
import { SlicePool } from './slices';
import { PoofPool } from './poof';
import { TerminalNoteVisuals } from './failures';
import { ArenaAtmosphere } from './environment';
import { HandTrails } from './trails';
import { SparkPool } from './sparks';
import { CameraRig } from './cameraRig';
import { PostFx, supportsHdrTargets } from './postfx';
import { resolveQuality } from './quality';
import {
  createGlyphMaterial,
  createShardMaterial,
  createShellMaterial,
  createTargetUniforms,
} from './blocks';
import type { ActiveQuality, QualityFeature, QualityTier } from './quality';
import { beamAimTarget } from '../game/hit';
import { AVATAR_LAYER, AvatarFigure, loadAvatarAsset } from './avatar';
import type { AvatarSnapshot } from './avatar';
import {
  BG_COLOR,
  BLOCK_SIZE,
  CAM_FOV_DEG,
  CAM_LOOK_AT,
  CAM_POS,
  FOG_DENSITY,
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
  HALF_LIFETIME_MS,
  SHATTER_BURST_MIN,
  SHATTER_BURST_MAX,
  SHATTER_RECEDE_MPS,
  OBSTACLE_ALPHA,
  BEAM_VISUAL_MS,
  GLYPH_FACE_OFFSET_M,
  MAX_LIVE_OBSTACLES,
  PYLON_SPACING_M,
  PYLON_X,
  BEAM_AIM_RADIUS,
  SIL_HEAD_RADIUS_M,
  APPROACH_MS,
  BADCUT_TINT,
  DESPAWN_Z,
  LANE_X,
  LANE_Y,
  BEAM_HOVER_Y_OFFSET,
  BEAM_HOVER_Z,
  QUALITY_TIER_PRESETS,
  CONTRAST_MASK_THRESHOLD,
  CONTRAST_EDGE_GAIN,
  SIL_MASK_LOW,
  SIL_MASK_HIGH,
  SIL_JOINT_RADIUS_M,
  BLOCK_CORE_SPIN_RAD_S,
  CAM_FAR_M,
  HIT_SPARKS,
  POOF_SPARKS,
  TRAUMA_BADCUT,
  TRAUMA_DROP,
  TRAUMA_HIT,
  TRAUMA_KICK,
  TRAUMA_OBSTACLE,
  TRAUMA_PERFECT,
  SLASH_SLAB_DEPTH,
  SMASH_CRACK_SCALE,
  BEAM_ORB_RADIUS,
  GLYPH_PROUD_M,
  TARGET_GLYPH_SCALE,
  SPAWN_DISTANCE,
  AVATAR_TIER_FIGURE,
} from '../core/constants';
const colors = { slash: 0x19f5ff, smash: 0xff2bd6, beam: 0xffc32b };
/** Armour plate debris tint (dark magenta metal), distinct from the glowing shard cross-sections. */
const ARMOR_PLATE_DEBRIS_COLOR = 0x5a2050;
const scratch = new THREE.Object3D();
const tint = new THREE.Color();
const failureTint = new THREE.Color(BADCUT_TINT);
const aimTarget = { x: 0, y: 0, z: 0 };
const beamCenter = { x: 0, y: 0, z: 0 };
const BAND_KEYS = ['low', 'mid', 'high', 'rms'] as const;
const EMPTY_NOTES: readonly LiveNote[] = Object.freeze([]),
  EMPTY_OBSTACLES: readonly LiveObstacle[] = Object.freeze([]);
const JOINT_IDS = [11, 12, 13, 14, 15, 16, 23, 24] as const;
const IMPLEMENTED_QUALITY: readonly QualityFeature[] = Object.freeze([
  'render-scale',
  'skeleton',
  'fragments',
  'smash-geometry',
  'poof-sparks',
  'pylons',
  'grid',
  'dust',
]);
/** Implemented only through the HDR composer; absent when half-float targets are unavailable. */
const POST_QUALITY: readonly QualityFeature[] = Object.freeze([
  ...IMPLEMENTED_QUALITY,
  'bloom',
  'smaa',
  'fxaa',
]);
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
export type AvatarStatus = 'loading' | 'ready' | 'failed' | 'disabled';
export interface ArenaRendererOptions {
  readonly tier?: QualityTier;
  readonly contrast?: boolean;
}
export class ArenaRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly contrast: boolean;
  private readonly requestedTier: QualityTier;
  private activeQuality: ActiveQuality;
  private readonly lowShards: readonly ShardAsset[] | null;
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
  private readonly targetUniforms = createTargetUniforms();
  /**
   * Three silhouettes, one per gesture (1 m authored, scaled by BLOCK_SIZE): a bladed Slash slab, a
   * cracked Smash cube assembled from the very shards it shatters into, and a floating Beam orb.
   */
  private smashBodyGeometry = crackedBody(this.assets.assets.shards, SMASH_CRACK_SCALE);
  private readonly bodies: Record<NoteType, THREE.InstancedMesh> = {
    slash: new THREE.InstancedMesh(
      this.assets.assets.slashBody,
      createShellMaterial(this.targetUniforms),
      MAX_LIVE_NOTES,
    ),
    smash: new THREE.InstancedMesh(
      this.smashBodyGeometry,
      createShardMaterial(this.targetUniforms),
      MAX_LIVE_NOTES,
    ),
    beam: new THREE.InstancedMesh(
      this.assets.assets.beamBody,
      createShellMaterial(this.targetUniforms, true),
      MAX_LIVE_NOTES,
    ),
  };
  // Linear HDR gold so the ring trims reach the bloom threshold.
  private readonly ringMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(0xffc32b).multiplyScalar(1.6),
  });
  private readonly glyphMaterial = createGlyphMaterial(this.targetUniforms);
  private readonly arrows = new THREE.InstancedMesh(
    this.assets.assets.glyphArrow,
    this.glyphMaterial,
    MAX_LIVE_NOTES,
  );
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
  private readonly coloredTargets = [
    this.armor,
    this.beamRings,
    this.bodies.slash,
    this.bodies.smash,
    this.bodies.beam,
    this.arrows,
    this.glyphMeshes.slash,
    this.glyphMeshes.smash,
    this.glyphMeshes.beam,
  ];
  /** Floor grid, horizon glow, dust and band-reactive authored neon (layer 0, menu background). */
  private readonly atmosphere = new ArenaAtmosphere(QUALITY_TIER_PRESETS.medium);
  private readonly pylons = new THREE.InstancedMesh(
    this.assets.assets.pylon,
    this.atmosphere.pylonMaterial,
    QUALITY_TIER_PRESETS.high.pylons,
  );
  private lastDrawAt: number | null = null;
  private hdr = false;
  private previewSerial = 0;
  /** Blade ribbons and hand particles (docs12); fed the latest measured cursors. */
  private readonly trails = new HandTrails(QUALITY_TIER_PRESETS.medium);
  private latestHands: readonly HandCursor[] = [];
  private readonly sparks = new SparkPool();
  private pointPixels = 1;
  private readonly rig = new CameraRig();
  private post: PostFx | null = null;
  private readonly shatter: ShatterPool;
  private readonly slices: SlicePool;
  private readonly poofs: PoofPool;
  private readonly failures = new TerminalNoteVisuals();
  private readonly targetCounts = {
    blocks: 0,
    armor: 0,
    rings: 0,
    reticles: 0,
    arrows: 0,
    slash: 0,
    smash: 0,
    beam: 0,
  };
  private renderedNotes: readonly LiveNote[] = [];
  private environment: THREE.Group | null = null;
  private readonly beamLines: THREE.Line[] = [];
  private readonly beamBirth = [-Infinity, -Infinity];
  private readonly camera = new THREE.PerspectiveCamera(CAM_FOV_DEG, 16 / 9, 0.05, CAM_FAR_M);
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
  private readonly walls: THREE.Mesh[] = [];
  private readonly maskData = new Uint8Array(MASK_W * MASK_H);
  private readonly mask = new THREE.DataTexture(this.maskData, MASK_W, MASK_H, THREE.RedFormat);
  private readonly silhouette: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private readonly joints = new Float32Array((connections.length + 1) * 6);
  private readonly skeleton: THREE.LineSegments;
  private readonly jointMarkers = new THREE.InstancedMesh(
    new THREE.SphereGeometry(SIL_JOINT_RADIUS_M, 12, 8),
    new THREE.MeshBasicMaterial({ color: 0x64eaff, transparent: true, opacity: 0.8, depthTest: false }),
    JOINT_IDS.length,
  );
  private readonly jointPositions = new Float32Array(JOINT_IDS.length * 3);
  private readonly savedJointPositions = new Float32Array(JOINT_IDS.length * 3);
  private readonly frozenJointPositions = new Float32Array(JOINT_IDS.length * 3);
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
  private approachMs: number = APPROACH_MS.normal;
  private unsubscribe: (() => void)[] = [];
  private menuStage: HTMLElement | null = null;
  private mode: 'menu' | 'play' | 'paused' | 'results' = 'menu';
  private calm = false;
  // --- Rigged avatar figure (docs/10 §11): presentation only; the line skeleton is its fallback. ---
  private avatar: AvatarFigure | null = null;
  private avatarState: AvatarStatus = 'loading';
  private avatarError: string | null = null;
  private readonly avatarListeners = new Set<() => void>();
  private readonly avatarAbort = new AbortController();
  private avatarFrozen: AvatarSnapshot | null = null;
  private avatarSaved: AvatarSnapshot | null = null;
  private avatarPlaceholder = false;
  private avatarShown = false;
  private avatarClock = 0;
  private avatarOrderedChildren = -1;
  constructor(container: HTMLElement, events: TypedEmitter<GameEvents>, options: ArenaRendererOptions = {}) {
    this.requestedTier = options.tier ?? 'medium';
    this.contrast = options.contrast ?? false;
    this.activeQuality = this.resolveQuality();
    this.lowShards =
      this.activeQuality.preset.smashGeometry === 'complete-eight-octant-fallback' ? fallbackShards() : null;
    for (const shard of this.lowShards ?? []) this.assets.ownedGeometries.add(shard.geometry);
    this.renderer = new THREE.WebGLRenderer({
      // Requested SMAA/FXAA are not implemented yet; report them as unsupported, never as MSAA.
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(this.activeQuality.pixelRatio);
    this.renderer.autoClear = false;
    this.renderer.setClearColor(BG_COLOR);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    // Direct (non-composer) draws to the screen still tone map; composer passes render to HDR targets.
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.hdr = supportsHdrTargets(this.renderer);
    this.activeQuality = this.resolveQuality();
    if (this.activeQuality.bloomEnabled)
      this.post = new PostFx(this.renderer, this.scene, this.camera, this.activeQuality);
    container.append(this.renderer.domElement);
    this.camera.position.set(CAM_POS.x, CAM_POS.y, CAM_POS.z);
    this.camera.lookAt(CAM_LOOK_AT.x, CAM_LOOK_AT.y, CAM_LOOK_AT.z);
    this.scene.fog = new THREE.FogExp2(BG_COLOR, FOG_DENSITY);
    this.scene.add(new THREE.AmbientLight(0xc3ddff, 2));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(2, 6, 3);
    this.scene.add(light);
    this.scene.add(
      this.armor,
      this.beamRings,
      this.reticles,
      this.pylons,
      ...Object.values(this.bodies),
      this.arrows,
      ...Object.values(this.glyphMeshes),
    );
    for (const mesh of [
      this.armor,
      this.beamRings,
      this.reticles,
      ...Object.values(this.bodies),
      this.arrows,
      ...Object.values(this.glyphMeshes),
    ]) {
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
    }
    this.pylons.frustumCulled = false;
    this.pylons.name = 'supplemental_pylons';
    this.configurePylons();
    this.shatter = new ShatterPool(
      this.scene,
      this.lowShards ?? this.assets.assets.shards,
      this.activeQuality.fragmentLifetimeMs,
      createShardMaterial(this.targetUniforms),
    );
    this.slices = new SlicePool(
      this.scene,
      HALF_LIFETIME_MS * this.activeQuality.preset.fragmentLifetimeScale,
      // Halves are cut from the Slash target's own rhombic prism (half-depth in half-extent units).
      diamondFaces(SLASH_SLAB_DEPTH),
    );
    this.poofs = new PoofPool(this.scene, this.activeQuality.preset.poofSparks);
    this.scene.add(this.sparks.points);
    if (this.lowShards) this.rebuildSmashBody(this.lowShards);
    this.fragments.frustumCulled = false;
    this.fragments.name = 'debris_fragments';
    this.fragments.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.fragments);
    // Warm optional instance-color attributes before any terminal event needs them.
    tint.setHex(0xffffff);
    for (const mesh of this.coloredTargets) mesh.setColorAt(0, tint);
    this.armor.name = 'target_armor';
    this.beamRings.name = 'target_rings';
    this.reticles.name = 'target_reticles';
    for (const type of ['slash', 'smash', 'beam'] as const) this.bodies[type].name = `target_body_${type}`;
    this.arrows.name = 'target_glyph_arrow';
    for (const type of ['slash', 'smash', 'beam'] as const)
      this.glyphMeshes[type].name = `target_glyph_${type}`;
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
          threshold: { value: this.contrast ? CONTRAST_MASK_THRESHOLD : (SIL_MASK_LOW + SIL_MASK_HIGH) / 2 },
          thresholdRange: { value: (SIL_MASK_HIGH - SIL_MASK_LOW) / 2 },
          edgeGain: { value: this.contrast ? CONTRAST_EDGE_GAIN : 1 },
        },
        vertexShader:
          'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
        fragmentShader:
          'uniform sampler2D mask; uniform vec3 color; uniform vec2 pixel; uniform float threshold; uniform float thresholdRange; uniform float edgeGain; varying vec2 vUv; void main(){vec2 uv=vec2(vUv.x,1.0-vUv.y);float m=texture2D(mask,uv).r;float edge=(abs(m-texture2D(mask,uv+vec2(pixel.x*2.0,0.0)).r)+abs(m-texture2D(mask,uv+vec2(0.0,pixel.y*2.0)).r))*edgeGain;float fill=smoothstep(threshold-thresholdRange,threshold+thresholdRange,m);gl_FragColor=vec4(color*(.25+edge*2.5),fill*.35+edge*.8);}',
      }),
    );
    this.silhouette.position.set(0, CAM_POS.y + (PLAY_CENTER_Y - CAM_POS.y) * k, SILHOUETTE_Z);
    this.silhouette.visible = false;
    this.silhouette.name = 'player_silhouette';
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
    this.jointMarkers.name = 'player_joint_markers';
    this.jointMarkers.count = 0;
    this.jointMarkers.visible = false;
    this.jointMarkers.frustumCulled = false;
    this.jointMarkers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.jointMarkers);
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
      events.on('note:hit', (e) =>
        this.rig.addTrauma(e.judgement === 'perfect' ? TRAUMA_PERFECT : TRAUMA_HIT),
      ),
      events.on('note:badcut', () => this.rig.addTrauma(TRAUMA_BADCUT)),
      events.on('obstacle:hit', () => this.rig.addTrauma(TRAUMA_OBSTACLE)),
      events.on('music:event', (e) => {
        if (e.kind === 'kick') this.rig.addTrauma(TRAUMA_KICK * e.intensity);
        else if (e.kind === 'drop') this.rig.addTrauma(TRAUMA_DROP * e.intensity);
      }),
      events.on('note:miss', (e) => this.failures.resolve(e.note, 'miss', this.currentTime)),
      events.on('note:badcut', (e) => this.failures.resolve(e.note, 'badcut', this.currentTime)),
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
      if (object instanceof THREE.AmbientLight || object instanceof THREE.DirectionalLight) {
        object.layers.enable(1);
        object.layers.enable(AVATAR_LAYER);
      } else if (object !== this.scene && object !== this.pylons) object.layers.set(1);
    });
    this.atmosphere.applyPreset(this.activeQuality.preset);
    this.scene.add(this.atmosphere.group);
    this.trails.applyPreset(this.activeQuality.preset);
    // Same layer as the hand cursors so menu-stage and play projections agree.
    this.trails.group.traverse((object) => object.layers.set(1));
    this.scene.add(this.trails.group);
    this.loadAvatar();
    this.unsubscribe.push(
      events.on('music:event', (event) => {
        if (event.kind === 'kick') this.avatar?.kick(performance.now());
      }),
    );
    void this.assets.load().then(() => {
      if (this.disposed) return;
      this.assetPending = true;
      if (this.mode !== 'play' && this.mode !== 'paused') this.applyAssets();
    });
    this.resize();
    // Development-only visual QA harness; the branch and its dynamic import are removed from production.
    if (import.meta.env.DEV && typeof window !== 'undefined')
      void import('./devFx').then((module) => module.installDevFx(this));
  }
  setStage(stage: HTMLElement | null): void {
    this.menuStage = stage;
  }
  private loadAvatar(): void {
    if (AVATAR_TIER_FIGURE[this.activeQuality.tier] !== 'avatar') {
      this.avatarState = 'disabled';
      return;
    }
    loadAvatarAsset(this.avatarAbort.signal).then(
      (asset) => {
        if (this.disposed) return;
        this.avatar = new AvatarFigure(asset);
        this.scene.add(this.avatar.root);
        this.setAvatarStatus('ready', null);
      },
      (error: unknown) => {
        if (!this.disposed)
          this.setAvatarStatus('failed', error instanceof Error ? error.message : String(error));
      },
    );
  }
  private setAvatarStatus(status: AvatarStatus, error: string | null): void {
    this.avatarState = status;
    this.avatarError = error;
    for (const listener of this.avatarListeners) listener();
  }
  /** 'ready' once the skinned avatar is in the scene; 'failed'/'disabled' keep the line skeleton and SVG. */
  get avatarStatus(): AvatarStatus {
    return this.avatarState;
  }
  get avatarLoadError(): string | null {
    return this.avatarError;
  }
  subscribeAvatar(listener: () => void): () => void {
    this.avatarListeners.add(listener);
    return () => this.avatarListeners.delete(listener);
  }
  /** The loaded avatar (e.g. for a performer to switch variant or pose from joints), or null. */
  get avatarFigure(): AvatarFigure | null {
    return this.avatar;
  }
  /** The menu stage is showing the illustrative placeholder (no live/saved/frozen figure). */
  setFigurePlaceholder(placeholder: boolean): void {
    this.avatarPlaceholder = placeholder;
  }
  setMode(mode: 'menu' | 'play' | 'paused' | 'results'): void {
    if (this.mode !== 'play' && this.mode !== 'paused' && this.assetPending) this.applyAssets();
    this.mode = mode;
    if (mode === 'results') this.trails.hide();
    if (mode === 'results' || mode === 'paused') {
      for (const mesh of this.handMeshes) mesh.visible = false;
      for (const line of this.handLines) line.visible = false;
    }
    if (mode === 'results' && this.snapshotValid && this.avatarSaved) this.avatar?.restore(this.avatarSaved);
    if (mode === 'paused' && this.frozenPose && this.avatarFrozen) this.avatar?.restore(this.avatarFrozen);
    if (mode === 'results' && this.snapshotValid) {
      this.hasMask = this.savedHasMask;
      this.hasPose = this.savedHasPose;
      this.headPresent = this.savedHeadPresent;
      this.headMarker.position.set(this.savedHead.x, this.savedHead.y, this.savedHead.z);
      this.joints.set(this.savedJoints);
      this.jointPositions.set(this.savedJointPositions);
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
      this.jointPositions.set(this.frozenJointPositions);
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
    for (const band of BAND_KEYS)
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
  get quality(): ActiveQuality {
    return this.activeQuality;
  }
  private resolveQuality(): ActiveQuality {
    return resolveQuality(this.requestedTier, {
      viewportHeightCss: innerHeight,
      devicePixelRatio,
      // Describes the constructed pipeline (half-float composer when renderable), not a GPU benchmark.
      hdrSupported: this.hdr,
      implemented: this.hdr ? POST_QUALITY : IMPLEMENTED_QUALITY,
    });
  }
  resize(): void {
    this.activeQuality = this.resolveQuality();
    this.renderer.setPixelRatio(this.activeQuality.pixelRatio);
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.atmosphere.applyPreset(this.activeQuality.preset);
    this.atmosphere.setViewport(innerHeight * this.activeQuality.pixelRatio, CAM_FOV_DEG);
    this.trails.applyPreset(this.activeQuality.preset);
    this.trails.setViewport(innerHeight * this.activeQuality.pixelRatio, CAM_FOV_DEG);
    this.pointPixels =
      (innerHeight * this.activeQuality.pixelRatio) / (2 * Math.tan((CAM_FOV_DEG * Math.PI) / 360));
    this.post?.configure(this.activeQuality);
    this.post?.setSize(innerWidth, innerHeight);
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
      for (let i = 0; i < JOINT_IDS.length; i++) {
        const source = JOINT_IDS[i]! * 4,
          at = i * 3,
          p = frame.pose.landmarks;
        this.jointPositions[at] = (p[source]! - 0.5) * PLAY_W;
        this.jointPositions[at + 1] =
          p[source + 3]! >= 0.5 ? PLAY_CENTER_Y + (0.5 - p[source + 1]!) * PLAY_H : -100;
        this.jointPositions[at + 2] = -0.06;
      }
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
    if (this.avatar) {
      if (visible && frame.pose) this.avatar.track(frame);
      else this.avatar.clearTracking();
    }
    if (visible && this.hasPose) {
      this.frozenJoints.set(this.joints);
      this.frozenJointPositions.set(this.jointPositions);
      if (this.hasMask) this.frozenMask.set(this.maskData);
      this.frozenPose = true;
      this.frozenMaskPresent = this.hasMask;
      this.frozenHeadPresent = this.headPresent;
      Object.assign(this.frozenHead, this.headMarker.position);
    }
  }
  hideTracking(): void {
    this.avatar?.clearTracking();
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
  setApproachMs(approachMs: number): void {
    if (!Number.isFinite(approachMs) || approachMs <= 0) throw new RangeError('Invalid chart approach time.');
    this.approachMs = approachMs;
  }
  hands(hands: readonly HandCursor[]): void {
    if (this.mode === 'paused' || this.mode === 'results') return;
    this.latestHands = hands;
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
  draw(
    time: number,
    notes: readonly LiveNote[] = EMPTY_NOTES,
    obstacles: readonly LiveObstacle[] = EMPTY_OBSTACLES,
  ): void {
    this.renderedNotes = notes;
    if (this.mode !== 'paused') this.currentTime = time;
    this.failures.prepare(notes);
    const counts = this.targetCounts;
    counts.blocks =
      counts.armor =
      counts.rings =
      counts.reticles =
      counts.arrows =
      counts.slash =
      counts.smash =
      counts.beam =
        0;
    const play = this.mode === 'play' || this.mode === 'paused';
    this.targetUniforms.uTime.value = this.currentTime / 1000;
    this.targetUniforms.uPulse.value = this.calm ? 0 : this.bands.low;
    this.targetUniforms.uSpin.value = this.calm ? 0 : BLOCK_CORE_SPIN_RAD_S;
    if (play) {
      // Required unresolved cues keep priority over optional terminal follow-through at capacity.
      for (const live of notes) {
        if (!live.spawned || live.state !== 'live' || live.pos.z >= DESPAWN_Z) continue;
        this.drawTarget(live.note, live.pos, live.rotation, 1, 0, true);
      }
      for (let index = 0; index < notes.length; index++) {
        const live = notes[index]!;
        const target = this.failures.sample(index, this.currentTime, this.approachMs, this.calm);
        if (target)
          this.drawTarget(
            live.note,
            target.position,
            target.rotation,
            target.brightness,
            target.redMix,
            false,
          );
      }
    }
    for (const type of ['slash', 'smash', 'beam'] as const) {
      const body = this.bodies[type];
      body.count = counts[type];
      body.instanceMatrix.needsUpdate = true;
    }
    this.arrows.count = counts.arrows;
    this.arrows.instanceMatrix.needsUpdate = true;
    this.armor.count = counts.armor;
    this.beamRings.count = counts.rings;
    this.reticles.count = counts.reticles;
    this.glyphMeshes.slash.count = counts.slash;
    this.glyphMeshes.smash.count = counts.smash;
    this.glyphMeshes.beam.count = counts.beam;
    this.armor.instanceMatrix.needsUpdate = true;
    this.beamRings.instanceMatrix.needsUpdate = true;
    this.reticles.instanceMatrix.needsUpdate = true;
    this.glyphMeshes.slash.instanceMatrix.needsUpdate = true;
    this.glyphMeshes.smash.instanceMatrix.needsUpdate = true;
    this.glyphMeshes.beam.instanceMatrix.needsUpdate = true;
    for (const mesh of this.coloredTargets) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
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
    this.poofs.update(this.currentTime, play, this.calm);
    // Tier spark count follows the poof preset; Calm halves the spray instead of flashing it.
    this.sparks.update(
      this.currentTime,
      play,
      Math.round((HIT_SPARKS * this.activeQuality.preset.poofSparks) / POOF_SPARKS / (this.calm ? 2 : 1)),
      this.pointPixels,
    );
    for (let hand = 0; hand < 2; hand++) {
      const age = this.currentTime - this.beamBirth[hand]!;
      const line = this.beamLines[hand]!;
      line.visible = play && age >= 0 && age < BEAM_VISUAL_MS;
      (line.material as THREE.LineBasicMaterial).opacity = Math.max(0, 1 - age / BEAM_VISUAL_MS);
    }
    const bodyVisible =
      this.mode === 'results' ? this.snapshotValid : this.mode === 'paused' ? this.frozenPose : this.visible;
    const avatarShown = this.drawAvatar(bodyVisible && this.hasPose);
    this.silhouette.visible = !avatarShown && bodyVisible && this.hasMask;
    this.skeleton.visible =
      !avatarShown &&
      bodyVisible &&
      this.hasPose &&
      this.activeQuality.preset.skeleton === 'joints-and-bones';
    this.drawJoints(!avatarShown && bodyVisible && this.hasPose);
    this.headMarker.visible = !avatarShown && bodyVisible && this.headPresent;
    const now = performance.now(),
      frameMs = this.lastDrawAt === null ? 0 : now - this.lastDrawAt;
    this.lastDrawAt = now;
    if (this.mode !== 'paused')
      this.atmosphere.update(
        frameMs,
        this.bands,
        this.calm,
        this.mode === 'play' ? (SPAWN_DISTANCE / this.approachMs) * 1000 : 0,
      );
    if (this.mode !== 'paused')
      this.trails.update(
        this.latestHands,
        this.mode !== 'results' && this.visible,
        frameMs,
        this.bands,
        this.calm,
        this.camera.position,
      );
    const rect = this.mode !== 'play' ? this.menuStage?.getBoundingClientRect() : null;
    // Gameplay-only camera response around the fixed base pose (menus, pause, results and Calm stay still).
    this.rig.update(frameMs, this.mode === 'play', this.calm, this.atmosphere.response.low);
    this.camera.position.set(CAM_POS.x, CAM_POS.y, CAM_POS.z).add(this.rig.offset);
    this.camera.lookAt(CAM_LOOK_AT.x, CAM_LOOK_AT.y, CAM_LOOK_AT.z);
    if (this.rig.roll) this.camera.rotateZ(this.rig.roll);
    this.camera.fov = CAM_FOV_DEG + (rect ? 0 : this.rig.fovDelta);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, innerWidth, innerHeight);
    this.renderer.clear();
    if (this.post) {
      // Composer owns the full-screen pass (all layers in play, environment layer 0 in menus).
      if (rect) this.camera.layers.set(0);
      else this.camera.layers.enableAll();
      this.post.render(frameMs / 1000, this.calm ? 0 : this.atmosphere.response.low);
      if (!rect) return;
    }
    if (rect) {
      if (!this.post) {
        this.camera.layers.set(0);
        this.renderer.render(this.scene, this.camera);
      }
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
      this.camera.layers.enable(AVATAR_LAYER);
    } else {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.layers.enableAll();
    }
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    this.renderer.setScissorTest(false);
  }
  /** Pose the avatar for the current state; returns whether it is visible this frame. */
  private drawAvatar(trackedBody: boolean): boolean {
    const avatar = this.avatar;
    if (!avatar) return false;
    const now = performance.now(),
      dt = this.avatarClock ? Math.min(100, Math.max(0, now - this.avatarClock)) : 0;
    this.avatarClock = now;
    avatar.setAudio(0.6 * this.bands.low + 0.4 * this.bands.rms, now, this.calm);
    // Backdrop ordering: arena (layer 0 only) → avatar → depth clear → gameplay.
    if (this.scene.children.length !== this.avatarOrderedChildren) {
      this.avatarOrderedChildren = this.scene.children.length;
      this.scene.traverse((object) => {
        if (object.layers.mask === 1) object.renderOrder = Math.min(object.renderOrder, -200);
      });
    }
    let shown = false;
    if (this.mode === 'paused') shown = this.frozenPose && !!this.avatarFrozen?.valid;
    else if (this.mode === 'results') shown = this.snapshotValid && !!this.avatarSaved?.valid;
    else if (trackedBody && avatar.updateTracked(now, dt)) {
      shown = true;
      this.avatarFrozen = avatar.snapshot(this.avatarFrozen ?? undefined);
    }
    if (!shown && this.mode !== 'play' && this.avatarPlaceholder) {
      // Illustrative idle (static in Calm); never a tracked figure.
      avatar.updateIdle(this.calm ? 0 : now / 1000, now, this.calm ? 0 : dt);
      shown = true;
    }
    avatar.root.visible = shown;
    this.avatarShown = shown;
    return shown;
  }
  /** Whether the skinned avatar (not the line skeleton) is the visible figure this frame. */
  get avatarVisible(): boolean {
    return this.avatarShown;
  }
  private drawJoints(visible: boolean): void {
    this.jointMarkers.visible = visible;
    if (!visible) return;
    let count = 0;
    for (let i = 0; i < JOINT_IDS.length; i++) {
      const at = i * 3;
      if (this.jointPositions[at + 1] === -100) continue;
      scratch.position.set(
        this.jointPositions[at]!,
        this.jointPositions[at + 1]!,
        this.jointPositions[at + 2]!,
      );
      scratch.rotation.set(0, 0, 0);
      scratch.scale.setScalar(1);
      scratch.updateMatrix();
      this.jointMarkers.setMatrixAt(count++, scratch.matrix);
    }
    this.jointMarkers.count = count;
    this.jointMarkers.instanceMatrix.needsUpdate = true;
  }
  private configurePylons(): void {
    const requested = this.activeQuality.preset.pylons;
    let authored = 0;
    this.environment?.traverse((object) => {
      if (/^arena_pylon_(left|right)_\d+$/.test(object.name)) object.visible = authored++ < requested;
    });
    const retained = Math.min(authored, requested),
      count = requested - retained;
    for (let i = 0; i < count; i++) {
      const index = retained + i;
      scratch.position.set(index % 2 === 0 ? -PYLON_X : PYLON_X, 0, -Math.floor(index / 2) * PYLON_SPACING_M);
      scratch.rotation.set(0, 0, 0);
      scratch.scale.setScalar(1);
      scratch.updateMatrix();
      this.pylons.setMatrixAt(i, scratch.matrix);
    }
    this.pylons.count = count;
    this.pylons.visible = count > 0;
    this.pylons.instanceMatrix.needsUpdate = true;
  }
  private drawTarget(
    note: Note,
    position: Vec3,
    rotation: number,
    brightness: number,
    redMix: number,
    showReticle: boolean,
  ): void {
    const counts = this.targetCounts;
    if (counts.blocks >= MAX_LIVE_NOTES) return;
    const scale = note.type === 'beam' ? 1.6 : 1,
      body = this.bodies[note.type],
      index = counts[note.type]++;
    counts.blocks++;
    scratch.position.set(position.x, position.y, position.z);
    scratch.rotation.set(0, 0, rotation);
    scratch.scale.setScalar(BLOCK_SIZE * scale);
    scratch.updateMatrix();
    body.setMatrixAt(index, scratch.matrix);
    tint.setHex(colors[note.type]).lerp(failureTint, redMix).multiplyScalar(brightness);
    body.setColorAt(index, tint);
    tint.setHex(0xffffff).lerp(failureTint, redMix).multiplyScalar(brightness);
    if (note.type === 'smash') {
      scratch.scale.setScalar(BLOCK_SIZE);
      scratch.updateMatrix();
      this.armor.setMatrixAt(counts.armor, scratch.matrix);
      this.armor.setColorAt(counts.armor++, tint);
    }
    if (note.type === 'beam') {
      scratch.scale.setScalar(BLOCK_SIZE * scale);
      scratch.updateMatrix();
      this.beamRings.setMatrixAt(counts.rings, scratch.matrix);
      this.beamRings.setColorAt(counts.rings++, tint);
      if (showReticle) {
        beamAimTarget(note, aimTarget);
        scratch.position.set(aimTarget.x, aimTarget.y, 0.03);
        scratch.rotation.set(0, 0, 0);
        scratch.scale.setScalar(1);
        scratch.updateMatrix();
        this.reticles.setMatrixAt(counts.reticles++, scratch.matrix);
      }
    }
    const directional = note.type === 'slash' && note.dir !== 'any',
      // Glyphs sit just proud of each silhouette's front: slab face, cube face or orb surface.
      face =
        note.type === 'slash'
          ? (SLASH_SLAB_DEPTH / 2) * BLOCK_SIZE + GLYPH_PROUD_M
          : note.type === 'beam'
            ? BEAM_ORB_RADIUS * BLOCK_SIZE * scale + GLYPH_PROUD_M
            : GLYPH_FACE_OFFSET_M;
    scratch.position.set(position.x, position.y, position.z + face);
    scratch.rotation.set(0, 0, 0);
    scratch.scale.setScalar(BLOCK_SIZE * TARGET_GLYPH_SCALE[note.type] * (directional ? 0.8 : 1) * scale);
    scratch.updateMatrix();
    const glyph = this.glyphMeshes[note.type];
    glyph.setMatrixAt(index, scratch.matrix);
    glyph.setColorAt(index, tint);
    if (directional) {
      // The chevron sits between the palm and the trim on the side the cut must travel toward.
      const angle =
          note.dir === 'up'
            ? 0
            : note.dir === 'down'
              ? Math.PI
              : note.dir === 'left'
                ? Math.PI / 2
                : -Math.PI / 2,
        reach = BLOCK_SIZE * 0.34 * scale;
      scratch.position.set(
        position.x - Math.sin(angle) * reach,
        position.y + Math.cos(angle) * reach,
        position.z + face,
      );
      scratch.rotation.set(0, 0, angle);
      scratch.scale.setScalar(BLOCK_SIZE * 0.3 * scale);
      scratch.updateMatrix();
      this.arrows.setMatrixAt(counts.arrows, scratch.matrix);
      this.arrows.setColorAt(counts.arrows++, tint);
    }
  }
  private impact(e: GameEvents['note:hit']): void {
    if (e.note.type === 'beam') {
      beamCenter.x = LANE_X[e.note.col];
      beamCenter.y = LANE_Y[e.note.row] + BEAM_HOVER_Y_OFFSET;
      beamCenter.z = BEAM_HOVER_Z;
      this.poofs.trigger(e, this.currentTime, beamCenter);
      this.balanceEffects();
      return;
    }
    if (e.note.type === 'slash') {
      let live: LiveNote | null = null;
      for (const note of this.renderedNotes)
        if (note.note.id === e.note.id) {
          live = note;
          break;
        }
      this.slices.trigger(e, this.currentTime, live?.pos ?? e.impactPos, live?.rotation ?? 0);
      this.sparks.trigger(e.impactPos, e.cutPlane?.normal ?? null, colors.slash, this.currentTime);
      this.balanceEffects();
      return;
    }
    if (e.note.type === 'smash') {
      this.shatter.trigger(e, this.currentTime);
      beamCenter.x = LANE_X[e.note.col];
      beamCenter.y = LANE_Y[e.note.row];
      beamCenter.z = e.impactPos.z + BLOCK_SIZE / 2;
      this.sparks.trigger(beamCenter, null, colors.smash, this.currentTime);
    }
    const count = 4;
    for (let i = 0; i < count; i++) {
      const slot = this.effects[this.effectIndex++ % this.effects.length]!;
      const angle = (i / count) * Math.PI * 2 + e.note.id;
      const speed =
        SHATTER_BURST_MIN + ((SHATTER_BURST_MAX - SHATTER_BURST_MIN) * ((e.note.id * 17 + i * 13) % 31)) / 31;
      Object.assign(slot, {
        active: true,
        birth: this.currentTime,
        life: this.activeQuality.fragmentLifetimeMs,
        x: e.impactPos.x,
        y: e.impactPos.y,
        z: e.impactPos.z,
        vx: Math.cos(angle) * speed,
        vy: this.calm ? 0 : Math.sin(angle) * speed,
        // The four armour plates peel off sideways and away from the camera as dark metal.
        vz: -SHATTER_RECEDE_MPS,
        size: BLOCK_SIZE * 0.22,
        color: ARMOR_PLATE_DEBRIS_COLOR,
        rotation: this.calm ? 0 : angle,
      });
    }
    this.balanceEffects();
  }
  /**
   * Visual QA preview: renders the decorative destruction of a synthetic hit in a lane. It does not
   * emit, judge or score anything and is never gameplay evidence. Effects draw only during play/pause.
   */
  previewImpact(type: NoteType, col: 0 | 1 | 2 | 3, row: 0 | 1 | 2, angle = Math.PI / 4): void {
    const x = LANE_X[col],
      y = LANE_Y[row],
      speed = 6;
    this.previewSerial++;
    this.impact({
      note: {
        id: 1_000_000 + this.previewSerial,
        t: this.currentTime,
        type,
        col,
        row,
        dir: 'any',
        strength: 1,
      },
      judgement: 'perfect',
      timingErrorMs: 0,
      hand: 'right',
      cutPlane: { point: { x, y, z: 0 }, normal: { x: Math.cos(angle), y: Math.sin(angle), z: 0 } },
      impactPos: { x, y, z: 0 },
      impactVel: { x: -Math.sin(angle) * speed, y: Math.cos(angle) * speed, z: 0 },
      scoreDelta: 0,
      combo: 0,
      multiplier: 1,
    });
  }
  get effectOccupancy(): number {
    let count = this.shatter.occupancy + this.slices.occupancy + this.poofs.occupancy;
    for (const effect of this.effects) if (effect.active) count++;
    return count;
  }
  private balanceEffects(): void {
    while (this.effectOccupancy > this.activeQuality.preset.fragmentCap) {
      let oldest: Effect | null = null;
      for (const effect of this.effects)
        if (effect.active && (!oldest || effect.birth < oldest.birth)) oldest = effect;
      const shatter = this.shatter.oldestBirth,
        slice = this.slices.oldestBirth,
        poof = this.poofs.oldestBirth,
        birth = Math.min(oldest?.birth ?? Infinity, shatter, slice, poof);
      if (oldest && oldest.birth === birth) oldest.active = false;
      else if (shatter === birth) this.shatter.releaseOldest();
      else if (slice === birth) this.slices.releaseOldest();
      else if (poof === birth) this.poofs.releaseOldest();
      else break;
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
  /** The intact Smash silhouette always matches the shard set this tier will shatter into. */
  private rebuildSmashBody(shards: readonly ShardAsset[]): void {
    const previous = this.smashBodyGeometry;
    this.smashBodyGeometry = crackedBody(shards, SMASH_CRACK_SCALE);
    this.bodies.smash.geometry = this.smashBodyGeometry;
    previous.dispose();
  }
  private applyAssets(): void {
    if (!this.assetPending) return;
    this.assetPending = false;
    const assets = this.assets.assets;
    this.armor.geometry = assets.armor;
    this.beamRings.geometry = assets.beamRing;
    this.bodies.slash.geometry = assets.slashBody;
    this.bodies.beam.geometry = assets.beamBody;
    this.rebuildSmashBody(this.lowShards ?? assets.shards);
    this.arrows.geometry = assets.glyphArrow;
    this.pylons.geometry = assets.pylon;
    for (const type of ['slash', 'smash', 'beam'] as const)
      this.glyphMeshes[type].geometry = assets.glyphs[type];
    this.shatter.configure(this.lowShards ?? assets.shards);
    if (assets.environment && this.environment !== assets.environment) {
      this.environment = assets.environment;
      this.environment.traverse((object) => object.layers.set(0));
      this.atmosphere.bind(this.environment);
      this.scene.add(this.environment);
    }
    this.configurePylons();
  }
  capture(): void {
    if (!this.visible || !this.hasPose) return;
    if (this.avatar && this.avatarFrozen?.valid)
      this.avatarSaved = this.avatar.snapshot(this.avatarSaved ?? undefined);
    this.savedJoints.set(this.joints);
    this.savedJointPositions.set(this.jointPositions);
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
    this.avatar?.resetMotion();
    if (this.avatarFrozen) this.avatarFrozen.valid = false;
    if (this.avatarSaved) this.avatarSaved.valid = false;
    for (const e of this.effects) e.active = false;
    this.snapshotValid = false;
    this.snapshotAt = null;
    this.frozenPose = false;
    this.headPresent = this.frozenHeadPresent = this.savedHeadPresent = false;
    this.headMarker.visible = false;
    this.jointMarkers.visible = false;
    this.jointMarkers.count = 0;
    this.effectIndex = 0;
    this.currentTime = 0;
    this.bands.low = this.bands.mid = this.bands.high = this.bands.rms = 0;
    this.shatter.reset();
    this.slices.reset();
    this.poofs.reset();
    this.sparks.reset();
    this.rig.reset();
    this.failures.reset();
    this.renderedNotes = EMPTY_NOTES;
    this.beamBirth[0] = this.beamBirth[1] = -Infinity;
  }
  dispose(): void {
    this.disposed = true;
    this.avatarAbort.abort();
    this.avatar?.dispose();
    this.avatar = null;
    this.avatarListeners.clear();
    this.assets.stop();
    this.shatter.dispose();
    this.slices.dispose();
    this.poofs.dispose();
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
    this.post?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
