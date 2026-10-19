//
// sampling.ts
//
// Pure helpers used by the trigger engine: deterministic 32-bit FNV-1a sampling
// and the equality `match` / `audienceMatch` evaluator. Faithful port of the iOS
// `Sampling.swift` — the same hash on both platforms so bucketing is stable and
// reproducible cross-platform.
//

import type { Json, JsonObject, TriggerStep } from "./types";

// ── Deterministic sampling ───────────────────────────────────────────────────

const encoder = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;

/** UTF-8 bytes of `s`, matching Swift's `string.utf8`. Exported for tests. */
export function utf8Bytes(s: string, useEncoder = true): Uint8Array {
  if (encoder && useEncoder) return encoder.encode(s);
  // Fallback if TextEncoder is unavailable (older Hermes). Iterates code points so
  // astral characters (surrogate pairs) encode to 4 bytes exactly like Swift.
  const out: number[] = [];
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) {
      out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    } else if (c < 0x10000) {
      out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  return Uint8Array.from(out);
}

/** 32-bit FNV-1a hash of `s`'s UTF-8 bytes. Returns an unsigned 32-bit integer. */
export function fnv1a32(s: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  const bytes = utf8Bytes(s);
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i]!;
    // FNV prime 0x01000193, 32-bit wrapping multiply.
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** `inSample = FNV-1a(endUserId + ":" + surveyId) % 100 < samplePercent`.
 *  `samplePercent` clamps: `>= 100` always in, `<= 0` always out. */
export function inSample(endUserId: string, surveyId: string, samplePercent: number): boolean {
  if (samplePercent >= 100) return true;
  if (samplePercent <= 0) return false;
  const bucket = fnv1a32(`${endUserId}:${surveyId}`) % 100;
  return bucket < samplePercent;
}

// ── Equality matching ────────────────────────────────────────────────────────

/** Formats a number as an integer when it has no fractional part, so `42` and
 *  `42.0` compare equal (port of iOS `numberString`). */
function numberString(n: number): string {
  if (Number.isFinite(n) && Math.trunc(n) === n && Math.abs(n) < 1e15) {
    return String(Math.trunc(n));
  }
  return String(n);
}

/** Stringifies a scalar for comparison. Returns `null` for values that never
 *  participate in an equality match (null, objects, arrays, undefined). */
export function stringify(value: unknown): string | null {
  switch (typeof value) {
    case "string":
      return value;
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return numberString(value);
    default:
      return null;
  }
}

/** True iff every key in `filter` is present in `properties` with an equal
 *  (stringified) value. Empty filter ⇒ always true. */
export function matches(filter: JsonObject, properties: Record<string, unknown>): boolean {
  for (const key of Object.keys(filter)) {
    const expectedStr = stringify(filter[key]);
    if (expectedStr === null) return false;
    const actualStr = stringify(properties[key]);
    if (actualStr === null) return false;
    if (expectedStr !== actualStr) return false;
  }
  return true;
}

/** True iff `eventName` equals `step.event` AND `step.match ⊆ properties`. */
export function eventMatchesStep(eventName: string, properties: Record<string, unknown>, step: TriggerStep): boolean {
  if (eventName !== step.event) return false;
  return matches(step.match, properties);
}

/** Audience check: `audience ⊆ userProperties` by stringified equality. */
export function audienceMatches(audience: JsonObject, userProperties: Record<string, Json>): boolean {
  return matches(audience, userProperties);
}
