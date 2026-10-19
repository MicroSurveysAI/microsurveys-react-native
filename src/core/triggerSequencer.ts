//
// triggerSequencer.ts
//
// Pure state machine advancing a trigger's SINGLE/SEQUENCE progress on one
// incoming event. No clock, no storage, no queues — so the sequence + window
// ordering rules are unit-testable. Faithful port of iOS `TriggerSequencer`.
//

import { eventMatchesStep } from "./sampling";
import type { Trigger, TriggerRecord } from "./types";

export interface AdvanceResult {
  record: TriggerRecord;
  satisfied: boolean;
}

/** True iff the sequence window has lapsed since step 0 matched. */
export function windowExpired(window: number | null, startedAt: number | null, nowT: number): boolean {
  if (window === null || window <= 0 || startedAt === null) return false;
  return nowT - startedAt > window;
}

/** Advances `record` for one event. On satisfaction, bumps `satisfiedCount` and
 *  resets the sequence progress. Returns a new record (input is not mutated). */
export function advance(
  trigger: Trigger,
  record: TriggerRecord,
  eventName: string,
  properties: Record<string, unknown>,
  nowT: number,
): AdvanceResult {
  const next: TriggerRecord = { ...record };
  const steps = [...trigger.steps].sort((a, b) => a.order - b.order);
  if (steps.length === 0) return { record: next, satisfied: false };

  const matchesStep = (index: number): boolean => eventMatchesStep(eventName, properties, steps[index]!);

  let satisfied = false;

  if (trigger.type === "SINGLE") {
    // One step (the first); matching it satisfies the condition.
    satisfied = matchesStep(0);
  } else {
    // SEQUENCE
    const expected = Math.min(next.stepIndex, steps.length - 1);

    if (matchesStep(expected)) {
      if (expected === 0) {
        next.startedAt = nowT;
        next.stepIndex = 1;
      } else if (windowExpired(trigger.sequenceWindowSeconds, next.startedAt, nowT)) {
        // The sequence window lapsed; restart, re-checking step 0.
        if (matchesStep(0)) {
          next.startedAt = nowT;
          next.stepIndex = 1;
        } else {
          next.stepIndex = 0;
          next.startedAt = null;
        }
      } else {
        next.stepIndex = expected + 1;
      }

      if (next.stepIndex >= steps.length) {
        satisfied = true;
        next.stepIndex = 0;
        next.startedAt = null;
      }
    } else if (expected !== 0 && matchesStep(0)) {
      // Out-of-order event that *is* step 0 — restart the sequence.
      next.startedAt = nowT;
      next.stepIndex = 1;
      if (steps.length === 1) {
        satisfied = true;
        next.stepIndex = 0;
        next.startedAt = null;
      }
    }
  }

  if (satisfied) next.satisfiedCount += 1;
  return { record: next, satisfied };
}
