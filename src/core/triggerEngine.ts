//
// triggerEngine.ts
//
// The evaluator. For each incoming event it advances every active survey's
// trigger state and, when a trigger's full condition is satisfied, walks the
// eligibility order from API-CONTRACT §Eligibility:
//
//   1. window (startsAt/endsAt)        2. trigger condition (advanced here)
//   3. frequency (warmupCount + fireEvery)
//   4. audience (audienceMatch ⊆ user properties)
//   5. sampling (deterministic, sticky)   6. per-user cap (maxPerUserDays)
//
// Eligible surveys are scheduled after `delaySeconds`; the cap is re-checked at
// fire time and `lastShownAt` recorded before presenting. Port of iOS
// `TriggerEngine` (JS is single-threaded, so the serial queue is unnecessary).
//

import { advance } from "./triggerSequencer";
import { inSample, audienceMatches } from "./sampling";
import { newTriggerRecord, endUserIdOf } from "./types";
import type { TriggerStateStore } from "./persistence";
import type { Identity, Survey, Trigger, UserTriggerState } from "./types";

export interface TriggerEngineOptions {
  store: TriggerStateStore;
  surveysProvider: () => Survey[];
  identityProvider: () => Identity;
  onPresent: (survey: Survey, trigger: Trigger, identity: Identity) => void;
  /** This SDK's platform (e.g. "ios"). Surveys with a non-empty `platforms` list
   *  that excludes this value are skipped for auto-presentation. */
  platform: string;
  /** Injectable clock in **seconds** (tests). Defaults to `Date.now()/1000`. */
  now?: () => number;
}

export class TriggerEngine {
  private readonly store: TriggerStateStore;
  private readonly surveysProvider: () => Survey[];
  private readonly identityProvider: () => Identity;
  private readonly onPresent: (survey: Survey, trigger: Trigger, identity: Identity) => void;
  private readonly platform: string;
  private readonly now: () => number;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(opts: TriggerEngineOptions) {
    this.store = opts.store;
    this.surveysProvider = opts.surveysProvider;
    this.identityProvider = opts.identityProvider;
    this.onPresent = opts.onPresent;
    this.platform = opts.platform;
    this.now = opts.now ?? (() => Date.now() / 1000);
  }

  /** Feed an event into the engine. */
  process(name: string, properties: Record<string, unknown> = {}): void {
    const identity = this.identityProvider();
    const endUserId = endUserIdOf(identity);
    const state = this.store.load(endUserId);
    const nowT = this.now();

    for (const survey of this.surveysProvider()) {
      const triggers = survey.triggers;
      if (!triggers || triggers.length === 0) continue;
      // Platform targeting: skip when the list is non-empty and excludes us.
      if (survey.platforms && survey.platforms.length > 0 && !survey.platforms.includes(this.platform)) continue;

      for (const trigger of triggers) {
        const satisfied = this.advanceTrigger(trigger, state, name, properties, nowT);
        if (!satisfied) continue;

        const occurrence = state.triggers[trigger.id]?.satisfiedCount ?? 0;

        // (1) window
        if (!this.isWithinWindow(survey, nowT)) continue;
        // (3) frequency
        if (!passesFrequency(trigger, occurrence)) continue;
        // (4) audience
        if (survey.audienceMatch && !audienceMatches(survey.audienceMatch, identity.userProperties)) continue;
        // (5) sampling (sticky)
        if (!this.passesSampling(survey, endUserId, state)) continue;
        // (6) cap
        if (!passesCap(survey, state, nowT)) continue;

        this.scheduleShow(survey, trigger, identity);
      }
    }

    this.store.save(endUserId, state);
  }

  /** Cancels any pending scheduled presentations. */
  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  // ── Trigger advancement ────────────────────────────────────────────────────

  private advanceTrigger(
    trigger: Trigger,
    state: UserTriggerState,
    eventName: string,
    properties: Record<string, unknown>,
    nowT: number,
  ): boolean {
    const record = state.triggers[trigger.id] ?? newTriggerRecord();
    const { record: updated, satisfied } = advance(trigger, record, eventName, properties, nowT);
    state.triggers[trigger.id] = updated;
    return satisfied;
  }

  // ── Eligibility checks ─────────────────────────────────────────────────────

  private isWithinWindow(survey: Survey, nowT: number): boolean {
    if (survey.startsAt) {
      const start = Date.parse(survey.startsAt);
      if (!Number.isNaN(start) && nowT < start / 1000) return false;
    }
    if (survey.endsAt) {
      const end = Date.parse(survey.endsAt);
      if (!Number.isNaN(end) && nowT > end / 1000) return false;
    }
    return true;
  }

  private passesSampling(survey: Survey, endUserId: string, state: UserTriggerState): boolean {
    const existing = state.surveys[survey.id]?.sampleDecision;
    if (existing !== undefined && existing !== null) return existing;
    const decision = inSample(endUserId, survey.id, survey.samplePercent ?? 100);
    const record = state.surveys[survey.id] ?? {};
    record.sampleDecision = decision;
    state.surveys[survey.id] = record;
    return decision;
  }

  // ── Scheduling ─────────────────────────────────────────────────────────────

  private scheduleShow(survey: Survey, trigger: Trigger, identity: Identity): void {
    const delayMs = Math.max(0, trigger.delaySeconds) * 1000;
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      const endUserId = endUserIdOf(identity);
      const state = this.store.load(endUserId);
      const nowT = this.now();

      // Re-check the cap at fire time (another survey may have shown during the delay).
      if (!passesCap(survey, state, nowT)) return;

      // Record the show now so the cap holds even before the impression round-trips.
      const record = state.surveys[survey.id] ?? {};
      record.lastShownAt = nowT;
      state.surveys[survey.id] = record;
      this.store.save(endUserId, state);

      this.onPresent(survey, trigger, identity);
    }, delayMs);
    this.timers.add(timer);
  }
}

/** `occurrence` is 1-based. Ignore the first `warmupCount`, then fire on every
 *  `fireEvery`-th satisfied occurrence thereafter. */
export function passesFrequency(trigger: Trigger, occurrence: number): boolean {
  const fireEvery = Math.max(1, trigger.fireEvery);
  const effective = occurrence - trigger.warmupCount;
  return effective >= 1 && effective % fireEvery === 0;
}

function passesCap(survey: Survey, state: UserTriggerState, nowT: number): boolean {
  const days = survey.maxPerUserDays ?? 0;
  const lastShown = state.surveys[survey.id]?.lastShownAt;
  if (days <= 0 || lastShown === undefined || lastShown === null) return true;
  const elapsed = nowT - lastShown;
  return elapsed >= days * 86_400;
}
