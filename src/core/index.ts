//
// core
//
// The survey engine: on-device trigger evaluation, deterministic sampling,
// frequency caps, the config cache and offline ingest. A port of the iOS SDK's
// runtime; the wire contract and the cross-platform rules (FNV-1a sampling,
// trigger sequencing, eligibility order) must stay identical to iOS. No UI and
// no React Native imports: `MicroSurveys` wires it to the device.
//

export { createClient, MicroSurveysClient } from "./client";
export type { CreateClientOptions, ActiveSurvey } from "./client";
export { IdentityStore } from "./identity";
export type { AnalyticsIdentity } from "./identity";
export { memoryStorage, STORAGE_KEY_PREFIX } from "./storage";
export type { KeyValueStorage } from "./storage";
export { parseConfig, endUserIdOf } from "./types";
export type {
  Json,
  JsonObject,
  QuestionType,
  QuestionConfig,
  EmojiOption,
  ChoiceOption,
  Question,
  Trigger,
  Survey,
  SDKConfig,
  ProjectTheme,
  Identity,
  AnswerValue,
  SurveyAnswer,
  SurveyResult,
} from "./types";
