/** DOM geometry registry. All input sources resolve the same guarded semantic action. */
import type { MenuActivation, MenuContext, MenuTarget } from '../core/menuInput';
export type ActionSource = 'native' | 'hand';
export class MenuTargets {
  private entries = new Map<string, { element: HTMLButtonElement; run: (source: ActionSource) => void }>();
  private targets: MenuTarget[] = [];
  private dirty = true;
  private handEnabled = false;
  layoutEpoch = 0;
  screenEpoch = 0;
  constructor(private readonly onInvalidate: () => void) {}
  register(id: string, element: HTMLButtonElement, run: (source: ActionSource) => void): () => void {
    if (this.entries.has(id) && this.entries.get(id)?.element !== element)
      throw new Error(`Duplicate menu target: ${id}`);
    const registration = { element, run };
    this.entries.set(id, registration);
    this.invalidate();
    return () => {
      if (this.entries.get(id) === registration) {
        this.entries.delete(id);
        this.invalidate();
      }
    };
  }
  invalidate(): void {
    this.dirty = true;
    this.onInvalidate();
  }
  surface(epoch: number): void {
    if (epoch !== this.screenEpoch) {
      this.screenEpoch = epoch;
      this.invalidate();
    }
  }
  snapshot(enabled: boolean): MenuContext {
    this.handEnabled = enabled;
    if (this.dirty) {
      this.layoutEpoch++;
      this.targets.length = 0;
      for (const [id, { element }] of this.entries) {
        const rect = element.getBoundingClientRect();
        const visible =
          element.isConnected &&
          element.getClientRects().length > 0 &&
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < innerHeight &&
          rect.left < innerWidth;
        this.targets.push({
          id,
          bounds: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
          enabled: visible && !element.disabled && element.getAttribute('aria-busy') !== 'true',
          nativeOnly: element.dataset.nativeOnly === 'true',
          screenEpoch: this.screenEpoch,
          layoutEpoch: this.layoutEpoch,
        });
      }
      this.dirty = false;
    }
    return {
      enabled,
      screenEpoch: this.screenEpoch,
      layoutEpoch: this.layoutEpoch,
      viewport: { left: 0, top: 0, width: innerWidth, height: innerHeight },
      targets: this.targets,
    };
  }
  activate(id: string, source: ActionSource, request?: MenuActivation): boolean {
    const entry = this.entries.get(id);
    if (
      !entry ||
      entry.element.disabled ||
      !entry.element.isConnected ||
      entry.element.hidden ||
      entry.element.getAttribute('aria-busy') === 'true' ||
      entry.element.getClientRects().length === 0
    )
      return false;
    if (source === 'hand') {
      if (
        !this.handEnabled ||
        request?.targetId !== id ||
        !request ||
        request.screenEpoch !== this.screenEpoch ||
        request.layoutEpoch !== this.layoutEpoch ||
        this.dirty ||
        entry.element.dataset.nativeOnly === 'true'
      )
        return false;
      const saved = this.targets.find((t) => t.id === id);
      const rect = entry.element.getBoundingClientRect();
      if (
        !saved ||
        !saved.enabled ||
        rect.left !== saved.bounds.left ||
        rect.top !== saved.bounds.top ||
        rect.width !== saved.bounds.width ||
        rect.height !== saved.bounds.height
      ) {
        this.invalidate();
        return false;
      }
    }
    entry.run(source);
    return true;
  }
  dispose(): void {
    this.entries.clear();
    this.targets.length = 0;
  }
}
