//
// thanks.ts
//
// How long the thank-you stays up after the last answer. The same formula runs
// in every MicroSurveys SDK; the vectors in the tests are the shared contract.
//

/** Shown when the survey has no `successMessage` (or a blank one). */
export const DEFAULT_SUCCESS_MESSAGE = "Thanks!";

/** The thank-you text to show: the trimmed `successMessage`, else "Thanks!". */
export function thanksMessage(message: string | null | undefined): string {
  const trimmed = message?.trim();
  return trimmed ? trimmed : DEFAULT_SUCCESS_MESSAGE;
}

/** Milliseconds the thank-you stays up: ~200 wpm reading time plus a second to
 *  notice it, clamped to 1.3–7 s, then scaled by the pace (slow 150%, fast 70%).
 *  An unknown pace counts as normal. */
export function thanksDurationMs(message: string | null | undefined, pace?: string | null): number {
  const chars = [...thanksMessage(message)].length;
  const base = Math.min(Math.max(1000 + 50 * chars, 1300), 7000);
  const percent = pace === "slow" ? 150 : pace === "fast" ? 70 : 100;
  return Math.round((base * percent) / 100);
}
