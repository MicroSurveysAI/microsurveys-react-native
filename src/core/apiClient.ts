//
// apiClient.ts
//
// `fetch`-based client for the SDK endpoints plus outbox flush. Every
// impression/response carries a UUID `clientId` so the server upserts and
// retries never duplicate (API-CONTRACT §Idempotency). Port of iOS `APIClient`.
//

import { Outbox } from "./outbox";
import { uuid } from "./storage";
import type { KeyValueStorage } from "./storage";
import type { EventCount } from "./eventCounter";
import type { DebugEntry } from "./debug";
import { parseConfig } from "./types";
import type { SDKConfig, SurveyAnswer, JsonObject, DeviceContext } from "./types";

const API_VERSION = "2026-06-30";

export type ConfigFetchResult =
  | { kind: "notModified" }
  | { kind: "config"; rawText: string; config: SDKConfig | null; etag: string | null };

/** One server event waiting in the mailbox (API-CONTRACT §6). */
export interface PendingEvent {
  id: string;
  name: string;
  properties: Record<string, unknown>;
  /** ISO 8601: when it happened, not when it arrived. */
  occurredAt: string;
}

/** The most events `/api/sdk/pending` returns per call. */
export const PENDING_PAGE_SIZE = 50;

export class ApiClient {
  private readonly apiKey: string;
  private readonly baseURL: string;
  private readonly outbox: Outbox;
  private isFlushing = false;

  constructor(apiKey: string, baseURL: string, storage: KeyValueStorage) {
    this.apiKey = apiKey;
    this.outbox = new Outbox(storage);
    // Normalize: no trailing slash so `${base}${path}` is clean.
    this.baseURL = baseURL.replace(/\/+$/, "");
  }

  // ── Config ─────────────────────────────────────────────────────────────────

  /** `GET /api/sdk/config` with optional `If-None-Match`. Resolves `notModified`
   *  on 304 so the caller keeps its cache. Throws on network/5xx errors. */
  async fetchConfig(etag: string | null): Promise<ConfigFetchResult> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "MS-Api-Version": API_VERSION,
    };
    if (etag) headers["If-None-Match"] = etag;

    const res = await fetch(this.endpoint("/api/sdk/config"), { method: "GET", headers });
    if (res.status === 304) return { kind: "notModified" };
    if (!res.ok) throw new Error(`config fetch failed: ${res.status}`);

    const rawText = await res.text();
    return { kind: "config", rawText, config: parseConfig(rawText), etag: res.headers.get("ETag") };
  }

  // ── Server events mailbox ───────────────────────────────────────────────────

  /** `POST /api/sdk/pending`: the server events waiting for this user, oldest
   *  first. Each is handed out once, so this is not queued in the outbox. Resolves
   *  `[]` without a request when there's no id to ask for. Throws on network/HTTP
   *  errors; malformed entries are dropped. */
  async fetchPending(ids: { userId: string | null; deviceId: string | null }): Promise<PendingEvent[]> {
    const body: Record<string, string> = {};
    if (ids.userId) body.userId = ids.userId;
    if (ids.deviceId) body.deviceId = ids.deviceId;
    if (Object.keys(body).length === 0) return [];

    const res = await fetch(this.endpoint("/api/sdk/pending"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "MS-Api-Version": API_VERSION,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`pending fetch failed: ${res.status}`);

    const root = (await res.json()) as { events?: unknown };
    const events = Array.isArray(root?.events) ? root.events : [];
    return events.flatMap((raw): PendingEvent[] => {
      const e = raw as Record<string, unknown> | null;
      if (!e || typeof e.id !== "string" || typeof e.name !== "string" || typeof e.occurredAt !== "string") return [];
      if (Number.isNaN(Date.parse(e.occurredAt))) return [];
      const properties =
        e.properties && typeof e.properties === "object" && !Array.isArray(e.properties)
          ? (e.properties as Record<string, unknown>)
          : {};
      return [{ id: e.id, name: e.name, properties, occurredAt: e.occurredAt }];
    });
  }

  // ── Impressions / responses ─────────────────────────────────────────────────

  /** Queues the impression and returns its `clientId`, so the response from the
   *  same showing can point back to it. */
  recordImpression(input: {
    surveyId: string;
    triggerId: string | null;
    endUserId: string;
    shownAt: Date;
    dismissed: boolean;
    context: DeviceContext;
  }): string {
    const clientId = uuid();
    const payload = {
      clientId,
      surveyId: input.surveyId,
      triggerId: input.triggerId ?? undefined,
      endUserId: input.endUserId,
      shownAt: input.shownAt.toISOString(),
      dismissed: input.dismissed,
      context: input.context,
    };
    this.enqueue("/api/sdk/impressions", { impressions: [payload] });
    return clientId;
  }

  recordResponse(input: {
    surveyId: string;
    endUserId: string;
    completed: boolean;
    submittedAt: Date;
    userProps: JsonObject;
    impressionId: string;
    triggerId: string | null;
    context: DeviceContext;
    answers: SurveyAnswer[];
  }): void {
    const payload = {
      clientId: uuid(),
      surveyId: input.surveyId,
      endUserId: input.endUserId,
      completed: input.completed,
      submittedAt: input.submittedAt.toISOString(),
      userProps: input.userProps,
      impressionId: input.impressionId,
      triggerId: input.triggerId ?? undefined,
      context: input.context,
      answers: input.answers,
    };
    this.enqueue("/api/sdk/responses", { responses: [payload] });
  }

  // ── Event signals ─────────────────────────────────────────────────────────

  /** Queues one upload window of event counts. No clientId: a re-sent batch
   *  can count twice, which is fine for "last seen" and trend lines. */
  recordEventCounts(events: EventCount[], context: DeviceContext & { sdkVersion: string }): void {
    if (events.length === 0) return;
    this.enqueue("/api/sdk/events", { events, context });
  }

  // ── Live debugger ─────────────────────────────────────────────────────────

  /** Sends one debugger entry from a test device. */
  recordDebug(entry: DebugEntry, endUserId: string, context: DeviceContext & { sdkVersion: string }): void {
    this.enqueue("/api/sdk/debug", { entries: [entry], endUserId, context });
  }

  private enqueue(path: string, value: unknown): void {
    this.outbox.enqueue(path, JSON.stringify(value));
    void this.flush();
  }

  // ── Flush ────────────────────────────────────────────────────────────────────

  /** POSTs queued entries in order. Stops at the first retryable failure (likely
   *  offline) and leaves the rest for next time. Entries queued while a flush is
   *  running are sent by the same flush, so nothing waits for the next event.
   *  Idempotency keys make re-sends safe. Never throws. */
  async flush(): Promise<void> {
    if (this.isFlushing) return;
    this.isFlushing = true;
    try {
      // Guards against re-sending an entry whose removal didn't persist (storage full).
      const sent = new Set<string>();
      for (;;) {
        const pending = this.outbox.snapshot().filter((e) => !sent.has(e.id));
        if (pending.length === 0) break;
        let failed = false;
        for (const entry of pending) {
          try {
            await this.post(entry.path, entry.body);
            this.outbox.remove(entry.id);
            sent.add(entry.id);
          } catch {
            failed = true; // network/server problem — retry on the next flush
            break;
          }
        }
        if (failed) break;
      }
    } finally {
      this.isFlushing = false;
    }
  }

  private async post(path: string, body: string): Promise<void> {
    const res = await fetch(this.endpoint(path), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "MS-Api-Version": API_VERSION,
        "Content-Type": "application/json; charset=utf-8",
      },
      body,
    });
    // 429/5xx → throw to retry later. Other 4xx are permanent for this body;
    // treat as done so we don't wedge the queue (matches iOS retry rules).
    if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
      throw new Error(`retryable ${res.status}`);
    }
  }

  private endpoint(path: string): string {
    return this.baseURL + path;
  }
}
