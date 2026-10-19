//
// asyncStorage.ts
//
// The engine reads its stores synchronously (config cache, identity,
// trigger state, outbox), but React Native's AsyncStorage is async. This adapter
// preloads every MicroSurveys key into memory once, then serves reads from
// memory and writes through to AsyncStorage in order. Writes are best-effort:
// a failed write only loses persistence, never breaks the running SDK.
//

import { STORAGE_KEY_PREFIX } from "./core";
import type { KeyValueStorage } from "./core";

/** The subset of AsyncStorage this SDK needs. Matches
 *  `@react-native-async-storage/async-storage` v1, v2 (`multiGet`) and v3
 *  (`getMany`), or any store with the same shape. */
export interface AsyncKeyValueStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
  /** v3 batch read. */
  getMany?(keys: string[]): Promise<Record<string, string | null>>;
  /** v1/v2 batch read. */
  multiGet?(keys: readonly string[]): Promise<readonly (readonly [string, string | null])[]>;
}

/** Loads every MicroSurveys key from `store` and returns a synchronous view of
 *  it for the runtime. Never rejects: if the store can't be read, the SDK
 *  starts with empty state. */
export async function hydrateAsyncStorage(store: AsyncKeyValueStorage): Promise<KeyValueStorage> {
  const cache = new Map<string, string>();
  try {
    const keys = (await store.getAllKeys()).filter((k) => k.startsWith(STORAGE_KEY_PREFIX));
    for (const [key, value] of await readMany(store, keys)) {
      if (value !== null) cache.set(key, value);
    }
  } catch {
    // Unreadable store: start empty rather than not at all.
  }

  // One write chain, so writes land in the order the runtime made them.
  let chain: Promise<void> = Promise.resolve();
  const enqueue = (write: () => Promise<void>) => {
    chain = chain.then(write).catch(() => {});
  };

  return {
    getItem: (key) => cache.get(key) ?? null,
    setItem(key, value) {
      cache.set(key, value);
      enqueue(() => store.setItem(key, value));
    },
    removeItem(key) {
      cache.delete(key);
      enqueue(() => store.removeItem(key));
    },
  };
}

async function readMany(store: AsyncKeyValueStorage, keys: string[]): Promise<[string, string | null][]> {
  if (keys.length === 0) return [];
  if (store.getMany) return Object.entries(await store.getMany(keys));
  if (store.multiGet) return (await store.multiGet(keys)).map(([k, v]) => [k, v]);
  return Promise.all(keys.map(async (k): Promise<[string, string | null]> => [k, await store.getItem(k)]));
}
