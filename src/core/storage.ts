//
// storage.ts
//
// Primitives shared by the persistence layers. Every store takes a
// `KeyValueStorage`: AsyncStorage preloaded into memory (see ../asyncStorage.ts),
// or a synchronous store such as MMKV.
//

/** Synchronous string key/value storage the runtime persists into.
 *  Implementations should swallow their own errors
 *  (quota, disabled storage): persistence is best-effort. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Prefix of every key the runtime writes, so adapters can scope reads (e.g.
 *  preloading only MicroSurveys keys from an async store). */
export const STORAGE_KEY_PREFIX = "com.microsurveys.";

/** In-memory storage (nothing survives a restart). Useful for tests. */
export function memoryStorage(initial?: Record<string, string>): KeyValueStorage {
  const map = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

/** A v4 UUID, using `crypto.randomUUID` when available with a safe fallback. */
export function uuid(): string {
  try {
    // Hermes has no `crypto` unless a polyfill (e.g. expo-crypto) installs one.
    const crypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
    if (crypto && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  // RFC-4122-ish fallback.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Current time in **seconds** since the Unix epoch — matches the iOS runtime's
 *  `Date.timeIntervalSince1970`, which all persisted timestamps use. */
export function nowSeconds(): number {
  return Date.now() / 1000;
}
