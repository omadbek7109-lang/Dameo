/** Tiny in-memory cache for heavy, slowly-changing reads (server load): one request in flight, reused for ttlMs. */
const store = new Map<string, { at: number; value?: unknown; p?: Promise<unknown> }>();

export function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const e = store.get(key);
  const now = Date.now();
  if (e?.p) return e.p as Promise<T>;
  if (e && 'value' in e && now - e.at < ttlMs) return Promise.resolve(e.value as T);
  const p = fn().then(
    (v) => {
      store.set(key, { at: Date.now(), value: v });
      return v;
    },
    (err) => {
      store.delete(key);
      throw err;
    },
  );
  store.set(key, { at: now, p });
  return p;
}
/** put a fresh value (e.g. after a full reload of the page that owns it) */
export function primeCache<T>(key: string, value: T) {
  store.set(key, { at: Date.now(), value });
}
/** forget every key starting with prefix (data changed) */
export function invalidateCache(prefix: string) {
  for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k);
}
