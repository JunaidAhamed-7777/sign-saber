/**
 * Sign Saber — audio/sfxDirector.ts
 *
 * Responsibility: Audio game feel. Maps game, lifecycle and menu events to SFX bus cues with musical
 * timing, stereo placement, judgement layering, calm voicing, rate limits and charge/countdown cues.
 * Spec: docs/15-audio-playback-sync.md §6 SFX bus
 * Inputs: GameEvents, display-store changes (calm, audio unlock), runtime hooks (session start, hand
 *   cursors, menu pointer, menu actions), DOM hover/focus/click on registered menu buttons
 * Outputs: SfxBus voices. Never writes game state; judgement and scoring are unaffected by any cue.
 */
import {
  BEAM_CHARGE_MS,
  COUNTDOWN_STEPS,
  HUD_COMBO_MILESTONES,
  LANE_X,
  MULTIPLIER_LADDER,
  SFX_BEAT_SNAP_MS,
  SFX_BREAK_MIN_COMBO,
  SFX_CHARGE_CANCEL_DROP,
  SFX_CHARGE_START,
  SFX_COMBO_STEP_SEMITONES,
  SFX_DYNAMICS_DB,
  SFX_DYNAMICS_FULL_RATIO,
  SFX_JUDGEMENT_RATE,
  SFX_LATE_SKIP_MS,
  SFX_LOOKAHEAD_MS,
  SFX_MILESTONE_SEMITONES,
  SFX_MISS_MIN_GAP_MS,
  SFX_NEUTRAL_GO_RATE,
  SFX_PAN_BEAM,
  SFX_PAN_HAND,
  SFX_PAN_LANE,
  SFX_PAN_WALL,
  SFX_RELEASE_S,
  SFX_DEFAULT_ROOT_HZ,
  SFX_UI_MIN_GAP_MS,
  SFX_WALL_WARN_LEAD_S,
  SLASH_MIN_SPEED,
  SMASH_MIN_SPEED,
} from '../core/constants';
import type { GameEvents } from '../core/events';
import type { TypedEmitter } from '../utils/emitter';
import type { GameState } from '../core/stateMachine';
import type { Hand, HandCursor, SessionStats } from '../core/types';
import type { MenuPointerState } from '../core/menuInput';
import type { BeatmapV1, ObstacleKind } from '../beatmap/types';
import { clamp } from '../utils/math';
import { SfxBus } from './sfx';
import type { SfxId } from './sfx';
import type { SfxRenderer } from './sfxBank';
import { pitchClassHz, sampleTonicFrames } from './tonic';
import type { PcmSource, TonalCenter } from './tonic';

/** The subset of display state the director reacts to. */
export interface SfxStoreView {
  calm: boolean;
  audioReady: boolean;
}
export interface SfxStore {
  getState(): SfxStoreView;
  subscribe(listener: (state: SfxStoreView, previous: SfxStoreView) => void): () => void;
}
export interface SfxDom {
  window?: EventTarget | undefined;
  document?: EventTarget | undefined;
}
export interface SfxSessionStart {
  map: BeatmapV1;
  /** AudioContext time of song sample 0 (`AudioPlayer.start` result). */
  startAt: number;
  /** Countdown digit spacing actually displayed (ms). */
  stepMs: number;
  /** Confident tempo: pitched musical count; otherwise unpitched neutral ticks. */
  confidentTempo: boolean;
  /** Decoded music, used only for the cosmetic tonal-centre estimate. */
  music: PcmSource | null;
}

/** Warm-up order: menu feedback first, then the countdown and the most frequent gameplay cues. */
export const WARM_ORDER: readonly SfxId[] = [
  'uiEnable',
  'uiHover',
  'uiConfirm',
  'uiBack',
  'uiSelect',
  'uiArm',
  'countNeutral',
  'count',
  'countGo',
  'slash',
  'smash',
  'sparkle',
  'glint',
  'miss',
  'badcut',
  'zap',
  'poof',
  'charge',
  'combo',
  'milestone',
  'wallWarn',
  'wallHit',
  'dodge',
  'comboBreak',
  'drop',
  'resume',
  'resultsHigh',
  'resultsLow',
];
const CHARGE_S = BEAM_CHARGE_MS / 1000;
const HIGH_RANKS: ReadonlySet<SessionStats['rank']> = new Set(['SS', 'S', 'A']);
const semitones = (value: number): number => 2 ** (value / 12);
const LANE_SPAN = Math.max(...LANE_X.map(Math.abs));

/** Stereo position of a lane, nudged toward the hand that played it. */
export function notePan(col: number, hand?: Hand): number {
  const lane = (LANE_X[clamp(Math.round(col), 0, LANE_X.length - 1)] ?? 0) / LANE_SPAN;
  const bias = hand === 'left' ? -SFX_PAN_HAND : hand === 'right' ? SFX_PAN_HAND : 0;
  return clamp(lane * SFX_PAN_LANE + bias, -1, 1);
}
export function wallPan(kind: ObstacleKind): number {
  return kind === 'wallLeft' ? -SFX_PAN_WALL : kind === 'wallRight' ? SFX_PAN_WALL : 0;
}
/** Swing-speed dynamics: at the gesture minimum −2 dB, at SFX_DYNAMICS_FULL_RATIO × minimum +1 dB. */
export function dynamicsDb(speed: number, minimum: number): number {
  if (!Number.isFinite(speed) || !(minimum > 0)) return 0;
  const amount = clamp((speed / minimum - 1) / (SFX_DYNAMICS_FULL_RATIO - 1), 0, 1);
  return SFX_DYNAMICS_DB.min + (SFX_DYNAMICS_DB.max - SFX_DYNAMICS_DB.min) * amount;
}
/** Menu target id → cue. `audio` is silent here: the unlock chime follows the actual unlock. */
export function menuCue(id: string): SfxId | null {
  if (id === 'audio') return null;
  if (id.startsWith('volume-')) return 'uiHover';
  if (
    ['back', 'songs', 'camera-cancel', 'camera-off', 'cancel-resume', 'cancel-generation'].includes(id) ||
    id.endsWith(':previous') ||
    id.endsWith(':close')
  )
    return 'uiBack';
  if (
    id.startsWith('song:') ||
    id.startsWith('difficulty:') ||
    id.endsWith(':next') ||
    ['hand', 'calm', 'credits'].includes(id)
  )
    return 'uiSelect';
  return 'uiConfirm';
}
const ladderIndex = (multiplier: number): number =>
  Math.max(
    0,
    MULTIPLIER_LADDER.findIndex(([, value]) => value === multiplier),
  );

interface ChargeSlot {
  handle: number | null;
  peak: number;
  full: boolean;
}
interface ActiveSession {
  map: BeatmapV1;
  startAt: number;
  eventIndex: number;
}
interface MenuButton {
  disabled: boolean;
  dataset: DOMStringMap;
  matches(selector: string): boolean;
}
const buttonOf = (target: EventTarget | null): MenuButton | null => {
  const element = target as { closest?: (selector: string) => unknown } | null;
  return typeof element?.closest === 'function'
    ? (element.closest('button[data-target]') as MenuButton | null)
    : null;
};

export class SfxDirector {
  private bus: SfxBus | null = null;
  private context: AudioContext | null = null;
  private state: GameState = 'BOOT';
  private session: ActiveSession | null = null;
  private mode: TonalCenter['mode'] = 'major';
  private rank: SessionStats['rank'] | null = null;
  private lastCombo = 0;
  private lastMultiplier = 1;
  private lastMissAt = -Infinity;
  private lastUiAt = -Infinity;
  private pointerPhase: MenuPointerState['phase'] = 'unavailable';
  private pointerTarget: string | null = null;
  private hovered: MenuButton | null = null;
  private tonicRequest = 0;
  private readonly tonics = new WeakMap<object, TonalCenter | null>();
  private readonly charges: Record<Hand, ChargeSlot> = {
    left: { handle: null, peak: 0, full: false },
    right: { handle: null, peak: 0, full: false },
  };
  private readonly offs: (() => void)[] = [];
  private disposed = false;

  constructor(
    events: TypedEmitter<GameEvents>,
    private readonly store: SfxStore,
    dom: SfxDom = {
      window: typeof window === 'undefined' ? undefined : window,
      document: typeof document === 'undefined' ? undefined : document,
    },
  ) {
    const on = <K extends keyof GameEvents>(name: K, listener: (value: GameEvents[K]) => void): void => {
      this.offs.push(events.on(name, listener));
    };
    on('state:change', ({ prev, next }) => this.onState(prev, next));
    on('note:hit', (event) => this.onHit(event));
    on('note:miss', ({ note }) => {
      const now = this.nowMs();
      if (now - this.lastMissAt < SFX_MISS_MIN_GAP_MS) return;
      this.lastMissAt = now;
      this.cue('miss', { pan: notePan(note.col), jitter: true });
    });
    on('note:badcut', ({ note, hand }) => this.cue('badcut', { pan: notePan(note.col, hand), jitter: true }));
    on('beam:fire', ({ hand }) => {
      this.releaseCharge(hand, true);
      this.cue('zap', { pan: hand === 'left' ? -SFX_PAN_BEAM : SFX_PAN_BEAM, jitter: true });
    });
    on('obstacle:spawn', ({ obstacle }) => this.scheduleWallWarning(obstacle.t, obstacle.kind));
    on('obstacle:hit', ({ obstacle }) => this.cue('wallHit', { pan: wallPan(obstacle.kind) * 0.6 }));
    on('obstacle:dodged', ({ obstacle }) => this.cue('dodge', { pan: wallPan(obstacle.kind), jitter: true }));
    on('combo:change', (event) => this.onCombo(event));
    on('song:progress', () => this.scheduleMusicEvents());
    on('session:end', (stats) => {
      this.rank = stats.rank;
    });
    this.offs.push(
      store.subscribe((state, previous) => {
        if (state.calm !== previous.calm) this.bus?.setVoicing({ calm: state.calm });
        // The unlock chime confirms sound actually works; resume after a pause has its own cue.
        if (state.audioReady && !previous.audioReady && this.state !== 'PLAYING' && this.state !== 'PAUSED')
          this.cue('uiEnable');
      }),
    );
    const listen = (
      target: EventTarget | undefined,
      name: string,
      listener: (event: Event) => void,
    ): void => {
      if (!target) return;
      target.addEventListener(name, listener, { passive: true });
      this.offs.push(() => target.removeEventListener(name, listener));
    };
    // Bubble phase on window: React has already run the action, so e.g. volume ticks play at the new level.
    listen(dom.window, 'click', (event) => {
      const button = buttonOf(event.target);
      if (button && !button.disabled && button.dataset.target) this.menuAction(button.dataset.target);
    });
    listen(dom.document, 'pointerover', (event) => {
      if ((event as PointerEvent).pointerType !== 'mouse') return;
      const button = buttonOf(event.target);
      if (!button || button === this.hovered) return;
      this.hovered = button;
      if (!button.disabled) this.ui('uiHover');
    });
    listen(dom.document, 'pointerout', (event) => {
      if (buttonOf((event as PointerEvent).relatedTarget) !== this.hovered) this.hovered = null;
    });
    listen(dom.document, 'focusin', (event) => {
      const button = buttonOf(event.target);
      if (button && !button.disabled && button.matches(':focus-visible')) this.ui('uiHover');
    });
  }

  /** Create the bus on the unlocked live context and start preparing sounds off the main thread. */
  attach(context: AudioContext, destination: AudioNode, renderer?: SfxRenderer): void {
    if (this.disposed || this.context === context) return;
    this.bus?.dispose();
    this.context = context;
    this.bus = new SfxBus(context, destination, renderer);
    this.bus.setVoicing({ calm: this.store.getState().calm });
    void this.bus.warm(WARM_ORDER);
  }

  /** Called once the song is scheduled: countdown cues, chart-timed scheduling and track tuning. */
  beginSession(start: SfxSessionStart): void {
    const bus = this.bus;
    this.releaseCharges();
    this.session = { map: start.map, startAt: start.startAt, eventIndex: 0 };
    this.rank = null;
    this.lastCombo = 0;
    this.lastMultiplier = 1;
    if (!bus || !this.context) return;
    bus.reseed();
    const now = this.context.currentTime;
    for (let digit = COUNTDOWN_STEPS; digit > 0; digit--) {
      const at = start.startAt - (digit * start.stepMs) / 1000 - bus.latencyS;
      if (at < now - SFX_LATE_SKIP_MS / 1000) continue;
      if (start.confidentTempo) bus.play(digit === 1 ? 'countGo' : 'count', { at });
      else bus.play('countNeutral', { at, ...(digit === 1 ? { rate: SFX_NEUTRAL_GO_RATE } : {}) });
    }
    this.tune(start.music);
  }

  /** Beam charge cue per hand from the latest capture-time cursors (PLAYING only). */
  hands(cursors: readonly HandCursor[]): void {
    const bus = this.bus;
    if (!bus || this.state !== 'PLAYING') return;
    for (const hand of ['left', 'right'] as const) {
      let cursor: HandCursor | undefined;
      for (const candidate of cursors) if (candidate.hand === hand) cursor = candidate;
      const slot = this.charges[hand];
      const charge = cursor?.present && cursor.gesture === 'point' ? cursor.charge : 0;
      if (charge <= SFX_CHARGE_START || charge < slot.peak - SFX_CHARGE_CANCEL_DROP) {
        this.releaseCharge(hand, false);
        if (charge <= SFX_CHARGE_START) continue;
      }
      slot.peak = Math.max(slot.peak, charge);
      if (slot.handle === null && !slot.full && charge < 1)
        slot.handle = bus.play('charge', {
          offset: charge * CHARGE_S,
          pan: hand === 'left' ? -SFX_PAN_BEAM : SFX_PAN_BEAM,
        });
      // The buffer's own "ready" ping lands at full charge; let it finish naturally.
      if (charge >= 1) slot.full = true;
    }
  }

  /** Hand-pointer feedback: a soft tick on a new target and an arm cue when the point is armed. */
  pointer(state: Readonly<MenuPointerState>): void {
    const active = state.visible && state.phase !== 'unavailable' && state.phase !== 'idle';
    if (active && state.targetId && state.targetId !== this.pointerTarget) this.ui('uiHover');
    if (active && state.phase === 'armed' && this.pointerPhase !== 'armed') this.ui('uiArm', true);
    this.pointerTarget = active ? state.targetId : null;
    this.pointerPhase = state.phase;
  }

  /** A menu action that actually ran (native click or accepted hand activation). */
  menuAction(id: string): void {
    const cue = menuCue(id);
    if (cue) this.ui(cue, true);
  }

  /** Stop every voice (including scheduled countdown/wall cues) and forget the session. */
  stop(): void {
    this.bus?.stop();
    this.session = null;
    this.tonicRequest++;
    for (const hand of ['left', 'right'] as const)
      this.charges[hand] = { handle: null, peak: 0, full: false };
  }

  /** Plays per sound since audio was enabled (diagnostics; not release evidence of audibility). */
  get plays(): Readonly<Partial<Record<SfxId, number>>> {
    return this.bus?.plays ?? {};
  }
  get activeVoices(): number {
    return this.bus?.activeVoices ?? 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.offs.splice(0)) off();
    this.bus?.dispose();
    this.bus = null;
    this.context = null;
    this.session = null;
  }

  private nowMs(): number {
    return (this.context?.currentTime ?? 0) * 1000;
  }
  private cue(name: SfxId, options: Parameters<SfxBus['play']>[1] = {}): number | null {
    return this.bus?.play(name, options) ?? null;
  }
  /** Interface cues are rate limited so sweeping across buttons never machine-guns. */
  private ui(name: SfxId, force = false): void {
    const now = typeof performance === 'undefined' ? Date.now() : performance.now();
    if (!force && now - this.lastUiAt < SFX_UI_MIN_GAP_MS) return;
    this.lastUiAt = now;
    this.cue(name);
  }
  /** Context time of a chart time, compensated for the limiter look-ahead. */
  private chartTime(songMs: number): number | null {
    if (!this.session || !this.bus) return null;
    return this.session.startAt + songMs / 1000 - this.bus.latencyS;
  }
  /** An event that arrives slightly before its chart time sounds on the chart time instead. */
  private snap(noteMs: number): number | undefined {
    const target = this.chartTime(noteMs);
    const now = this.context?.currentTime;
    if (target === null || now === undefined) return undefined;
    return target > now && target - now <= SFX_BEAT_SNAP_MS / 1000 ? target : undefined;
  }
  private onState(prev: GameState, next: GameState): void {
    this.state = next;
    if (next === 'PAUSED') {
      this.releaseCharges();
      this.bus?.silenceSounding();
    } else if (prev === 'PAUSED' && next === 'PLAYING') this.cue('resume');
    else if (next === 'RESULTS') {
      this.releaseCharges();
      this.cue(this.rank && HIGH_RANKS.has(this.rank) ? 'resultsHigh' : 'resultsLow');
      this.session = null;
    } else if (next === 'SELECT') this.session = null;
  }
  private onHit(event: GameEvents['note:hit']): void {
    const at = this.snap(event.note.t);
    const pan = notePan(event.note.col, event.hand);
    const rate = SFX_JUDGEMENT_RATE[event.judgement];
    const timing = at === undefined ? {} : { at };
    if (event.note.type === 'beam') this.cue('poof', { ...timing, pan, rate, jitter: true });
    else {
      const minimum = event.note.type === 'slash' ? SLASH_MIN_SPEED : SMASH_MIN_SPEED;
      const speed = Math.hypot(event.impactVel.x, event.impactVel.y, event.impactVel.z);
      this.cue(event.note.type, { ...timing, pan, rate, jitter: true, gainDb: dynamicsDb(speed, minimum) });
    }
    const layer = event.judgement === 'perfect' ? 'sparkle' : event.judgement === 'great' ? 'glint' : null;
    if (layer) this.cue(layer, { ...timing, pan: pan * 0.5 });
  }
  private onCombo(event: GameEvents['combo:change']): void {
    if (event.broke) {
      if (this.lastCombo >= SFX_BREAK_MIN_COMBO && !this.store.getState().calm) this.cue('comboBreak');
    } else {
      if (event.multiplier > this.lastMultiplier) {
        const step = SFX_COMBO_STEP_SEMITONES[this.mode][ladderIndex(event.multiplier)] ?? 0;
        this.cue('combo', { rate: semitones(step) });
      }
      const milestone = HUD_COMBO_MILESTONES.indexOf(event.combo as (typeof HUD_COMBO_MILESTONES)[number]);
      const top = HUD_COMBO_MILESTONES[HUD_COMBO_MILESTONES.length - 1]!;
      const index = milestone !== -1 ? milestone : event.combo > top && event.combo % top === 0 ? 3 : -1;
      if (index !== -1)
        this.cue('milestone', { rate: semitones(SFX_MILESTONE_SEMITONES[this.mode][index] ?? 0) });
    }
    this.lastCombo = event.combo;
    this.lastMultiplier = event.multiplier;
  }
  /** Swell timed so its peak lands when the wall's leading face reaches the player. */
  private scheduleWallWarning(wallMs: number, kind: ObstacleKind): void {
    const arrival = this.chartTime(wallMs);
    const now = this.context?.currentTime;
    if (arrival === null || now === undefined) return;
    const start = arrival - SFX_WALL_WARN_LEAD_S;
    const offset = Math.max(0, now - start);
    if (offset >= SFX_WALL_WARN_LEAD_S) return;
    this.cue('wallWarn', { at: start, offset, pan: wallPan(kind) });
  }
  /** Drop stings are scheduled a little ahead on the exact chart time instead of a frame late. */
  private scheduleMusicEvents(): void {
    const session = this.session,
      bus = this.bus,
      context = this.context;
    if (!session || !bus || !context) return;
    const horizonMs = (context.currentTime - session.startAt) * 1000 + SFX_LOOKAHEAD_MS;
    const events = session.map.events;
    while (session.eventIndex < events.length && events[session.eventIndex]!.t <= horizonMs) {
      const event = events[session.eventIndex++]!;
      if (event.kind !== 'drop') continue;
      const at = this.chartTime(event.t)!;
      if (at >= context.currentTime - SFX_LATE_SKIP_MS / 1000) bus.play('drop', { at });
    }
  }
  private releaseCharge(hand: Hand, fired: boolean): void {
    const slot = this.charges[hand];
    if (slot.handle !== null && (fired || !slot.full))
      this.bus?.release(slot.handle, fired ? 0.015 : SFX_RELEASE_S);
    slot.handle = null;
    slot.peak = 0;
    slot.full = false;
  }
  private releaseCharges(): void {
    this.releaseCharge('left', false);
    this.releaseCharge('right', false);
  }
  /** Tune pitched gameplay cues to the music's estimated tonic (off the main thread when possible). */
  private tune(music: PcmSource | null): void {
    const bus = this.bus;
    if (!bus || !music) return;
    const apply = (center: TonalCenter | null): void => {
      this.mode = center?.mode ?? 'major';
      bus.setVoicing({
        rootHz: center ? pitchClassHz(center.pitchClass, SFX_DEFAULT_ROOT_HZ) : SFX_DEFAULT_ROOT_HZ,
      });
    };
    const key = music as object;
    if (this.tonics.has(key)) {
      apply(this.tonics.get(key) ?? null);
      return;
    }
    let frames: Float32Array | null;
    try {
      frames = sampleTonicFrames(music);
    } catch {
      // Cosmetic only: an unreadable buffer keeps the neutral default root.
      frames = null;
    }
    if (!frames) {
      this.tonics.set(key, null);
      apply(null);
      return;
    }
    const request = ++this.tonicRequest;
    void bus.bank
      .tonic(frames, music.sampleRate)
      .catch(() => null)
      .then((center) => {
        this.tonics.set(key, center);
        if (!this.disposed && request === this.tonicRequest && this.bus === bus) apply(center);
      });
  }
}
