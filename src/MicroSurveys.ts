//
// MicroSurveys.ts
//
// Public entry point, mirroring iOS `MicroSurveysSDK`. A host wires it up in a
// few lines, usually at module scope so it can be shared:
//
//     export const ms = new MicroSurveys({ apiKey: "ms_live_…" });
//     amplitude.add(ms.amplitudePlugin());   // forward events + identity
//     ms.start();                            // fetch config + flush outbox
//
// then mounts <MicroSurveysProvider instance={ms}> to render surveys. It wraps
// the survey engine (./core) with React Native storage (AsyncStorage), the
// `AppState` foreground signal and the device platform. Storage loads
// asynchronously, so calls made before it's ready are buffered and replayed in
// order.
//

import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, Platform } from "react-native";
import { createClient } from "./core";
import type {
  ActiveSurvey,
  AnalyticsIdentity,
  KeyValueStorage,
  MicroSurveysClient,
  ProjectTheme,
  Survey,
  SurveyResult,
} from "./core";
import { createAmplitudePlugin } from "./amplitude";
import type { MicroSurveysAmplitudePlugin } from "./amplitude";
import { hydrateAsyncStorage } from "./asyncStorage";
import type { AsyncKeyValueStorage } from "./asyncStorage";

/** Default API base. Override via `apiBaseURL` for self-hosted deployments. */
const DEFAULT_BASE_URL = "https://console.microsurveys.ai";
/** Cached config counts as fresh for 12h on app-foreground, like iOS. */
const DEFAULT_CONFIG_TTL_MS = 12 * 60 * 60 * 1000;

export interface MicroSurveysOptions {
  /** Project API key (`ms_live_…` / `ms_test_…`) from the dashboard. */
  apiKey: string;
  /** Override for self-hosted deployments. Defaults to https://console.microsurveys.ai. */
  apiBaseURL?: string;
  /** Refresh config (when stale) and retry queued ingest whenever the app returns
   *  to the foreground. Default true. */
  refreshOnForeground?: boolean;
  /** Foreground freshness window for the cached config, in ms. Default 12h. */
  configTTLms?: number;
  /** A synchronous store (e.g. MMKV) to persist into instead of AsyncStorage. */
  storage?: KeyValueStorage;
  /** An async store to persist into. Defaults to `@react-native-async-storage/async-storage`. */
  asyncStorage?: AsyncKeyValueStorage;
  /** Your app's version (e.g. "3.2.0"), sent with responses so results can be
   *  compared across releases. With Expo: `Application.nativeApplicationVersion`. */
  appVersion?: string;
}

function appStateForeground(onForeground: () => void): () => void {
  const sub = AppState.addEventListener("change", (state) => {
    if (state === "active") onForeground();
  });
  return () => sub.remove();
}

function appStateBackground(onBackground: () => void): () => void {
  const sub = AppState.addEventListener("change", (state) => {
    if (state === "background") onBackground();
  });
  return () => sub.remove();
}

export class MicroSurveys {
  readonly apiKey: string;
  /** Resolves with the underlying runtime once storage has loaded. */
  readonly ready: Promise<MicroSurveysClient>;

  private client: MicroSurveysClient | null = null;
  private pending: ((client: MicroSurveysClient) => void)[] = [];

  constructor(opts: MicroSurveysOptions) {
    this.apiKey = opts.apiKey;
    const storage: Promise<KeyValueStorage> = opts.storage
      ? Promise.resolve(opts.storage)
      : hydrateAsyncStorage(opts.asyncStorage ?? (AsyncStorage as unknown as AsyncKeyValueStorage));

    this.ready = storage.then((kv) => {
      const client = createClient({
        apiKey: opts.apiKey,
        apiBaseURL: opts.apiBaseURL ?? DEFAULT_BASE_URL,
        configTTLms: opts.configTTLms ?? DEFAULT_CONFIG_TTL_MS,
        refreshOnForeground: opts.refreshOnForeground ?? true,
        // Survey platform targeting: "ios" | "android".
        platform: Platform.OS,
        osVersion: String(Platform.Version),
        appVersion: opts.appVersion,
        storage: kv,
        subscribeForeground: appStateForeground,
        subscribeBackground: appStateBackground,
      });
      this.client = client;
      const queued = this.pending;
      this.pending = [];
      for (const run of queued) run(client);
      return client;
    });
  }

  /** Runs `fn` now if the runtime is ready, otherwise as soon as it is. */
  private withClient(fn: (client: MicroSurveysClient) => void): void {
    if (this.client) fn(this.client);
    else this.pending.push(fn);
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  /** Flushes queued impressions/responses, refreshes the config, and starts the
   *  foreground refresh. Safe to call once early in app launch (the provider
   *  calls it for you unless `autoStart={false}`). */
  start(): void {
    this.withClient((c) => c.start());
  }

  /** Stops foreground refresh and cancels pending (delayed) presentations. */
  stop(): void {
    this.withClient((c) => c.stop());
  }

  /** Forces an ETag-aware config refresh. Keeps the cache on failure. */
  async refreshConfig(): Promise<void> {
    const client = await this.ready;
    await client.refreshConfig();
  }

  // ── Identity + events ────────────────────────────────────────────────────────

  /** Identify the current user and/or attach properties used by audience
   *  targeting. Optional with Amplitude (identity flows in via the plugin). */
  identify(userId: string | null | undefined, properties?: Record<string, unknown>): void {
    this.withClient((c) => c.identify(userId, properties));
  }

  /** Record an event. An eligible survey presents itself after its configured
   *  delay. Not needed for events that already flow through Amplitude. */
  track(name: string, properties?: Record<string, unknown>): void {
    this.withClient((c) => c.track(name, properties));
  }

  /** Identity forwarded by an analytics SDK. Used by the Amplitude plugin. */
  updateAnalyticsIdentity(update: AnalyticsIdentity): void {
    this.withClient((c) => c.updateAnalyticsIdentity(update));
  }

  /** The enrichment plugin to register on your Amplitude instance:
   *  `amplitude.add(ms.amplitudePlugin())`. Forwards events + identity into the
   *  SDK and returns every event unmodified. */
  amplitudePlugin(): MicroSurveysAmplitudePlugin {
    return createAmplitudePlugin(this);
  }

  // ── Config + presentation (used by the provider and inline surveys) ──────────

  getTheme(): ProjectTheme | null {
    return this.client?.getTheme() ?? null;
  }

  getSurvey(surveyId: string): Survey | undefined {
    return this.client?.getSurvey(surveyId);
  }

  /** Subscribe to config loads/refreshes. Fires once when the cached config
   *  becomes available. Returns an unsubscribe function. */
  onConfigChange(cb: () => void): () => void {
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    this.withClient((c) => {
      if (cancelled) return;
      unsubscribe = c.onConfigChange(cb);
      cb();
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }

  /** Subscribe to auto-triggered surveys. Returns an unsubscribe function. */
  onPresent(cb: (active: ActiveSurvey) => void): () => void {
    let unsubscribe: (() => void) | null = null;
    let cancelled = false;
    this.withClient((c) => {
      if (!cancelled) unsubscribe = c.onPresent(cb);
    });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }

  /** Records the outcome of an inline `<MicroSurvey>`. */
  recordInline(survey: Survey, result: SurveyResult, shownAt: Date): void {
    this.withClient((c) => c.recordInline(survey, result, shownAt));
  }
}
