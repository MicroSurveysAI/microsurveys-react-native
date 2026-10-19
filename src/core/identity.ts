//
// identity.ts
//
// Maintains the current `Identity` snapshot the engine evaluates against,
// merging signals from an analytics SDK (Amplitude userId/deviceId/identify
// properties) and the host (`identify`). Mints/persists a stable anonymous id
// so cap + trigger state stay consistent across reloads before any user is
// identified. Port of iOS `IdentityStore`.
//

import { uuid } from "./storage";
import type { KeyValueStorage } from "./storage";
import type { Identity, Json, JsonObject } from "./types";

const ANON_KEY = "com.microsurveys.anonymousId";
const PROPS_KEY = "com.microsurveys.userProperties";

/** An identity update from an analytics SDK (e.g. the Amplitude plugin). Any
 *  field may be absent when unknown; absent fields leave the current value. */
export interface AnalyticsIdentity {
  userId?: string | null;
  deviceId?: string | null;
  /** Properties to merge into the user properties (`$set` semantics). */
  userProperties?: Record<string, unknown> | null;
  /** Properties to set only where not already present (`$setOnce` semantics). */
  setOnceProperties?: Record<string, unknown> | null;
  /** Property keys to remove (`$unset` semantics). */
  unsetProperties?: string[] | null;
}

export class IdentityStore {
  private identity: Identity;

  constructor(private readonly kv: KeyValueStorage) {
    let anon = kv.getItem(ANON_KEY);
    if (!anon) {
      anon = "anon_" + uuid();
      kv.setItem(ANON_KEY, anon);
    }
    let userProperties: JsonObject = {};
    const props = kv.getItem(PROPS_KEY);
    if (props) {
      try {
        const parsed = JSON.parse(props) as JsonObject;
        if (parsed && typeof parsed === "object") userProperties = parsed;
      } catch {
        /* ignore */
      }
    }
    this.identity = { anonymousId: anon, userProperties };
  }

  /** Thread-safe not required (single-threaded JS); returns a shallow snapshot. */
  snapshot(): Identity {
    return { ...this.identity, userProperties: { ...this.identity.userProperties } };
  }

  /** Apply a host `identify(id, properties)` call. Merges properties. */
  setUser(id: string | null | undefined, properties?: Record<string, unknown>): void {
    if (id) this.identity.hostUserId = id;
    if (properties) {
      for (const key of Object.keys(properties)) {
        this.identity.userProperties[key] = toJson(properties[key]);
      }
      this.persistProperties();
    }
  }

  /** Merge an analytics identity update. Called per event, so it only persists
   *  when the properties actually changed. */
  updateFromAnalytics(update: AnalyticsIdentity): void {
    if (update.userId) this.identity.amplitudeUserId = update.userId;
    if (update.deviceId) this.identity.amplitudeDeviceId = update.deviceId;
    let changed = false;
    if (update.userProperties) {
      for (const key of Object.keys(update.userProperties)) {
        const value = toJson(update.userProperties[key]);
        if (JSON.stringify(this.identity.userProperties[key]) !== JSON.stringify(value)) {
          this.identity.userProperties[key] = value;
          changed = true;
        }
      }
    }
    if (update.setOnceProperties) {
      for (const key of Object.keys(update.setOnceProperties)) {
        if (key in this.identity.userProperties) continue;
        this.identity.userProperties[key] = toJson(update.setOnceProperties[key]);
        changed = true;
      }
    }
    for (const key of update.unsetProperties ?? []) {
      if (key in this.identity.userProperties) {
        delete this.identity.userProperties[key];
        changed = true;
      }
    }
    if (changed) this.persistProperties();
  }

  private persistProperties(): void {
    this.kv.setItem(PROPS_KEY, JSON.stringify(this.identity.userProperties));
  }
}

/** Best-effort conversion of an arbitrary host value into a JSON value, for
 *  snapshotting user properties (port of iOS `JSONValue(any:)`). */
function toJson(value: unknown): Json {
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return value;
    case "object":
      if (Array.isArray(value)) return value.map(toJson);
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, toJson(v)]));
    default:
      return String(value);
  }
}
