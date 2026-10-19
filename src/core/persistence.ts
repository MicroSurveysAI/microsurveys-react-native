//
// persistence.ts
//
// On-device state so the SDK works immediately/offline and trigger progress
// survives reloads:
//   • ConfigStore       — the latest config JSON + parsed surveys/theme + ETag.
//   • TriggerStateStore — per-endUserId sequence progress, occurrence counters,
//     sticky sampling, and last-shown timestamps for the cap.
//
// Ports iOS `Persistence.swift`, backed by a `KeyValueStorage` instead of
// UserDefaults.
//

import type { KeyValueStorage } from "./storage";
import { parseConfig, newUserTriggerState } from "./types";
import type { SDKConfig, Survey, ProjectTheme, UserTriggerState } from "./types";

const CONFIG_KEY = "com.microsurveys.config.cache";
const STATE_PREFIX = "com.microsurveys.triggerstate.";

interface PersistedConfig {
  rawConfig: string; // raw response body — parsed losslessly on load
  etag: string | null;
  storedAt: number; // ms epoch
}

/** Persists the most recent `/api/sdk/config` result so the SDK can evaluate
 *  triggers and render surveys immediately on load, before/without a network
 *  refresh. We store the raw response text and re-parse it (lossless). */
export class ConfigStore {
  private persisted: PersistedConfig | null = null;
  private parsed: SDKConfig | null = null;

  constructor(private readonly kv: KeyValueStorage) {
    const data = kv.getItem(CONFIG_KEY);
    if (data) {
      try {
        const entry = JSON.parse(data) as PersistedConfig;
        if (entry && typeof entry.rawConfig === "string") {
          this.persisted = entry;
          this.parsed = parseConfig(entry.rawConfig);
        }
      } catch {
        /* corrupt cache — ignore */
      }
    }
  }

  get config(): SDKConfig | null {
    return this.parsed;
  }

  get surveys(): Survey[] {
    return this.parsed?.surveys ?? [];
  }

  get theme(): ProjectTheme | null {
    return this.parsed?.theme ?? null;
  }

  get etag(): string | null {
    return this.persisted?.etag ?? null;
  }

  /** When the cached config was last written (ms epoch), for TTL checks. */
  get storedAt(): number | null {
    return this.persisted?.storedAt ?? null;
  }

  /** Persists the raw config response and refreshes the in-memory parse. */
  save(rawConfig: string, etag: string | null): void {
    const entry: PersistedConfig = { rawConfig, etag, storedAt: Date.now() };
    this.persisted = entry;
    this.parsed = parseConfig(rawConfig);
    this.kv.setItem(CONFIG_KEY, JSON.stringify(entry));
  }
}

/** Loads/saves `UserTriggerState` keyed by `endUserId`. Cheap enough to read &
 *  rewrite the whole blob per evaluation for MVP volumes. */
export class TriggerStateStore {
  constructor(private readonly kv: KeyValueStorage) {}

  load(endUserId: string): UserTriggerState {
    const data = this.kv.getItem(STATE_PREFIX + endUserId);
    if (!data) return newUserTriggerState();
    try {
      const parsed = JSON.parse(data) as UserTriggerState;
      return { triggers: parsed.triggers ?? {}, surveys: parsed.surveys ?? {} };
    } catch {
      return newUserTriggerState();
    }
  }

  save(endUserId: string, state: UserTriggerState): void {
    this.kv.setItem(STATE_PREFIX + endUserId, JSON.stringify(state));
  }

  reset(endUserId: string): void {
    this.kv.removeItem(STATE_PREFIX + endUserId);
  }
}
