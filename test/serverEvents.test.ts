import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { advance } from "../src/core/triggerSequencer";
import { TriggerEngine } from "../src/core/triggerEngine";
import { TriggerStateStore } from "../src/core/persistence";
import { createClient } from "../src/core/client";
import { ApiClient } from "../src/core/apiClient";
import type { CreateClientOptions } from "../src/core/client";
import { debugKey } from "../src/core/debug";
import { memoryStorage } from "../src/core/storage";
import { parseConfig, newTriggerRecord } from "../src/core/types";
import type { Survey, Trigger } from "../src/core/types";

// Server events: events the app's backend sends to Amplitude wait in a mailbox
// (POST /api/sdk/pending). The SDK checks it on start, on foreground and on short
// timers, and replays what it gets into the engine at the time each event happened.

function sequence(window: number | null = 7200): Trigger {
  return {
    id: "t",
    type: "SEQUENCE",
    delaySeconds: 0,
    sequenceWindowSeconds: window,
    fireEvery: 1,
    warmupCount: 0,
    steps: [
      { order: 0, event: "book_click", match: {} },
      { order: 1, event: "journey_completed", match: {} },
    ],
  };
}

function survey(trigger: Trigger = sequence()): Survey {
  return { id: "svy_1", name: "Test", questions: [], samplePercent: 100, maxPerUserDays: 0, platforms: [], triggers: [trigger] };
}

const T = 1_800_000_000; // unix seconds

describe("config", () => {
  it("parses pendingEvents and serverEvents", () => {
    const c = parseConfig(JSON.stringify({ projectId: "p1", surveys: [], pendingEvents: true, serverEvents: ["journey_completed", 3] }))!;
    expect(c.pendingEvents).toBe(true);
    expect(c.serverEvents).toEqual(["journey_completed"]);
  });

  it("treats missing fields as off", () => {
    const c = parseConfig(JSON.stringify({ projectId: "p1", surveys: [] }))!;
    expect(c.pendingEvents).toBe(false);
    expect(c.serverEvents).toEqual([]);
  });
});

describe("sequencer event time", () => {
  it("ignores a later step that happened before the sequence started, without resetting", () => {
    const started = { ...newTriggerRecord(), stepIndex: 1, startedAt: T };
    const early = advance(sequence(), started, "journey_completed", {}, T - 60);
    expect(early.satisfied).toBe(false);
    expect(early.record).toEqual(started);

    const onTime = advance(sequence(), started, "journey_completed", {}, T);
    expect(onTime.satisfied).toBe(true);
  });
});

describe("engine event time", () => {
  function engine(now: () => number) {
    const presented: string[] = [];
    const e = new TriggerEngine({
      store: new TriggerStateStore(memoryStorage()),
      surveysProvider: () => [survey()],
      identityProvider: () => ({ anonymousId: "u1", userProperties: {} }),
      onPresent: (s) => presented.push(s.id),
      platform: "ios",
      now,
    });
    return { e, presented };
  }

  it("measures the sequence window by when events happened, not when they arrived", () => {
    vi.useFakeTimers();
    let now = T;
    const { e, presented } = engine(() => now);
    e.process("book_click");
    now = T + 20 * 3600; // the app opens the next morning
    e.process("journey_completed", {}, T + 40 * 60); // replayed: finished 40 min after booking
    vi.runAllTimers();
    vi.useRealTimers();
    expect(presented).toEqual(["svy_1"]);
  });

  it("still lapses the window for a live event at the same moment", () => {
    vi.useFakeTimers();
    let now = T;
    const { e, presented } = engine(() => now);
    e.process("book_click");
    now = T + 20 * 3600;
    e.process("journey_completed");
    vi.runAllTimers();
    vi.useRealTimers();
    expect(presented).toEqual([]);
  });
});

// ── Client: fetchPending, scheduling and replay ───────────────────────────────

interface Call {
  path: string;
  method: string;
  body: Record<string, unknown> | null;
}

let calls: Call[];
/** What the next `/api/sdk/pending` calls return; empty when exhausted. */
let pendingPages: unknown[][];
/** When set, `/api/sdk/pending` never answers (to test overlap). */
let pendingHangs: boolean;

function reply(status: number, json: unknown = {}) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(), json: async () => json, text: async () => JSON.stringify(json) };
}

beforeEach(() => {
  calls = [];
  pendingPages = [];
  pendingHangs = false;
  vi.useFakeTimers();
  vi.setSystemTime(T * 1000);
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      const path = new URL(url).pathname;
      calls.push({ path, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body as string) : null });
      if (path === "/api/sdk/config") return Promise.resolve(reply(304));
      if (path === "/api/sdk/pending") {
        if (pendingHangs) return new Promise(() => {});
        return Promise.resolve(reply(200, { events: pendingPages.shift() ?? [] }));
      }
      return Promise.resolve(reply(200));
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

const pendingCalls = () => calls.filter((c) => c.path === "/api/sdk/pending");

function storageWithConfig(extra: Record<string, unknown> = {}) {
  const kv = memoryStorage();
  const rawConfig = JSON.stringify({ projectId: "p1", surveys: [survey()], pendingEvents: true, serverEvents: ["journey_completed"], ...extra });
  kv.setItem("com.microsurveys.config.cache", JSON.stringify({ rawConfig, etag: null, storedAt: Date.now() }));
  return kv;
}

function lifecycleClient(over: Partial<CreateClientOptions> = {}) {
  let foreground: () => void = () => {};
  let background: () => void = () => {};
  const client = createClient({
    apiKey: "ms_test_x",
    storage: storageWithConfig(),
    platform: "ios",
    subscribeForeground: (cb) => {
      foreground = cb;
      return () => {};
    },
    subscribeBackground: (cb) => {
      background = cb;
      return () => {};
    },
    ...over,
  });
  client.identify("u1");
  return { client, foreground: () => foreground(), background: () => background() };
}

describe("fetchPending", () => {
  it("sends the analytics ids, falling back to the identify() user id, and omits nulls", async () => {
    const { client } = lifecycleClient();
    client.updateAnalyticsIdentity({ deviceId: "d1" });
    client.start();
    await settle();
    client.stop();
    expect(pendingCalls()[0]).toMatchObject({ method: "POST", body: { userId: "u1", deviceId: "d1" } });

    const api = new ApiClient("ms_test_x", "https://example.test", memoryStorage());
    await api.fetchPending({ userId: null, deviceId: "d2" });
    expect(pendingCalls()[1]?.body).toEqual({ deviceId: "d2" });
  });

  it("makes no request without a user or device id", async () => {
    const api = new ApiClient("ms_test_x", "https://example.test", memoryStorage());
    expect(await api.fetchPending({ userId: null, deviceId: null })).toEqual([]);
    expect(pendingCalls()).toHaveLength(0);
  });

  it("calls once more when a full page of 50 comes back", async () => {
    const page = Array.from({ length: 50 }, (_, i) => ({ id: `e${i}`, name: "other", properties: {}, occurredAt: new Date(T * 1000).toISOString() }));
    pendingPages = [page, page];
    const { client } = lifecycleClient();
    client.start();
    await settle();
    client.stop();
    expect(pendingCalls()).toHaveLength(2);
  });
});

describe("mailbox scheduling", () => {
  it("checks after the start refresh, then 30 s and 90 s later, then every 5 minutes", async () => {
    const { client } = lifecycleClient();
    client.start();
    await settle();
    expect(pendingCalls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(pendingCalls()).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pendingCalls()).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 90_000);
    expect(pendingCalls()).toHaveLength(4);
    client.stop();
  });

  it("checks on every foreground even with a fresh config, and when refreshOnForeground is off", async () => {
    for (const refreshOnForeground of [true, false]) {
      calls = [];
      const { client, foreground } = lifecycleClient({ refreshOnForeground });
      client.start();
      await settle();
      foreground();
      await settle();
      expect(pendingCalls()).toHaveLength(2);
      // The config is fresh, so the foreground didn't refetch it.
      expect(calls.filter((c) => c.path === "/api/sdk/config")).toHaveLength(1);
      client.stop();
    }
  });

  it("does nothing when the config has no pendingEvents", async () => {
    const { client, foreground } = lifecycleClient({ storage: storageWithConfig({ pendingEvents: false }) });
    client.start();
    await settle();
    foreground();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    client.stop();
    expect(pendingCalls()).toHaveLength(0);
  });

  it("clears its timers in the background and on stop", async () => {
    const { client, background } = lifecycleClient();
    client.start();
    await settle();
    background();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(pendingCalls()).toHaveLength(1);

    const second = lifecycleClient();
    calls = [];
    second.client.start();
    await settle();
    second.client.stop();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(pendingCalls()).toHaveLength(1);
    client.stop();
  });

  it("keeps one request in flight", async () => {
    pendingHangs = true;
    const { client, foreground } = lifecycleClient();
    client.start();
    await settle();
    foreground();
    foreground();
    await vi.advanceTimersByTimeAsync(90_000);
    client.stop();
    expect(pendingCalls()).toHaveLength(1);
  });

  it("checks every 60 s while a sequence waits on a server event, for up to 3 hours", async () => {
    const { client } = lifecycleClient();
    client.start();
    await settle();
    client.track("book_click");
    await vi.advanceTimersByTimeAsync(90_000); // start, 30 s, 60 s (waiting), 90 s
    expect(pendingCalls()).toHaveLength(4);
    await vi.advanceTimersByTimeAsync(60_000); // 120 s (waiting)
    expect(pendingCalls()).toHaveLength(5);

    await vi.advanceTimersByTimeAsync(3 * 3600_000); // waiting ends 3 h after book_click
    const before = pendingCalls().length;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(pendingCalls().length - before).toBe(2); // only the 5-minute checks
    client.stop();
  });
});

describe("replay", () => {
  it("completes a sequence with a server event and isn't counted in event signals", async () => {
    const { client } = lifecycleClient({ storage: storageWithConfig({ eventSignals: true }) });
    const presented: string[] = [];
    client.onPresent((a) => presented.push(a.survey.id));
    client.start();
    await settle();
    client.track("book_click");
    client.flushEventCounts();
    await settle();
    calls = [];

    pendingPages = [[{ id: "e1", name: "journey_completed", properties: {}, occurredAt: new Date((T + 40 * 60) * 1000).toISOString() }]];
    await vi.advanceTimersByTimeAsync(30_000); // the 30 s follow-up picks it up
    await settle();
    await vi.advanceTimersByTimeAsync(1_000); // delaySeconds: 0
    client.flushEventCounts();
    await settle();
    client.stop();

    expect(presented).toEqual(["svy_1"]);
    expect(calls.some((c) => c.path === "/api/sdk/events")).toBe(false);
  });

  it("replays in occurredAt order", async () => {
    const { client } = lifecycleClient();
    const presented: string[] = [];
    client.onPresent((a) => presented.push(a.survey.id));
    pendingPages = [
      [
        { id: "e2", name: "journey_completed", properties: {}, occurredAt: new Date((T + 60) * 1000).toISOString() },
        { id: "e1", name: "book_click", properties: {}, occurredAt: new Date(T * 1000).toISOString() },
      ],
    ];
    client.start();
    await settle();
    await vi.advanceTimersByTimeAsync(0);
    client.stop();
    expect(presented).toEqual(["svy_1"]);
  });

  it("reports replayed events to the live debugger at the time they happened", async () => {
    const { client } = lifecycleClient({ storage: storageWithConfig({ debugUsers: [debugKey("p1", "u1")] }) });
    const occurredAt = new Date((T - 600) * 1000).toISOString();
    pendingPages = [[{ id: "e1", name: "book_click", properties: { flow: "airport" }, occurredAt }]];
    client.start();
    await settle();
    await (client as unknown as { api: ApiClient }).api.flush();
    client.stop();
    const entry = calls.find((c) => c.path === "/api/sdk/debug")?.body?.entries as { at: string; event: string }[];
    expect(entry).toMatchObject([{ at: occurredAt, event: "book_click" }]);
  });
});
