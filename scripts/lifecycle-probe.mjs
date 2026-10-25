/** Observer IDs/callback counts only. Native CDP measures AudioNodes, workers and DOM listeners. */
export function installLifecycleProbe() {
  let next = 1,
    rafCallbacks = 0;
  const observers = new Set();
  for (const name of ["ResizeObserver", "MutationObserver"]) {
    const Native = window[name];
    if (!Native) continue;
    window[name] = new Proxy(Native, {
      construct(Target, args) {
        const observer = new Target(...args),
          token = next++,
          observe = observer.observe,
          disconnect = observer.disconnect;
        observer.observe = function (...values) {
          const result = observe.apply(this, values);
          observers.add(token);
          return result;
        };
        observer.disconnect = function (...values) {
          observers.delete(token);
          return disconnect.apply(this, values);
        };
        return observer;
      },
    });
  }
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = function (callback) {
    return raf.call(this, (time) => {
      rafCallbacks++;
      callback(time);
    });
  };
  window.__lifecycleProbe = Object.freeze({
    snapshot() {
      return { observers: observers.size, rafCallbacks };
    },
  });
}

export function cacheFailureScript(mode) {
  if (!["unavailable", "quota"].includes(mode))
    throw new Error("Unknown cache failure mode");
  if (mode === "unavailable")
    return `Object.defineProperty(window, 'indexedDB', { configurable: true, get() { throw new DOMException('Lifecycle QA: storage unavailable', 'SecurityError'); } });`;
  return `const realOpen = indexedDB.open.bind(indexedDB); indexedDB.open = (...args) => {
    const request = realOpen(...args); request.addEventListener('success', () => {
      const db = request.result, transaction = db.transaction.bind(db);
      db.transaction = (...values) => { if (values[1] === 'readwrite') throw new DOMException('Lifecycle QA: quota exhausted', 'QuotaExceededError'); return transaction(...values); };
    }); return request;
  };`;
}
