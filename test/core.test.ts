import { describe, it, expect, vi } from "vitest";
import { fnv1a32, inSample, stringify, eventMatchesStep, audienceMatches } from "../src/core/sampling";
import { advance, windowExpired } from "../src/core/triggerSequencer";
import { passesFrequency, TriggerEngine } from "../src/core/triggerEngine";
import { TriggerStateStore } from "../src/core/persistence";
import { memoryStorage } from "../src/core/storage";
import { parseConfig, newTriggerRecord } from "../src/core/types";
import type { Survey, Trigger } from "../src/core/types";

// Test fixtures mirroring the iOS SDK's Tests/MicroSurveysSDKTests. The sequencer,
// sampling, and matching rules are the shared cross-platform contract; the FNV
// vectors below MUST match the iOS values so bucketing is identical everywhere.

function sequenceTrigger(window: number | null): Trigger {
  return {
    id: "t",
    type: "SEQUENCE",
    delaySeconds: 0,
    sequenceWindowSeconds: window,
    fireEvery: 1,
    warmupCount: 0,
    steps: [
      { order: 0, event: "page_view", match: { screen: "Wallet" } },
      { order: 1, event: "wallet_tap", match: {} },
    ],
  };
}

function singleTrigger(): Trigger {
  return {
    id: "s",
    type: "SINGLE",
    delaySeconds: 0,
    sequenceWindowSeconds: null,
    fireEvery: 1,
    warmupCount: 0,
    steps: [{ order: 0, event: "booking_completed", match: { plan: "pro" } }],
  };
}

describe("FNV-1a sampling", () => {
  it("matches the canonical 32-bit reference vectors (cross-platform with iOS)", () => {
    expect(fnv1a32("")).toBe(0x811c9dc5);
    expect(fnv1a32("a")).toBe(0xe40c292c);
  });

  it("is deterministic + sticky for the same (user, survey)", () => {
    const a = inSample("user-123", "svy_1", 50);
    const b = inSample("user-123", "svy_1", 50);
    expect(a).toBe(b);
  });

  it("honors the 0/100 boundaries", () => {
    expect(inSample("x", "y", 100)).toBe(true);
    expect(inSample("x", "y", 0)).toBe(false);
  });

  it("equals the documented FNV-1a bucket formula", () => {
    const bucket = fnv1a32("user-123:svy_1") % 100;
    expect(inSample("user-123", "svy_1", bucket + 1)).toBe(true);
    expect(inSample("user-123", "svy_1", bucket)).toBe(false);
  });
});

describe("match evaluation", () => {
  it("stringifies numbers and strings so 42 and 42.0 compare equal", () => {
    expect(stringify(42)).toBe("42");
    expect(stringify(42.0)).toBe("42");
    expect(stringify("Wallet")).toBe("Wallet");
    expect(stringify(true)).toBe("true");
    expect(stringify(null)).toBeNull();
    expect(stringify({})).toBeNull();
  });

  it("matches an event by name + match properties (extra props ignored)", () => {
    const step = { order: 0, event: "page_view", match: { screen: "Wallet" } };
    expect(eventMatchesStep("page_view", { screen: "Wallet", extra: 1 }, step)).toBe(true);
    expect(eventMatchesStep("page_view", { screen: "Home" }, step)).toBe(false);
    expect(eventMatchesStep("other_event", { screen: "Wallet" }, step)).toBe(false);
  });

  it("matches by name alone when match is empty", () => {
    const step = { order: 0, event: "wallet_tap", match: {} };
    expect(eventMatchesStep("wallet_tap", {}, step)).toBe(true);
  });

  it("audience is a subset check by stringified equality", () => {
    const audience = { plan: "pro" };
    expect(audienceMatches(audience, { plan: "pro", x: 1 })).toBe(true);
    expect(audienceMatches(audience, { plan: "free" })).toBe(false);
    expect(audienceMatches(audience, {})).toBe(false);
  });
});

describe("trigger sequencing", () => {
  it("SINGLE satisfies on a matching event only", () => {
    const t = singleTrigger();
    expect(advance(t, newTriggerRecord(), "booking_completed", { plan: "pro" }, 0).satisfied).toBe(true);
    expect(advance(t, newTriggerRecord(), "booking_completed", { plan: "free" }, 0).satisfied).toBe(false);
  });

  it("SEQUENCE completes in order within the window", () => {
    const t = sequenceTrigger(60);
    let rec = newTriggerRecord();
    const s0 = advance(t, rec, "page_view", { screen: "Wallet" }, 0);
    rec = s0.record;
    expect(s0.satisfied).toBe(false);
    expect(rec.stepIndex).toBe(1);

    const s1 = advance(t, rec, "wallet_tap", {}, 10);
    rec = s1.record;
    expect(s1.satisfied).toBe(true);
    expect(rec.stepIndex).toBe(0);
    expect(rec.satisfiedCount).toBe(1);
  });

  it("SEQUENCE resets when the second step arrives after the window", () => {
    const t = sequenceTrigger(60);
    let rec = advance(t, newTriggerRecord(), "page_view", { screen: "Wallet" }, 0).record;
    expect(rec.stepIndex).toBe(1);
    const late = advance(t, rec, "wallet_tap", {}, 100);
    expect(late.satisfied).toBe(false);
    expect(late.record.stepIndex).toBe(0);
  });

  it("SEQUENCE ignores out-of-order events", () => {
    const t = sequenceTrigger(null);
    const r = advance(t, newTriggerRecord(), "wallet_tap", {}, 0);
    expect(r.satisfied).toBe(false);
    expect(r.record.stepIndex).toBe(0);
  });

  it("SEQUENCE restarts the window on a repeated step 0", () => {
    const t = sequenceTrigger(60);
    let rec = advance(t, newTriggerRecord(), "page_view", { screen: "Wallet" }, 0).record;
    const restart = advance(t, rec, "page_view", { screen: "Wallet" }, 50);
    rec = restart.record;
    expect(restart.satisfied).toBe(false);
    expect(rec.stepIndex).toBe(1);
    expect(rec.startedAt).toBe(50);
  });

  it("windowExpired only trips for a positive window past its deadline", () => {
    expect(windowExpired(60, 0, 100)).toBe(true);
    expect(windowExpired(60, 0, 30)).toBe(false);
    expect(windowExpired(null, 0, 1e9)).toBe(false);
    expect(windowExpired(60, null, 1e9)).toBe(false);
  });
});

describe("frequency (warmup + fireEvery)", () => {
  const t = (warmupCount: number, fireEvery: number): Trigger => ({
    ...singleTrigger(),
    warmupCount,
    fireEvery,
  });

  it("ignores the first `warmupCount` satisfied occurrences", () => {
    const tr = t(2, 1);
    expect(passesFrequency(tr, 1)).toBe(false);
    expect(passesFrequency(tr, 2)).toBe(false);
    expect(passesFrequency(tr, 3)).toBe(true);
  });

  it("fires every Nth occurrence after warmup", () => {
    const tr = t(1, 2);
    expect(passesFrequency(tr, 1)).toBe(false); // effective 0
    expect(passesFrequency(tr, 2)).toBe(false); // effective 1
    expect(passesFrequency(tr, 3)).toBe(true); // effective 2
    expect(passesFrequency(tr, 4)).toBe(false); // effective 3
    expect(passesFrequency(tr, 5)).toBe(true); // effective 4
  });
});

describe("config parsing", () => {
  it("normalizes a CES question with its config + defaults", () => {
    const cfg = parseConfig(
      JSON.stringify({
        projectId: "prj_1",
        theme: { accent: "#4F46E5", cornerRadius: 14, position: "bottom" },
        surveys: [
          {
            id: "svy_1",
            name: "Wallet CES",
            questions: [
              {
                id: "qst_1",
                order: 0,
                type: "CES",
                prompt: "How easy was it?",
                required: true,
                config: { min: 1, max: 7, minLabel: "Very difficult", maxLabel: "Very easy" },
              },
            ],
          },
        ],
      }),
    );
    expect(cfg).not.toBeNull();
    expect(cfg!.theme?.accent).toBe("#4F46E5");
    expect(cfg!.theme?.cornerRadius).toBe(14);
    const q = cfg!.surveys[0]!.questions[0]!;
    expect(q.type).toBe("CES");
    expect(q.required).toBe(true);
    expect(q.config).toEqual({ kind: "scale", min: 1, max: 7, minLabel: "Very difficult", maxLabel: "Very easy" });
  });

  it("returns null for an unusable payload", () => {
    expect(parseConfig("not json")).toBeNull();
    expect(parseConfig(JSON.stringify({ surveys: [] }))).toBeNull(); // no projectId
  });
});

describe("engine platform targeting", () => {
  function surveyFor(platforms: string[]): Survey {
    return {
      id: "svy_1",
      name: "Test",
      questions: [],
      samplePercent: 100,
      maxPerUserDays: 0,
      platforms,
      triggers: [{ id: "t", type: "SINGLE", delaySeconds: 0, sequenceWindowSeconds: null, fireEvery: 1, warmupCount: 0, steps: [{ order: 0, event: "ping", match: {} }] }],
    };
  }

  function runOn(platform: string, surveyPlatforms: string[]): boolean {
    vi.useFakeTimers();
    let presented = false;
    const engine = new TriggerEngine({
      store: new TriggerStateStore(memoryStorage()),
      surveysProvider: () => [surveyFor(surveyPlatforms)],
      identityProvider: () => ({ anonymousId: "u1", userProperties: {} }),
      onPresent: () => {
        presented = true;
      },
      platform,
      now: () => 0,
    });
    engine.process("ping", {});
    vi.runAllTimers();
    vi.useRealTimers();
    return presented;
  }

  it("presents when the survey targets all platforms ([])", () => {
    expect(runOn("android", [])).toBe(true);
  });

  it("presents when the client platform is in the target list", () => {
    expect(runOn("android", ["android", "ios"])).toBe(true);
  });

  it("skips when the client platform is excluded", () => {
    expect(runOn("android", ["ios"])).toBe(false);
  });
});
