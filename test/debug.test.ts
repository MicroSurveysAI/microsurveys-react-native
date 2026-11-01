import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TriggerEngine } from "../src/core/triggerEngine";
import type { Decision } from "../src/core/triggerEngine";
import { TriggerStateStore } from "../src/core/persistence";
import { createClient } from "../src/core/client";
import { ApiClient } from "../src/core/apiClient";
import { debugKey } from "../src/core/debug";
import { memoryStorage } from "../src/core/storage";
import type { Survey, TriggerStep } from "../src/core/types";

// The live debugger: why the engine did or didn't schedule each survey for an
// event, reported only from test devices the dashboard picked.

function survey(over: Partial<Survey> = {}, steps: TriggerStep[] = [{ order: 0, event: "checkout", match: {} }]): Survey {
  return {
    id: "svy_1",
    name: "Test",
    questions: [],
    samplePercent: 100,
    maxPerUserDays: 0,
    platforms: [],
    triggers: [{ id: "t", type: "SINGLE", delaySeconds: 2, sequenceWindowSeconds: null, fireEvery: 1, warmupCount: 0, steps }],
    ...over,
  } as Survey;
}

function decide(s: Survey, name: string, props: Record<string, unknown> = {}): Decision[] {
  const decisions: Decision[] = [];
  const engine = new TriggerEngine({
    store: new TriggerStateStore(memoryStorage()),
    surveysProvider: () => [s],
    identityProvider: () => ({ anonymousId: "u1", userProperties: {} }),
    onPresent: () => {},
    platform: "android",
    now: () => 1_000,
    onDecision: (d) => decisions.push(d),
  });
  engine.process(name, props);
  engine.stop();
  return decisions;
}

let sent: { path: string; body: Record<string, unknown> }[];

beforeEach(() => {
  sent = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ path: new URL(url).pathname, body: JSON.parse(init.body as string) });
      return new Response("{}", { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("engine decisions", () => {
  it("reports eligible, property mismatches and platform skips", () => {
    expect(decide(survey(), "checkout")).toEqual([{ surveyId: "svy_1", triggerId: "t", reason: "eligible", delaySeconds: 2 }]);
    expect(decide(survey({}, [{ order: 0, event: "checkout", match: { screen: "cart" } }]), "checkout").map((d) => d.reason)).toEqual([
      "property_mismatch",
    ]);
    expect(decide(survey({ platforms: ["ios"] }), "checkout").map((d) => d.reason)).toEqual(["platform"]);
    expect(decide(survey(), "app_opened")).toEqual([]);
  });
});

describe("debugKey", () => {
  it("is the same FNV-1a hash every SDK computes", () => {
    expect(debugKey("p1", "u1")).toBe("309cd11f");
  });
});

describe("client debugger", () => {
  function client(debugUsers: string[]) {
    const kv = memoryStorage();
    const rawConfig = JSON.stringify({ projectId: "p1", surveys: [survey()], debugUsers });
    kv.setItem("com.microsurveys.config.cache", JSON.stringify({ rawConfig, etag: null, storedAt: Date.now() }));
    const c = createClient({ apiKey: "ms_test_x", storage: kv, platform: "android", subscribeForeground: () => () => {}, refreshOnForeground: false });
    c.identify("u1");
    return c;
  }

  async function settle(c: ReturnType<typeof createClient>) {
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await (c as unknown as { api: ApiClient }).api.flush();
  }

  it("sends each event with its decisions from a test device", async () => {
    const c = client([debugKey("p1", "u1")]);
    c.track("checkout", { cart: 2 });
    await settle(c);
    c.stop();
    const upload = sent.find((s) => s.path === "/api/sdk/debug");
    expect(upload?.body.endUserId).toBe("u1");
    expect(upload?.body.entries).toMatchObject([{ event: "checkout", decisions: [{ reason: "eligible" }] }]);
  });

  it("sends nothing from any other device", async () => {
    const c = client([debugKey("p1", "someone_else")]);
    c.track("checkout", {});
    await settle(c);
    c.stop();
    expect(sent.some((s) => s.path === "/api/sdk/debug")).toBe(false);
  });
});

describe("outbox flush", () => {
  it("sends entries queued during a flush without waiting for the next one", async () => {
    const api = new ApiClient("ms_test_x", "https://example.test", memoryStorage());
    api.recordImpression({ surveyId: "s", triggerId: null, endUserId: "u", shownAt: new Date(), dismissed: true, context: {} });
    api.recordImpression({ surveyId: "s", triggerId: null, endUserId: "u", shownAt: new Date(), dismissed: true, context: {} });
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(sent.filter((s) => s.path === "/api/sdk/impressions")).toHaveLength(2);
  });
});
