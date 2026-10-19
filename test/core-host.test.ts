import { describe, it, expect, vi } from "vitest";
import { createClient } from "../src/core/client";
import { IdentityStore } from "../src/core/identity";
import { utf8Bytes } from "../src/core/sampling";
import { memoryStorage } from "../src/core/storage";
import { endUserIdOf } from "../src/core/types";

// The engine's host seams: injected storage, the injected foreground signal,
// and analytics-forwarded identity.

describe("injected storage", () => {
  it("persists the anonymous id and user properties into the given store", () => {
    const kv = memoryStorage();
    const first = new IdentityStore(kv);
    first.setUser(null, { plan: "pro" });

    const second = new IdentityStore(kv);
    expect(second.snapshot().anonymousId).toBe(first.snapshot().anonymousId);
    expect(second.snapshot().userProperties).toEqual({ plan: "pro" });
  });

  it("mints the anonymous id into the injected store", () => {
    const kv = memoryStorage();
    createClient({ apiKey: "ms_test_x", storage: kv, platform: "ios", subscribeForeground: () => () => {}, refreshOnForeground: false });
    expect(kv.getItem("com.microsurveys.anonymousId")).toMatch(/^anon_/);
  });
});

describe("analytics identity", () => {
  it("resolves endUserId like iOS: amplitude user ?? device ?? host ?? anonymous", () => {
    expect(endUserIdOf({ anonymousId: "a", userProperties: {} })).toBe("a");
    expect(endUserIdOf({ hostUserId: "h", anonymousId: "a", userProperties: {} })).toBe("h");
    expect(endUserIdOf({ amplitudeDeviceId: "d", hostUserId: "h", anonymousId: "a", userProperties: {} })).toBe("d");
    expect(
      endUserIdOf({ amplitudeUserId: "u", amplitudeDeviceId: "d", hostUserId: "h", anonymousId: "a", userProperties: {} }),
    ).toBe("u");
  });

  it("applies $set, $setOnce and $unset semantics", () => {
    const store = new IdentityStore(memoryStorage());
    store.updateFromAnalytics({ userId: "u1", userProperties: { plan: "pro", seats: 3 } });
    store.updateFromAnalytics({ unsetProperties: ["seats"], setOnceProperties: { plan: "free", source: "ad" } });
    const snap = store.snapshot();
    expect(snap.amplitudeUserId).toBe("u1");
    expect(snap.userProperties).toEqual({ plan: "pro", source: "ad" });
  });

  it("only rewrites storage when properties change", () => {
    const kv = memoryStorage();
    const setItem = vi.spyOn(kv, "setItem");
    const store = new IdentityStore(kv);
    setItem.mockClear();
    store.updateFromAnalytics({ userProperties: { plan: "pro" } });
    store.updateFromAnalytics({ userProperties: { plan: "pro" } });
    expect(setItem).toHaveBeenCalledTimes(1);
  });
});

describe("foreground signal", () => {
  it("subscribes on start and unsubscribes on stop", () => {
    const unsubscribe = vi.fn();
    const subscribe = vi.fn(() => unsubscribe);
    const client = createClient({ apiKey: "ms_test_x", storage: memoryStorage(), platform: "ios", subscribeForeground: subscribe });
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    client.start();
    expect(subscribe).toHaveBeenCalledTimes(1);
    client.stop();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });
});

describe("UTF-8 fallback (runtimes without TextEncoder)", () => {
  it("encodes exactly like TextEncoder, including astral characters", () => {
    for (const s of ["", "user-123:svy_1", "café", "日本", "😀 ok", "a\u{1F680}b"]) {
      expect(Array.from(utf8Bytes(s, false))).toEqual(Array.from(new TextEncoder().encode(s)));
    }
  });
});
