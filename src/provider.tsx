//
// provider.tsx
//
// `<MicroSurveysProvider>` exposes a `MicroSurveys` instance to the tree,
// starts it, and mounts the overlay host that presents auto-triggered surveys
// (port of iOS `Presenter`). Pass `apiKey` for the simple case, or `instance`
// to share one created at module scope (e.g. for the Amplitude plugin).
//

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { ActiveSurvey } from "./core";
import { MicroSurveys } from "./MicroSurveys";
import { SurveyModal } from "./ui/SurveyModal";

interface ContextValue {
  instance: MicroSurveys | null;
  fontFamily?: string;
}

export const MicroSurveysContext = createContext<ContextValue>({ instance: null });

export interface MicroSurveysProviderProps {
  /** Project API key (`ms_live_…` / `ms_test_…`). Ignored when `instance` is passed. */
  apiKey?: string;
  /** Override the API base for self-hosted deployments. Ignored when `instance` is passed. */
  apiBaseURL?: string;
  /** Your app's version (e.g. "3.2.0"), sent with responses. Ignored when `instance` is passed. */
  appVersion?: string;
  /** A `MicroSurveys` you created yourself, e.g. to register its Amplitude plugin. */
  instance?: MicroSurveys;
  /** Start automatically on mount (load config, flush queued ingest). Default true. */
  autoStart?: boolean;
  /** A font family your app registered (e.g. with expo-font) to render surveys in.
   *  Defaults to the system font. */
  fontFamily?: string;
  children?: ReactNode;
}

export function MicroSurveysProvider({ apiKey, apiBaseURL, appVersion, instance, autoStart = true, fontFamily, children }: MicroSurveysProviderProps) {
  // Created once; later prop changes are ignored (remount the provider to switch keys).
  const [owned] = useState<MicroSurveys | null>(() => (!instance && apiKey ? new MicroSurveys({ apiKey, apiBaseURL, appVersion }) : null));
  const ms = instance ?? owned;

  useEffect(() => {
    if (!ms || !autoStart) return;
    ms.start();
    // Only stop an instance this provider created; a shared one outlives it.
    return () => owned?.stop();
  }, [ms, owned, autoStart]);

  const value = useMemo(() => ({ instance: ms, fontFamily }), [ms, fontFamily]);
  return (
    <MicroSurveysContext.Provider value={value}>
      {children}
      {ms && <OverlayHost instance={ms} fontFamily={fontFamily} />}
    </MicroSurveysContext.Provider>
  );
}

/** Presents auto-triggered surveys one at a time. A survey triggered while
 *  another is still on screen (e.g. during its "Thanks") waits its turn. */
function OverlayHost({ instance, fontFamily }: { instance: MicroSurveys; fontFamily?: string }) {
  const [current, setCurrent] = useState<{ active: ActiveSurvey; id: number } | null>(null);
  const queue = useRef<ActiveSurvey[]>([]);
  const showing = useRef(false);
  const nextId = useRef(0);

  useEffect(
    () =>
      instance.onPresent((active) => {
        if (showing.current) {
          queue.current.push(active);
          return;
        }
        showing.current = true;
        setCurrent({ active, id: nextId.current++ });
      }),
    [instance],
  );

  function showNext() {
    const next = queue.current.shift();
    if (next) {
      setCurrent({ active: next, id: nextId.current++ });
    } else {
      showing.current = false;
      setCurrent(null);
    }
  }

  return (
    <SurveyModal
      // A fresh modal per presentation, even when the same survey shows twice.
      key={current?.id ?? "none"}
      survey={current?.active.survey ?? null}
      theme={instance.getTheme()}
      fontFamily={fontFamily}
      onResult={(result) => current?.active.close(result)}
      onClose={showNext}
    />
  );
}

/** The `MicroSurveys` instance from the nearest provider (or null outside one). */
export function useMicroSurveysInstance(): MicroSurveys | null {
  return useContext(MicroSurveysContext).instance;
}

/** Event + identity helpers bound to the provider's instance. Safe no-ops
 *  outside a provider. */
export function useMicroSurveys() {
  const instance = useMicroSurveysInstance();
  return useMemo(
    () => ({
      instance,
      track: (name: string, properties?: Record<string, unknown>) => instance?.track(name, properties),
      identify: (userId: string | null | undefined, properties?: Record<string, unknown>) => instance?.identify(userId, properties),
      refresh: () => instance?.refreshConfig(),
    }),
    [instance],
  );
}
