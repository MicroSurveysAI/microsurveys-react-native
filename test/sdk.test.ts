import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AsyncKeyValueStorage } from "../src/asyncStorage";

// react-native and AsyncStorage can't load under Node; the runtime only needs
// Platform.OS and AppState from them.
const appStateListeners: ((state: string) => void)[] = [];
vi.mock("react-native", () => ({
  Platform: { OS: "ios", Version: "26.1" },
  AppState: {
    addEventListener: (_: string, cb: (state: string) => void) => {
      appStateListeners.push(cb);
      return { remove: () => appStateListeners.splice(appStateListeners.indexOf(cb), 1) };
    },
  },
}));
vi.mock("@react-native-async-storage/async-storage", () => ({ default: fakeAsyncStorage() }));

const { hydrateAsyncStorage } = await import("../src/asyncStorage");
const { createAmplitudePlugin, identityOf } = await import("../src/amplitude");
const { resolveTheme, color, withAlpha, clampRadius } = await import("../src/ui/theme");
const { MicroSurveys } = await import("../src/MicroSurveys");

function fakeAsyncStorage(initial: Record<string, string> = {}, opts: { v3?: boolean } = {}) {
  const map = new Map(Object.entries(initial));
  const store: AsyncKeyValueStorage & { map: Map<string, string> } = {
    map,
    getItem: async (k) => map.get(k) ?? null,
    setItem: async (k, v) => void map.set(k, v),
    removeItem: async (k) => void map.delete(k),
    getAllKeys: async () => [...map.keys()],
  };
  if (opts.v3) store.getMany = async (keys) => Object.fromEntries(keys.map((k) => [k, map.get(k) ?? null]));
  else store.multiGet = async (keys) => keys.map((k) => [k, map.get(k) ?? null] as const);
  return store;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("hydrateAsyncStorage", () => {
  for (const v3 of [false, true]) {
    it(`preloads only MicroSurveys keys (${v3 ? "v3 getMany" : "v2 multiGet"})`, async () => {
      const store = fakeAsyncStorage({ "com.microsurveys.anonymousId": "anon_1", "host.key": "x" }, { v3 });
      const kv = await hydrateAsyncStorage(store);
      expect(kv.getItem("com.microsurveys.anonymousId")).toBe("anon_1");
      expect(kv.getItem("host.key")).toBeNull();
    });
  }

  it("serves writes synchronously and persists them in order", async () => {
    const store = fakeAsyncStorage();
    const kv = await hydrateAsyncStorage(store);
    kv.setItem("com.microsurveys.a", "1");
    kv.setItem("com.microsurveys.a", "2");
    kv.setItem("com.microsurveys.b", "x");
    kv.removeItem("com.microsurveys.b");
    expect(kv.getItem("com.microsurveys.a")).toBe("2");
    await tick();
    expect(store.map.get("com.microsurveys.a")).toBe("2");
    expect(store.map.has("com.microsurveys.b")).toBe(false);
  });

  it("starts empty when the store can't be read, and survives failed writes", async () => {
    const broken: AsyncKeyValueStorage = {
      getItem: () => Promise.reject(new Error("io")),
      setItem: () => Promise.reject(new Error("io")),
      removeItem: () => Promise.reject(new Error("io")),
      getAllKeys: () => Promise.reject(new Error("io")),
    };
    const kv = await hydrateAsyncStorage(broken);
    kv.setItem("com.microsurveys.a", "1");
    expect(kv.getItem("com.microsurveys.a")).toBe("1");
    await tick();
  });
});

describe("Amplitude plugin", () => {
  it("forwards events + identity and returns the event unmodified", async () => {
    const track = vi.fn();
    const updateAnalyticsIdentity = vi.fn();
    const plugin = createAmplitudePlugin({ track, updateAnalyticsIdentity });
    const event = { event_type: "booking_completed", event_properties: { amount: 42 }, user_id: "u1", device_id: "d1" };
    expect(await plugin.execute(event)).toBe(event);
    expect(event).toEqual({ event_type: "booking_completed", event_properties: { amount: 42 }, user_id: "u1", device_id: "d1" });
    expect(track).toHaveBeenCalledWith("booking_completed", { amount: 42 });
    expect(updateAnalyticsIdentity).toHaveBeenCalledWith({ userId: "u1", deviceId: "d1" });
  });

  it("maps $identify property operations and doesn't track system events", async () => {
    const track = vi.fn();
    const updateAnalyticsIdentity = vi.fn();
    const plugin = createAmplitudePlugin({ track, updateAnalyticsIdentity });
    await plugin.execute({
      event_type: "$identify",
      user_id: "u1",
      user_properties: { $set: { plan: "pro" }, $setOnce: { source: "ad" }, $unset: { trial: "-" } },
    });
    expect(track).not.toHaveBeenCalled();
    expect(updateAnalyticsIdentity).toHaveBeenCalledWith({
      userId: "u1",
      deviceId: undefined,
      userProperties: { plan: "pro" },
      setOnceProperties: { source: "ad" },
      unsetProperties: ["trial"],
    });
  });

  it("never breaks the analytics pipeline", async () => {
    const plugin = createAmplitudePlugin({
      track: () => {
        throw new Error("boom");
      },
      updateAnalyticsIdentity: () => {},
    });
    const event = { event_type: "x" };
    await expect(plugin.execute(event)).resolves.toBe(event);
  });

  it("ignores user_properties on non-identify events", () => {
    expect(identityOf({ event_type: "x", user_properties: { $set: { a: 1 } } })).toEqual({ userId: undefined, deviceId: undefined });
  });
});

describe("theme mapping", () => {
  it("uses the iOS defaults, dark-aware", () => {
    const light = resolveTheme(null);
    const dark = resolveTheme(null, { scheme: "dark" });
    expect(light.accent).toBe("#2E7272");
    expect(dark.accent).toBe("#41B2B2");
    expect(light.position).toBe("bottom");
    expect(light.controlRadius).toBe(12);
    expect(light.sheetCornerRadius).toBe(28);
    expect(light.nativeSheetCorners).toBe(true);
    expect(dark.dark).toBe(true);
  });

  it("drops native sheet corners once a corner radius is configured", () => {
    expect(resolveTheme({ cornerRadius: 0 }).nativeSheetCorners).toBe(false);
  });

  it("lets configured colors win in both schemes", () => {
    expect(resolveTheme({ accent: "#f60" }, { scheme: "dark" }).accent).toBe("#FF6600");
  });

  it("maps radius, pill controls and title weight like the iOS presenter", () => {
    const t = resolveTheme({ cornerRadius: 20, controlHeight: 60, titleWeight: "bold" });
    expect(t.cornerRadius).toBe(20);
    expect(t.sheetCornerRadius).toBe(20);
    expect(t.controlRadius).toBe(18);
    expect(t.titleWeight).toBe("700");
    expect(resolveTheme({ cornerRadius: 20, controlRadius: 4 }).controlRadius).toBe(4);
    expect(resolveTheme({ controlHeight: 60, controlPill: true }).controlRadius).toBe(30);
  });

  it("lets the survey's presentation override the theme position", () => {
    expect(resolveTheme({ position: "center" }).position).toBe("center");
    expect(resolveTheme({ position: "center" }, { presentation: "sheet" }).position).toBe("bottom");
    expect(resolveTheme(null, { presentation: "dialog" }).position).toBe("center");
  });

  it("parses hex colors leniently and clamps pill radii", () => {
    expect(color("abc")).toBe("#AABBCC");
    expect(color("#11223344")).toBe("#11223344");
    expect(color("nope")).toBeUndefined();
    expect(withAlpha("#2E7272", 0.1)).toBe("rgba(46, 114, 114, 0.1)");
    expect(clampRadius(30, 40, 60)).toBe(20);
  });
});

describe("MicroSurveys", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
  });

  it("buffers calls made before storage loads and replays them in order", async () => {
    const asyncStorage = fakeAsyncStorage();
    const ms = new MicroSurveys({ apiKey: "ms_test_x", asyncStorage });
    ms.identify("user-1", { plan: "pro" });
    ms.track("opened");
    ms.start();
    await ms.ready;
    await tick();
    expect(JSON.parse(asyncStorage.map.get("com.microsurveys.userProperties")!)).toEqual({ plan: "pro" });
    ms.stop();
  });

  it("refreshes on AppState foreground once started", async () => {
    const ms = new MicroSurveys({ apiKey: "ms_test_x", asyncStorage: fakeAsyncStorage() });
    ms.start();
    await ms.ready;
    expect(appStateListeners).toHaveLength(1);
    ms.stop();
    expect(appStateListeners).toHaveLength(0);
  });

  it("targets the device platform and presents eligible surveys", async () => {
    const config = {
      projectId: "p",
      surveys: [
        {
          id: "s1",
          name: "iOS only",
          platforms: ["ios"],
          questions: [{ id: "q", type: "THUMBS", prompt: "?", config: {} }],
          triggers: [{ id: "t", type: "SINGLE", steps: [{ order: 0, event: "done", match: {} }] }],
        },
      ],
    };
    const asyncStorage = fakeAsyncStorage({
      "com.microsurveys.config.cache": JSON.stringify({ rawConfig: JSON.stringify(config), etag: null, storedAt: Date.now() }),
    });
    const ms = new MicroSurveys({ apiKey: "ms_test_x", asyncStorage });
    const presented: string[] = [];
    ms.onPresent((a) => presented.push(a.survey.id));
    ms.track("done");
    await ms.ready;
    await new Promise((r) => setTimeout(r, 5));
    expect(presented).toEqual(["s1"]);
  });

  it("sends the trigger, impression link and device context with a response", async () => {
    const sent: { path: string; body: Record<string, Record<string, unknown>[]> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: string }) => {
        sent.push({ path: new URL(url).pathname, body: JSON.parse(init.body) });
        return { ok: true, status: 200, headers: { get: () => null }, text: async () => "" };
      }),
    );
    const config = {
      projectId: "p",
      surveys: [
        {
          id: "s1",
          name: "Thumbs",
          questions: [{ id: "q", type: "THUMBS", prompt: "?", config: {} }],
          triggers: [{ id: "t", type: "SINGLE", steps: [{ order: 0, event: "done", match: {} }] }],
        },
      ],
    };
    const asyncStorage = fakeAsyncStorage({
      "com.microsurveys.config.cache": JSON.stringify({ rawConfig: JSON.stringify(config), etag: null, storedAt: Date.now() }),
    });
    const ms = new MicroSurveys({ apiKey: "ms_test_x", asyncStorage, appVersion: "3.2.0" });
    ms.onPresent((a) => a.close({ completed: true, dismissed: false, answers: [{ questionId: "q", value: { value: "up" } }] }));
    ms.track("done");
    const client = await ms.ready;
    await new Promise((r) => setTimeout(r, 5));
    await (client as unknown as { api: { flush(): Promise<void> } }).api.flush();

    const impression = sent.find((s) => s.path === "/api/sdk/impressions")?.body.impressions?.[0] ?? {};
    const response = sent.find((s) => s.path === "/api/sdk/responses")?.body.responses?.[0] ?? {};
    expect(response.impressionId).toBe(impression.clientId);
    expect(response.triggerId).toBe("t");
    expect(impression.triggerId).toBe("t");
    expect(response.context).toMatchObject({ platform: "ios", osVersion: "26.1", appVersion: "3.2.0" });
    expect(impression.context).toEqual(response.context);
  });
});
