import { describe, it, expect } from "vitest";
import { thanksDurationMs, thanksMessage } from "../src/core/thanks";
import { parseConfig } from "../src/core/types";

// The thank-you timing vectors from the shared contract. Every MicroSurveys SDK
// checks the same table, so the delay is identical on every platform.
const VECTORS: Array<[string | null, string | null, number]> = [
  [null, null, 1350],
  ["   ", "normal", 1350],
  ["Thanks!", "slow", 2025],
  ["Thanks!", "fast", 945],
  ["Ok", null, 1300],
  ["Ok", "fast", 910],
  ["Thanks! We read every response.", null, 2550],
  ["Thanks! We read every response.", "slow", 3825],
  ["Thanks! We read every response.", "fast", 1785],
  ["x".repeat(160), null, 7000],
  ["x".repeat(160), "slow", 10500],
  ["x".repeat(160), "fast", 4900],
  ["Merci 🌱", null, 1350],
  ["Thanks!", "unknown", 1350],
];

describe("thanksDurationMs", () => {
  it.each(VECTORS)("(%j, %j) → %i ms", (message, pace, ms) => {
    expect(thanksDurationMs(message, pace)).toBe(ms);
  });

  it("shows the trimmed message, or Thanks! when blank", () => {
    expect(thanksMessage(null)).toBe("Thanks!");
    expect(thanksMessage("  \n ")).toBe("Thanks!");
    expect(thanksMessage("  Merci 🌱 ")).toBe("Merci 🌱");
  });
});

describe("successPace parsing", () => {
  function parsePace(successPace: unknown) {
    const raw = JSON.stringify({
      projectId: "p",
      surveys: [{ id: "s", name: "Juniper checkout", questions: [], triggers: [], successMessage: "Thanks for shopping with Juniper!", successPace }],
    });
    return parseConfig(raw)!.surveys[0]!;
  }

  it("keeps slow and fast through the config parse", () => {
    expect(parsePace("slow").successPace).toBe("slow");
    expect(parsePace("fast").successPace).toBe("fast");
    expect(parsePace("slow").successMessage).toBe("Thanks for shopping with Juniper!");
  });

  it("reads missing, null and unknown values as normal (null)", () => {
    expect(parsePace(undefined).successPace).toBeNull();
    expect(parsePace(null).successPace).toBeNull();
    expect(parsePace("normal").successPace).toBeNull();
    expect(parsePace("glacial").successPace).toBeNull();
    expect(parsePace(3).successPace).toBeNull();
  });

  it("feeds the parsed pace into the delay", () => {
    const survey = parsePace("fast");
    expect(thanksDurationMs(survey.successMessage, survey.successPace)).toBe(1855); // 33 code points: (1000 + 50 × 33) × 70%
  });
});
