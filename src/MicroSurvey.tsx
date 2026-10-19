//
// MicroSurvey.tsx
//
// `<MicroSurvey surveyId>` — renders a specific survey **inline** in a screen
// (no overlay), e.g. in a settings or feedback screen. Pulls the survey from
// the cached config and records an impression + response when it closes. It
// ignores triggers and platform targeting: rendering it is an explicit choice.
//

import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { View, useColorScheme } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";
import type { Survey, SurveyResult } from "./core";
import { MicroSurveysContext } from "./provider";
import { SurveyCard } from "./ui/SurveyCard";
import { resolveTheme } from "./ui/theme";

export interface MicroSurveyProps {
  surveyId: string;
  /** Called with the outcome after the survey closes. */
  onComplete?: (result: SurveyResult) => void;
  /** Style for the card container (margins, width, …). */
  style?: StyleProp<ViewStyle>;
}

export function MicroSurvey({ surveyId, onComplete, style }: MicroSurveyProps) {
  const { instance, fontFamily } = useContext(MicroSurveysContext);
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [closed, setClosed] = useState(false);
  const shownAt = useRef<Date | null>(null);
  const result = useRef<SurveyResult | null>(null);

  useEffect(() => {
    if (!instance) return;
    // Fires once config is loaded, then on every refresh (the survey may not be cached yet).
    return instance.onConfigChange(() => setSurvey(instance.getSurvey(surveyId) ?? null));
  }, [instance, surveyId]);

  const projectTheme = instance?.getTheme();
  const theme = useMemo(() => resolveTheme(projectTheme, { scheme, fontFamily }), [projectTheme, scheme, fontFamily]);

  if (!instance || !survey || closed) return null;
  if (!shownAt.current) shownAt.current = new Date();

  return (
    <View
      style={[
        { backgroundColor: theme.surface, borderRadius: theme.cornerRadius, borderWidth: 1, borderColor: theme.border, overflow: "hidden" },
        style,
      ]}
    >
      <SurveyCard
        survey={survey}
        theme={theme}
        variant="inline"
        onResult={(r) => {
          result.current = r;
          instance.recordInline(survey, r, shownAt.current ?? new Date());
        }}
        onClose={() => {
          setClosed(true);
          if (result.current) onComplete?.(result.current);
        }}
      />
    </View>
  );
}
