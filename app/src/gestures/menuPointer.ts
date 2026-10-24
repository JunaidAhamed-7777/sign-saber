/** Capture-time Open→Point menu state machine, docs/25. */
import type {
  MenuActivation,
  MenuContext,
  MenuHandSample,
  MenuPointerState,
  MenuReachBounds,
  MenuTarget,
} from '../core/menuInput';
import {
  MENU_REACH_BOUNDS,
  MENU_GESTURE_CONFIDENCE_MIN,
  MENU_OPEN_ARM_MS,
  MENU_POINT_CONFIRM_MS,
  MENU_TRANSITION_GRACE_MS,
  MENU_POINT_MAX_MOVE_PX,
  MENU_CLICK_COOLDOWN_MS,
  MENU_TRACK_MAX_AGE_MS,
  MENU_HANDOVER_COOLDOWN_MS,
} from '../core/constants';
export class MenuPointerController {
  readonly state: MenuPointerState;
  private reach: MenuReachBounds = { ...MENU_REACH_BOUNDS };
  private seq = -1;
  private t = -Infinity;
  private screen = -1;
  private layout = -1;
  private openSince = Number.NaN;
  private pointSince = Number.NaN;
  private transitionSince = Number.NaN;
  private cooldownUntil = -Infinity;
  private handoverUntil = -Infinity;
  private anchorX = 0;
  private anchorY = 0;
  private targetBounds = { left: 0, top: 0, width: 0, height: 0 };
  constructor(hand: 'left' | 'right' = 'right') {
    this.state = {
      hand,
      visible: false,
      xCss: 0,
      yCss: 0,
      phase: 'unavailable',
      targetId: null,
      progress: 0,
    };
  }
  cancel(now: number, native = false): void {
    this.state.phase = 'unavailable';
    this.state.visible = false;
    this.state.targetId = null;
    this.state.progress = 0;
    this.openSince = this.pointSince = this.transitionSince = Number.NaN;
    if (native) this.handoverUntil = now + MENU_HANDOVER_COOLDOWN_MS;
  }
  setHand(hand: 'left' | 'right', now: number): void {
    this.state.hand = hand;
    this.seq = -1;
    this.t = -Infinity;
    this.cancel(now, true);
  }
  setReach(reach: MenuReachBounds, now: number): boolean {
    if (
      ![reach.left, reach.right, reach.top, reach.bottom].every(Number.isFinite) ||
      reach.right <= reach.left ||
      reach.bottom <= reach.top
    )
      return false;
    this.reach = { ...reach };
    this.cancel(now, true);
    return true;
  }
  update(sample: MenuHandSample, context: MenuContext, now: number): MenuActivation | null {
    if (sample.hand !== this.state.hand) return null;
    if (!Number.isInteger(sample.seq) || !Number.isFinite(sample.tCapture)) {
      this.cancel(now);
      return null;
    }
    if (sample.seq <= this.seq || sample.tCapture <= this.t) return null;
    if (sample.tCapture - this.t > MENU_TRACK_MAX_AGE_MS) this.cancel(now);
    this.seq = sample.seq;
    this.t = sample.tCapture;
    if (context.screenEpoch !== this.screen || context.layoutEpoch !== this.layout) {
      this.cancel(now);
      this.screen = context.screenEpoch;
      this.layout = context.layoutEpoch;
    }
    if (
      !context.enabled ||
      !sample.present ||
      !Number.isFinite(sample.tCapture) ||
      !Number.isFinite(now) ||
      now - sample.tCapture > MENU_TRACK_MAX_AGE_MS ||
      now < sample.tCapture ||
      now < this.handoverUntil ||
      !Number.isFinite(sample.palm.x) ||
      !Number.isFinite(sample.palm.y)
    ) {
      this.cancel(now);
      return null;
    }
    const v = context.viewport;
    if (![v.left, v.top, v.width, v.height].every(Number.isFinite) || v.width <= 0 || v.height <= 0) {
      this.cancel(now);
      return null;
    }
    const x =
      v.left +
      Math.min(1, Math.max(0, (sample.palm.x - this.reach.left) / (this.reach.right - this.reach.left))) *
        v.width;
    const y =
      v.top +
      Math.min(1, Math.max(0, (sample.palm.y - this.reach.top) / (this.reach.bottom - this.reach.top))) *
        v.height;
    const confident = sample.confidence >= MENU_GESTURE_CONFIDENCE_MIN;
    this.state.visible = true;
    if (sample.gesture === 'open' && confident) {
      this.state.xCss = x;
      this.state.yCss = y;
      this.pointSince = this.transitionSince = Number.NaN;
      if (sample.tCapture < this.cooldownUntil) {
        this.state.phase = 'idle';
        this.state.targetId = null;
        this.openSince = Number.NaN;
        return null;
      }
      const target = this.hitTarget(context, x, y);
      if (!target) {
        this.cancel(now);
        this.state.visible = true;
        this.state.phase = 'idle';
        return null;
      }
      if (
        target.id !== this.state.targetId ||
        !Number.isFinite(this.openSince) ||
        target.bounds.left !== this.targetBounds.left ||
        target.bounds.top !== this.targetBounds.top ||
        target.bounds.width !== this.targetBounds.width ||
        target.bounds.height !== this.targetBounds.height
      ) {
        this.state.targetId = target.id;
        this.openSince = sample.tCapture;
      }
      Object.assign(this.targetBounds, target.bounds);
      this.anchorX = x;
      this.anchorY = y;
      this.state.progress = Math.min(1, (sample.tCapture - this.openSince) / MENU_OPEN_ARM_MS);
      this.state.phase = this.state.progress >= 1 ? 'armed' : 'hover';
      return null;
    }
    if (this.state.phase === 'latched') return null;
    if (this.state.phase !== 'armed' && this.state.phase !== 'confirming') {
      this.cancel(now);
      this.state.visible = true;
      this.state.phase = 'idle';
      return null;
    }
    const target = context.targets.find((t) => t.id === this.state.targetId);
    if (
      !target ||
      !this.validTarget(target, context) ||
      target.bounds.left !== this.targetBounds.left ||
      target.bounds.top !== this.targetBounds.top ||
      target.bounds.width !== this.targetBounds.width ||
      target.bounds.height !== this.targetBounds.height ||
      Math.hypot(x - this.anchorX, y - this.anchorY) > MENU_POINT_MAX_MOVE_PX
    ) {
      this.cancel(now);
      return null;
    }
    this.state.xCss = this.anchorX;
    this.state.yCss = this.anchorY;
    if (sample.gesture !== 'point' || !confident) {
      if (this.state.phase === 'confirming') {
        this.cancel(now);
        return null;
      }
      if (!Number.isFinite(this.transitionSince)) this.transitionSince = sample.tCapture;
      if (sample.tCapture - this.transitionSince > MENU_TRANSITION_GRACE_MS) this.cancel(now);
      return null;
    }
    if (
      Number.isFinite(this.transitionSince) &&
      sample.tCapture - this.transitionSince > MENU_TRANSITION_GRACE_MS
    ) {
      this.cancel(now);
      return null;
    }
    if (!Number.isFinite(this.pointSince)) {
      this.pointSince = sample.tCapture;
      this.transitionSince = Number.NaN;
    }
    this.state.phase = 'confirming';
    this.state.progress = Math.min(1, (sample.tCapture - this.pointSince) / MENU_POINT_CONFIRM_MS);
    if (this.state.progress < 1) return null;
    this.state.phase = 'latched';
    this.openSince = Number.NaN;
    this.cooldownUntil = sample.tCapture + MENU_CLICK_COOLDOWN_MS;
    return {
      targetId: target.id,
      screenEpoch: this.screen,
      layoutEpoch: this.layout,
      hand: this.state.hand,
      tCapture: sample.tCapture,
    };
  }
  private validTarget(target: MenuTarget, context: MenuContext): boolean {
    return (
      target.enabled &&
      !target.nativeOnly &&
      target.screenEpoch === context.screenEpoch &&
      target.layoutEpoch === context.layoutEpoch
    );
  }
  private hitTarget(context: MenuContext, x: number, y: number): MenuTarget | null {
    for (let i = context.targets.length - 1; i >= 0; i--) {
      const t = context.targets[i]!;
      const b = t.bounds;
      if (x >= b.left && x <= b.left + b.width && y >= b.top && y <= b.top + b.height)
        return this.validTarget(t, context) ? t : null;
    }
    return null;
  }
}
