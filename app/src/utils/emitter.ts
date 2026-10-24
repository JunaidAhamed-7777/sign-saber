/** Synchronous typed events; returned disposers are idempotent. */
export class TypedEmitter<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<(value: never) => void>>();
  on<K extends keyof Events>(name: K, listener: (value: Events[K]) => void): () => void {
    let set = this.listeners.get(name);
    if (!set) { set = new Set(); this.listeners.set(name, set); }
    set.add(listener as (value: never) => void);
    return () => { set.delete(listener as (value: never) => void); if (!set.size) this.listeners.delete(name); };
  }
  emit<K extends keyof Events>(name: K, value: Events[K]): void {
    const set = this.listeners.get(name);
    if (set) for (const listener of [...set]) listener(value as never);
  }
  clear(): void { this.listeners.clear(); }
  get listenerCount(): number { let count = 0; for (const set of this.listeners.values()) count += set.size; return count; }
}
