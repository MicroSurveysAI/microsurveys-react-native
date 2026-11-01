//
// debug.ts
//
// The live debugger: on a test device chosen in the dashboard, the SDK sends
// each tracked event and what the engine decided for every survey whose trigger
// names it, so a developer can see why a survey did or didn't show.
//
// The dashboard never sends test user ids to apps. Config carries `debugUsers`,
// a list of hashes of "debug:<projectId>:<userId>"; the SDK hashes its current
// user the same way and only reports when it finds a match. Same FNV-1a as
// sampling, so every SDK computes the same value.
//

import { fnv1a32 } from "./sampling";
import type { Decision } from "./triggerEngine";

/** The hash the dashboard puts in config `debugUsers` for one test user. */
export function debugKey(projectId: string, endUserId: string): string {
  return fnv1a32(`debug:${projectId}:${endUserId}`).toString(16).padStart(8, "0");
}

export interface DebugEntry {
  at: string;
  /** The tracked event, or null for a decision made later (shown, capped at fire time). */
  event: string | null;
  properties: Record<string, unknown>;
  decisions: Decision[];
}

const MAX_PROPS = 30;
const MAX_STRING = 200;

/** A small, JSON-safe copy of an event's properties for display. Test devices
 *  only; nested values are summarised rather than sent whole. */
export function debugProperties(properties: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(properties).slice(0, MAX_PROPS)) {
    if (typeof v === "string") out[k] = v.length > MAX_STRING ? `${v.slice(0, MAX_STRING)}…` : v;
    else if (typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
    else if (Array.isArray(v)) out[k] = `[${v.length} items]`;
    else if (typeof v === "object") out[k] = "{…}";
  }
  return out;
}
