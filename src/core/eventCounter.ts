//
// eventCounter.ts
//
// Counts tracked events between uploads so the dashboard can show which events
// the app actually sends, how often, and from which platform ("event signals").
// Only sent when the project turns event signals on (config `eventSignals`).
//
// What leaves the device: each event name, how many times it fired since the
// last upload, when it was first and last seen in that window, and up to
// MAX_KEYS property *names*. Never property values, never a user id.
//

/** Distinct event names held per upload window; names past this are dropped
 *  until the next upload, so a buggy loop of unique names can't grow memory. */
export const MAX_NAMES = 200;
/** Property names kept per event. */
export const MAX_KEYS = 20;
const MAX_NAME_LENGTH = 200;
const MAX_KEY_LENGTH = 100;

export interface EventCount {
  name: string;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  propertyKeys: string[];
}

interface Entry {
  count: number;
  first: number;
  last: number;
  keys: Set<string>;
}

export class EventCounter {
  private entries = new Map<string, Entry>();

  get size(): number {
    return this.entries.size;
  }

  record(name: string, properties: Record<string, unknown> = {}, now: number = Date.now()): void {
    if (!name || name.length > MAX_NAME_LENGTH) return;
    let e = this.entries.get(name);
    if (!e) {
      if (this.entries.size >= MAX_NAMES) return;
      e = { count: 0, first: now, last: now, keys: new Set() };
      this.entries.set(name, e);
    }
    e.count += 1;
    e.last = Math.max(e.last, now);
    for (const key of Object.keys(properties)) {
      if (e.keys.size >= MAX_KEYS) break;
      if (key && key.length <= MAX_KEY_LENGTH) e.keys.add(key);
    }
  }

  /** Everything counted since the last drain, and a fresh window. */
  drain(): EventCount[] {
    const out = [...this.entries].map(([name, e]) => ({
      name,
      count: e.count,
      firstSeenAt: new Date(e.first).toISOString(),
      lastSeenAt: new Date(e.last).toISOString(),
      propertyKeys: [...e.keys],
    }));
    this.entries = new Map();
    return out;
  }
}
