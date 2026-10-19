//
// outbox.ts
//
// FIFO, persisted queue of pending POSTs (impressions/responses), so
// ingest survives offline reloads and flushes on the next start. Each entry
// carries a UUID so it can be removed after a successful send. Port of the
// `Outbox` in iOS `APIClient.swift`.
//

import { uuid } from "./storage";
import type { KeyValueStorage } from "./storage";

const KEY = "com.microsurveys.outbox";
const MAX_ENTRIES = 200;

export interface OutboxEntry {
  id: string;
  path: string; // e.g. "/api/sdk/impressions"
  body: string; // pre-encoded JSON body
}

export class Outbox {
  constructor(private readonly kv: KeyValueStorage) {}

  private read(): OutboxEntry[] {
    const data = this.kv.getItem(KEY);
    if (!data) return [];
    try {
      const parsed = JSON.parse(data) as OutboxEntry[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private write(entries: OutboxEntry[]): void {
    this.kv.setItem(KEY, JSON.stringify(entries));
  }

  enqueue(path: string, body: string): void {
    const entries = this.read();
    entries.push({ id: uuid(), path, body });
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    this.write(entries);
  }

  snapshot(): OutboxEntry[] {
    return this.read();
  }

  remove(id: string): void {
    this.write(this.read().filter((e) => e.id !== id));
  }
}
