//
// amplitude.ts
//
// An Amplitude enrichment plugin for `@amplitude/analytics-react-native`: it
// reads every tracked event (name + properties), keeps the identity fresh
// (user id, device id, `$identify` user properties), and forwards both to the
// SDK — then returns the event **unmodified** (pure pass-through, never drops or
// rewrites events). Port of iOS `MicroSurveysAmplitudePlugin`.
//
// Typed structurally so this package doesn't depend on Amplitude.
//

import type { AnalyticsIdentity } from "./core";

/** The fields of an Amplitude event this plugin reads. */
export interface AmplitudeEvent {
  event_type: string;
  event_properties?: Record<string, unknown> | null;
  user_id?: string | null;
  device_id?: string | null;
  /** On `$identify` events: `{ $set, $setOnce, $unset, … }` operations. */
  user_properties?: Record<string, unknown> | null;
}

/** An Amplitude enrichment plugin (`amplitude.add(plugin)`). */
export interface MicroSurveysAmplitudePlugin {
  name: string;
  type: "enrichment";
  setup(config?: unknown, client?: unknown): Promise<void>;
  execute<E extends AmplitudeEvent>(event: E): Promise<E>;
}

/** What the plugin forwards into. Implemented by `MicroSurveys`. */
export interface AmplitudeForwarder {
  updateAnalyticsIdentity(update: AnalyticsIdentity): void;
  track(name: string, properties?: Record<string, unknown>): void;
}

export function createAmplitudePlugin(forwarder: AmplitudeForwarder): MicroSurveysAmplitudePlugin {
  return {
    name: "microsurveys",
    type: "enrichment",
    async setup() {},
    async execute(event) {
      try {
        forwarder.updateAnalyticsIdentity(identityOf(event));
        // System events (`$identify`, `$groupidentify`, …) never match host
        // triggers; skip them rather than churn trigger state.
        if (!event.event_type.startsWith("$")) {
          forwarder.track(event.event_type, event.event_properties ?? {});
        }
      } catch {
        // Never let survey logic break the host's analytics pipeline.
      }
      return event;
    },
  };
}

/** Maps an event's identity fields (and, for `$identify`, its property
 *  operations) onto an identity update. */
export function identityOf(event: AmplitudeEvent): AnalyticsIdentity {
  const update: AnalyticsIdentity = { userId: event.user_id, deviceId: event.device_id };
  if (event.event_type !== "$identify" || !event.user_properties) return update;

  const ops = event.user_properties;
  const set = asRecord(ops.$set);
  const setOnce = asRecord(ops.$setOnce);
  if (set) update.userProperties = set;
  if (setOnce) update.setOnceProperties = setOnce;
  const unset = asRecord(ops.$unset);
  if (unset) update.unsetProperties = Object.keys(unset);
  return update;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}
