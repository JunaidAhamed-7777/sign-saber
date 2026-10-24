/**
 * Sign Saber — core/judgementTrace.ts
 *
 * Responsibility: bounded, typed record of judgement events in semantic (emission) order, with an
 * async SHA-256 over the semantic fields only. Delivery timestamps are retained separately and are
 * excluded from the hash, so identical judgements from different render schedules hash identically.
 * Spec: docs/24-benchmark-and-evidence.md §9 (judgement-trace checksum); HANDOFF item 3
 * Inputs: GameEvents from the state machine's synchronous emitter
 * Outputs: export() → { events, overflow, repeats, sha256 }
 *
 * Overflow is explicit: events beyond capacity are counted, never silently dropped. A "repeat" is a
 * second terminal outcome for the same note/obstacle id, which the game contract forbids; it is
 * recorded and counted rather than hidden.
 */
import type { GameEvents } from './events';
import type { TypedEmitter } from '../utils/emitter';
import { JUDGEMENT_TRACE_CAPACITY } from './constants';
import { sha256 } from '../utils/hash';

export const TRACE_KINDS = [
  'note:hit',
  'note:miss',
  'note:badcut',
  'beam:fire',
  'obstacle:hit',
  'obstacle:dodged',
  'session:end',
] as const;
export type TraceKind = (typeof TRACE_KINDS)[number];
const JUDGEMENTS = ['', 'perfect', 'great', 'good'] as const;
const HANDS = ['', 'left', 'right'] as const;
const GESTURES = ['', 'open', 'fist', 'point', 'none'] as const;
const NOTE_TERMINAL = new Set<TraceKind>(['note:hit', 'note:miss', 'note:badcut']);
const OBSTACLE_TERMINAL = new Set<TraceKind>(['obstacle:hit', 'obstacle:dodged']);

export interface TraceEvent {
  index: number;
  kind: TraceKind;
  /** Note/obstacle id; -1 when the event has none (session end, beam without target). */
  subject: number;
  /** Chart time of the subject (ms); null for session:end and untargeted beams. */
  chartTimeMs: number | null;
  judgement: (typeof JUDGEMENTS)[number] | null;
  timingErrorMs: number | null;
  hand: (typeof HANDS)[number] | null;
  gesture: (typeof GESTURES)[number] | null;
  /** Score change; for session:end the final score. */
  scoreDelta: number | null;
  /** Combo after the event; for session:end the maximum combo. */
  combo: number | null;
  multiplier: number | null;
  repeat: boolean;
}

export class JudgementTraceRecorder {
  private readonly kind: Uint8Array;
  private readonly subject: Int32Array;
  private readonly chartTime: Float64Array;
  private readonly timingError: Float32Array;
  private readonly hand: Uint8Array;
  private readonly judgement: Uint8Array;
  private readonly gesture: Uint8Array;
  private readonly scoreDelta: Int32Array;
  private readonly combo: Int32Array;
  private readonly multiplier: Float32Array;
  private readonly repeatFlag: Uint8Array;
  private readonly deliveredAt: Float64Array;
  private count = 0;
  private overflow = 0;
  private repeats = 0;
  private readonly terminalNotes = new Set<number>();
  private readonly terminalObstacles = new Set<number>();
  private emitter: TypedEmitter<GameEvents> | null = null;
  private offs: (() => void)[] = [];
  label = '';
  constructor(
    readonly capacity = JUDGEMENT_TRACE_CAPACITY,
    private readonly now: () => number = () => performance.now(),
  ) {
    if (!Number.isInteger(capacity) || capacity <= 0) throw new RangeError('Trace capacity must be positive');
    this.kind = new Uint8Array(capacity);
    this.subject = new Int32Array(capacity);
    this.chartTime = new Float64Array(capacity);
    this.timingError = new Float32Array(capacity);
    this.hand = new Uint8Array(capacity);
    this.judgement = new Uint8Array(capacity);
    this.gesture = new Uint8Array(capacity);
    this.scoreDelta = new Int32Array(capacity);
    this.combo = new Int32Array(capacity);
    this.multiplier = new Float32Array(capacity);
    this.repeatFlag = new Uint8Array(capacity);
    this.deliveredAt = new Float64Array(capacity);
  }
  get length(): number {
    return this.count;
  }
  get attached(): boolean {
    return this.emitter !== null;
  }
  /** Idempotent: attaching to the same emitter twice keeps one subscription per event. */
  attach(emitter: TypedEmitter<GameEvents>): void {
    if (this.emitter === emitter) return;
    this.detach();
    this.emitter = emitter;
    this.offs = [
      emitter.on('note:hit', (e) =>
        this.push('note:hit', e.note.id, e.note.t, {
          judgement: e.judgement,
          timingErrorMs: e.timingErrorMs,
          hand: e.hand,
          scoreDelta: e.scoreDelta,
          combo: e.combo,
          multiplier: e.multiplier,
        }),
      ),
      emitter.on('note:miss', (e) => this.push('note:miss', e.note.id, e.note.t, {})),
      emitter.on('note:badcut', (e) =>
        this.push('note:badcut', e.note.id, e.note.t, { hand: e.hand, gesture: e.gesture }),
      ),
      emitter.on('beam:fire', (e) =>
        this.push('beam:fire', e.note?.id ?? -1, e.note?.t ?? null, { hand: e.hand }),
      ),
      emitter.on('obstacle:hit', (e) => this.push('obstacle:hit', e.obstacle.id, e.obstacle.t, {})),
      emitter.on('obstacle:dodged', (e) =>
        this.push('obstacle:dodged', e.obstacle.id, e.obstacle.t, { scoreDelta: e.scoreDelta }),
      ),
      emitter.on('session:end', (e) =>
        this.push('session:end', -1, null, { combo: e.maxCombo, scoreDelta: e.score }),
      ),
    ];
  }
  /** Idempotent and safe during dispatch. */
  detach(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.emitter = null;
  }
  /** Starts a new session trace; subscriptions are retained. */
  reset(label = ''): void {
    this.count = this.overflow = this.repeats = 0;
    this.terminalNotes.clear();
    this.terminalObstacles.clear();
    this.label = label;
  }
  dispose(): void {
    this.detach();
    this.reset();
  }
  private push(
    kind: TraceKind,
    subject: number,
    chartTimeMs: number | null,
    fields: {
      judgement?: (typeof JUDGEMENTS)[number];
      timingErrorMs?: number;
      hand?: string;
      gesture?: string;
      scoreDelta?: number;
      combo?: number;
      multiplier?: number;
    },
  ): void {
    let repeat = false;
    const terminal = NOTE_TERMINAL.has(kind)
      ? this.terminalNotes
      : OBSTACLE_TERMINAL.has(kind)
        ? this.terminalObstacles
        : null;
    if (terminal) {
      repeat = terminal.has(subject);
      if (repeat) this.repeats++;
      else terminal.add(subject);
    }
    if (this.count >= this.capacity) {
      this.overflow++;
      return;
    }
    const i = this.count++;
    this.kind[i] = TRACE_KINDS.indexOf(kind);
    this.subject[i] = subject;
    this.chartTime[i] = chartTimeMs ?? NaN;
    this.timingError[i] = fields.timingErrorMs ?? NaN;
    this.hand[i] = Math.max(0, HANDS.indexOf((fields.hand ?? '') as (typeof HANDS)[number]));
    this.judgement[i] = Math.max(0, JUDGEMENTS.indexOf(fields.judgement ?? ''));
    this.gesture[i] = Math.max(0, GESTURES.indexOf((fields.gesture ?? '') as (typeof GESTURES)[number]));
    this.scoreDelta[i] = fields.scoreDelta ?? 0;
    this.combo[i] = fields.combo ?? -1;
    this.multiplier[i] = fields.multiplier ?? NaN;
    this.repeatFlag[i] = repeat ? 1 : 0;
    this.deliveredAt[i] = this.now();
  }
  events(): TraceEvent[] {
    const optional = (value: number) => (Number.isFinite(value) ? value : null);
    return Array.from({ length: this.count }, (_, i) => {
      const kind = TRACE_KINDS[this.kind[i]!]!;
      const hasScore = kind === 'note:hit' || kind === 'obstacle:dodged' || kind === 'session:end';
      return {
        index: i,
        kind,
        subject: this.subject[i]!,
        chartTimeMs: optional(this.chartTime[i]!),
        judgement: this.judgement[i] ? JUDGEMENTS[this.judgement[i]!]! : null,
        timingErrorMs: optional(this.timingError[i]!),
        hand: this.hand[i] ? HANDS[this.hand[i]!]! : null,
        gesture: this.gesture[i] ? GESTURES[this.gesture[i]!]! : null,
        scoreDelta: hasScore ? this.scoreDelta[i]! : null,
        combo: this.combo[i]! >= 0 ? this.combo[i]! : null,
        multiplier: optional(this.multiplier[i]!),
        repeat: this.repeatFlag[i] === 1,
      };
    });
  }
  /** Canonical semantic serialization: one line per event, fixed field order, no delivery times. */
  canonical(): string {
    const header = `judgement-trace/v1 count=${this.count} overflow=${this.overflow} repeats=${this.repeats}`;
    const lines = this.events().map((e) =>
      [
        e.index,
        e.kind,
        e.subject,
        e.chartTimeMs ?? '',
        e.judgement ?? '',
        e.timingErrorMs === null ? '' : e.timingErrorMs.toFixed(3),
        e.hand ?? '',
        e.gesture ?? '',
        e.scoreDelta ?? '',
        e.combo ?? '',
        e.multiplier ?? '',
        e.repeat ? 1 : 0,
      ].join('\t'),
    );
    return [header, ...lines].join('\n') + '\n';
  }
  async export(): Promise<{
    schema: 1;
    label: string;
    capacity: number;
    count: number;
    overflow: number;
    repeats: number;
    sha256: string;
    hashCovers: string;
    events: TraceEvent[];
    deliveredAtMs: number[];
  }> {
    const canonical = this.canonical();
    return {
      schema: 1,
      label: this.label,
      capacity: this.capacity,
      count: this.count,
      overflow: this.overflow,
      repeats: this.repeats,
      sha256: await sha256(new TextEncoder().encode(canonical)),
      hashCovers:
        'Semantic fields in emission order plus count/overflow/repeats; delivery timestamps excluded.',
      events: this.events(),
      deliveredAtMs: Array.from(this.deliveredAt.subarray(0, this.count)),
    };
  }
}
