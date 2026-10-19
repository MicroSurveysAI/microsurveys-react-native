//
// @microsurveysai/react-native
//
// React Native SDK for MicroSurveys. Surveys configured in the dashboard are
// evaluated on-device against the events you track (or forward from Amplitude)
// and presented natively as a bottom sheet or dialog.
//
//   export const ms = new MicroSurveys({ apiKey: "ms_live_…" });
//   amplitude.add(ms.amplitudePlugin());          // optional
//
//   <MicroSurveysProvider instance={ms}>
//     <App />
//   </MicroSurveysProvider>
//
//   ms.track("checkout_completed", { plan: "pro" });
//

export { MicroSurveys } from "./MicroSurveys";
export type { MicroSurveysOptions } from "./MicroSurveys";
export { MicroSurveysProvider, useMicroSurveys, useMicroSurveysInstance } from "./provider";
export type { MicroSurveysProviderProps } from "./provider";
export { MicroSurvey } from "./MicroSurvey";
export type { MicroSurveyProps } from "./MicroSurvey";
export { SurveyModal } from "./ui/SurveyModal";
export type { SurveyModalProps } from "./ui/SurveyModal";
export { hydrateAsyncStorage } from "./asyncStorage";
export type { AsyncKeyValueStorage } from "./asyncStorage";
export type { AmplitudeEvent, MicroSurveysAmplitudePlugin } from "./amplitude";

// Re-export the common wire types so consumers don't need a second import.
export { parseConfig } from "./core";
export type {
  Survey,
  Question,
  SurveyResult,
  SurveyAnswer,
  AnswerValue,
  ProjectTheme,
  KeyValueStorage,
} from "./core";
