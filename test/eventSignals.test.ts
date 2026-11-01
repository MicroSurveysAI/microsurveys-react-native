import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient } from "../src/core/client";
import type { ApiClient } from "../src/core/apiClient";
import { EventCounter, MAX_KEYS, MAX_NAMES } from "../src/core/eventCounter";
import { memoryStorage } from "../src/core/storage";
import { SDK_VERSION } from "../src/core/version";

// Event signals: when the project turns them on, the SDK uploads how often each
// event fired, with property names but never values.

let sent: { path: string; body: Record<string, unknown> }[];

function storageWithConfig(eventSignals: boolean) {
  const kv = memoryStorage();
  const rawConfig = JSON.stringify({ projectId: "p1", surveys: [], eventSignals });
  kv.setItem("com.microsurveys.config.cache", JSON.stringify({ rawConfig, etag: null, storedAt: Date.now() }));
  return kv;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

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

describe("EventCounter", () => {
  it("counts each name and keeps property names, not values", () => {
    const c = new EventCounter();
    c.record("checkout", { cart: 3, coupon: "SAVE10" }, 1000);
    c.record("checkout", { cart: 1, screen: "cart" }, 3000);
    const [checkout] = c.drain();
    expect(checkout).toEqual({
      name: "checkout",
      count: 2,
      firstSeenAt: new Date(1000).toISOString(),
      lastSeenAt: new Date(3000).toISOString(),
      propertyKeys: ["cart", "coupon", "screen"],
    });
    expect(JSON.stringify(checkout)).not.toContain("SAVE10");
  });

  it("caps distinct names and property names per window", () => {
    const c = new EventCounter();
    for (let i = 0; i < MAX_NAMES + 5; i++) c.record(`e${i}`);
    expect(c.size).toBe(MAX_NAMES);
    c.record("e0", Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i])));
    expect(c.drain()[0]?.propertyKeys).toHaveLength(MAX_KEYS);
  });
});

describe("client event signals", () => {
  it("uploads counts with the device context and SDK version when the project has them on", async () => {
    const client = createClient({
      apiKey: "ms_test_x",
      storage: storageWithConfig(true),
      platform: "android",
      osVersion: "14",
      appVersion: "3.2.0",
      subscribeForeground: () => () => {},
      refreshOnForeground: false,
    });
    client.track("checkout", { cart: 2 });
    client.flushEventCounts();
    await settle();
    await (client as unknown as { api: ApiClient }).api.flush();

    const upload = sent.find((s) => s.path === "/api/sdk/events");
    expect(upload?.body.context).toMatchObject({ platform: "android", osVersion: "14", appVersion: "3.2.0", sdkVersion: SDK_VERSION });
    expect(upload?.body.events).toMatchObject([{ name: "checkout", count: 1, propertyKeys: ["cart"] }]);
  });

  it("uploads when the app goes to the background", async () => {
    let background: () => void = () => {};
    const client = createClient({
      apiKey: "ms_test_x",
      storage: storageWithConfig(true),
      platform: "ios",
      subscribeForeground: () => () => {},
      subscribeBackground: (cb) => {
        background = cb;
        return () => {};
      },
      refreshOnForeground: false,
    });
    client.start();
    client.track("app_opened");
    background();
    await settle();
    await (client as unknown as { api: ApiClient }).api.flush();
    client.stop();
    expect(sent.some((s) => s.path === "/api/sdk/events")).toBe(true);
  });

  it("counts nothing when the project has them off", async () => {
    const client = createClient({
      apiKey: "ms_test_x",
      storage: storageWithConfig(false),
      platform: "ios",
      subscribeForeground: () => () => {},
      refreshOnForeground: false,
    });
    client.track("checkout", { cart: 2 });
    client.flushEventCounts();
    await settle();
    expect(sent.some((s) => s.path === "/api/sdk/events")).toBe(false);
  });
});
