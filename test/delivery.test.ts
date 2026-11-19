import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient } from "../src/core/client";
import type { ActiveSurvey } from "../src/core/client";
import { ApiClient, INGEST_TIMEOUT_MS, RETRY_BASE_MS, RETRY_MAX_MS } from "../src/core/apiClient";
import { memoryStorage } from "../src/core/storage";
import type { KeyValueStorage } from "../src/core/storage";
import type { Survey, SurveyResult } from "../src/core/types";

// When impressions are sent (as the survey appears, again on dismissal) and how
// queued ingest is retried (backoff timer, return to the foreground).

type Sent = { path: string; body: Record<string, Record<string, unknown>[]> };

let sent: Sent[];
/** Ingest outcome per call, in order; once empty, every call succeeds. */
let outcomes: ("ok" | "offline" | "hang" | number)[];

const settle = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  sent = [];
  outcomes = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: { body: string; signal?: AbortSignal }) => {
      const path = new URL(url).pathname;
      if (path === "/api/sdk/config") return { ok: false, status: 304, headers: { get: () => null }, text: async () => "" };
      const outcome = outcomes.shift() ?? "ok";
      if (outcome === "offline") throw new TypeError("Network request failed");
      if (outcome === "hang") {
        return new Promise((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }
      if (outcome !== "ok") return { ok: false, status: outcome, headers: { get: () => null }, text: async () => "" };
      sent.push({ path, body: JSON.parse(init.body) });
      return { ok: true, status: 200, headers: { get: () => null }, text: async () => "" };
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const survey = {
  id: "svy_1",
  name: "Checkout",
  questions: [{ id: "q1", order: 0, type: "THUMBS", prompt: "?", config: {} }],
  samplePercent: 100,
  maxPerUserDays: 0,
  platforms: [],
  triggers: [
    {
      id: "trg_1",
      type: "SINGLE",
      delaySeconds: 0,
      sequenceWindowSeconds: null,
      fireEvery: 1,
      warmupCount: 0,
      steps: [{ order: 0, event: "checkout_completed", match: {} }],
    },
  ],
} as unknown as Survey;

function cachedStorage(): KeyValueStorage {
  const kv = memoryStorage();
  const rawConfig = JSON.stringify({ projectId: "p1", surveys: [survey] });
  kv.setItem("com.microsurveys.config.cache", JSON.stringify({ rawConfig, etag: "e1", storedAt: Date.now() }));
  return kv;
}

/** A client whose foreground signal the test fires by hand. */
function newClient(kv: KeyValueStorage = cachedStorage()) {
  const foreground: (() => void)[] = [];
  const client = createClient({
    apiKey: "ms_test_x",
    storage: kv,
    platform: "ios",
    refreshOnForeground: false,
    subscribeForeground: (cb) => {
      foreground.push(cb);
      return () => foreground.splice(foreground.indexOf(cb), 1);
    },
  });
  return { client, foreground: () => foreground.forEach((cb) => cb()) };
}

const impressions = () => sent.filter((s) => s.path === "/api/sdk/impressions").map((s) => s.body.impressions![0]!);
const responses = () => sent.filter((s) => s.path === "/api/sdk/responses").map((s) => s.body.responses![0]!);

async function presented() {
  const { client } = newClient();
  client.start();
  let active: ActiveSurvey | null = null;
  client.onPresent((a) => (active = a));
  client.track("checkout_completed");
  await settle();
  if (!active) throw new Error("survey was not presented");
  return { client, active: active as ActiveSurvey };
}

const dismissed: SurveyResult = { answers: [], completed: false, dismissed: true };
const completed: SurveyResult = { answers: [{ questionId: "q1", value: { value: "up" } }], completed: true, dismissed: false };

describe("impression timing", () => {
  it("queues the impression when the survey is shown, before it closes", async () => {
    const { client, active } = await presented();
    expect(impressions()).toHaveLength(0);
    active.shown();
    active.shown(); // idempotent
    await settle();
    expect(impressions()).toHaveLength(1);
    expect(impressions()[0]).toMatchObject({ surveyId: "svy_1", triggerId: "trg_1", dismissed: false });
    expect(responses()).toHaveLength(0);
    client.stop();
  });

  it("re-sends the same impression with dismissed=true on a dismissal", async () => {
    const { client, active } = await presented();
    active.shown();
    await settle();
    vi.advanceTimersByTime(5_000);
    active.close(dismissed);
    await settle();
    const [shown, closed] = impressions();
    expect(impressions()).toHaveLength(2);
    expect(closed).toEqual({ ...shown, dismissed: true });
    expect(responses()).toHaveLength(0);
    client.stop();
  });

  it("doesn't re-send on completion; the response points at the impression", async () => {
    const { client, active } = await presented();
    active.shown();
    active.close(completed);
    await settle();
    expect(impressions()).toHaveLength(1);
    expect(impressions()[0]!.dismissed).toBe(false);
    expect(responses()[0]!.impressionId).toBe(impressions()[0]!.clientId);
    client.stop();
  });

  it("sends one impression at close when the host never reported it shown", async () => {
    const { client, active } = await presented();
    active.close(dismissed);
    await settle();
    expect(impressions()).toHaveLength(1);
    expect(impressions()[0]!.dismissed).toBe(true);
    client.stop();
  });

  it("a close without a result sends nothing more and frees the slot", async () => {
    const { client, active } = await presented();
    active.shown();
    active.close();
    active.close(dismissed); // already closed: ignored
    await settle();
    expect(impressions()).toHaveLength(1);
    expect(impressions()[0]!.dismissed).toBe(false);
    let next: ActiveSurvey | null = null;
    client.onPresent((a) => (next = a));
    client.track("checkout_completed");
    await settle();
    expect(next).not.toBeNull();
    client.stop();
  });

  it("inline surveys send the impression when shown too", async () => {
    const { client } = newClient();
    const inline = client.presentInline(survey);
    inline.shown();
    await settle();
    expect(impressions()).toHaveLength(1);
    expect("triggerId" in impressions()[0]!).toBe(false);
    inline.close(dismissed);
    await settle();
    expect(impressions()[1]).toEqual({ ...impressions()[0], dismissed: true });
  });
});

describe("ingest retry", () => {
  const record = (api: ApiClient) =>
    api.recordImpression({ surveyId: "s", triggerId: null, endUserId: "u", shownAt: new Date(), dismissed: false, context: { platform: "ios" } });

  it("retries a failed send on its own, without a new enqueue", async () => {
    const api = new ApiClient("ms_test_x", "https://example.test", memoryStorage());
    outcomes = ["offline"];
    record(api);
    await settle();
    expect(sent).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS);
    expect(sent).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("backs off 2 s, 4 s, 8 s … up to 30 s, and resets after a success", async () => {
    const api = new ApiClient("ms_test_x", "https://example.test", memoryStorage());
    outcomes = [503, 429, "offline", 503, 503, 503];
    record(api);
    await settle();
    const calls = () => vi.mocked(fetch).mock.calls.length;
    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS - 1);
    expect(calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls()).toBe(2);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(calls()).toBe(3);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(calls()).toBe(4);
    await vi.advanceTimersByTimeAsync(16_000);
    expect(calls()).toBe(5);
    await vi.advanceTimersByTimeAsync(RETRY_MAX_MS - 1);
    expect(calls()).toBe(5);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls()).toBe(6);
    await vi.advanceTimersByTimeAsync(RETRY_MAX_MS);
    expect(sent).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);

    outcomes = ["offline"];
    record(api);
    await settle();
    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS);
    expect(sent).toHaveLength(2);
  });

  it("drops an entry the server rejects with a 4xx, and keeps order", async () => {
    const api = new ApiClient("ms_test_x", "https://example.test", memoryStorage());
    outcomes = [400];
    record(api);
    const second = record(api);
    await settle();
    expect(sent.map((s) => s.body.impressions![0]!.clientId)).toEqual([second]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts a stalled request and retries it", async () => {
    const api = new ApiClient("ms_test_x", "https://example.test", memoryStorage());
    outcomes = ["hang"];
    record(api);
    await settle();
    await vi.advanceTimersByTimeAsync(INGEST_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS);
    expect(sent).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a flush asked for during a flush is joined, and sends what was queued", async () => {
    const api = new ApiClient("ms_test_x", "https://example.test", memoryStorage());
    record(api);
    const joined = api.flush();
    record(api);
    await joined;
    await settle();
    expect(sent).toHaveLength(2);
  });

  it("stop() clears the retry timer", async () => {
    const { client } = newClient();
    client.start();
    await settle();
    outcomes = ["offline", "offline"];
    client.presentInline(survey).shown();
    await settle();
    expect(vi.getTimerCount()).toBe(2); // event-count upload interval + the retry
    client.stop();
    await settle();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("flush on foreground", () => {
  it("flushes when the app comes back to the foreground, even with refreshOnForeground off", async () => {
    const { client, foreground } = newClient();
    client.start();
    await settle();
    outcomes = ["offline"];
    client.presentInline(survey).shown();
    await settle();
    expect(impressions()).toHaveLength(0);
    foreground();
    await settle();
    expect(impressions()).toHaveLength(1);
    client.stop();
  });
});
