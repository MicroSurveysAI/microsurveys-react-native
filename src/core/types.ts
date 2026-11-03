//
// types.ts
//
// TypeScript mirror of the SDK API wire contract and the iOS
// `Models.swift` / `RuntimeModels.swift`. Also includes the loose→typed config
// normalization (port of `Question.buildConfig` / `Trigger.init(from:)`) so the
// rest of the engine works against fully-defaulted values.
//

// ── JSON ────────────────────────────────────────────────────────────────────

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };

// ── Questions ───────────────────────────────────────────────────────────────

export type QuestionType =
  | "NPS"
  | "CES"
  | "CSAT_STAR"
  | "CSAT_EMOJI"
  | "THUMBS"
  | "SINGLE_CHOICE"
  | "OPEN_TEXT";

export interface EmojiOption {
  value: string;
  emoji: string;
  label?: string;
}

export interface ChoiceOption {
  value: string;
  label: string;
}

/** Typed, defaulted per-type config — port of iOS `QuestionConfig`. NPS and CES
 *  share the numeric-scale shape; `type` disambiguates defaults + answer shape. */
export type QuestionConfig =
  | { kind: "scale"; min: number; max: number; minLabel?: string; maxLabel?: string }
  | { kind: "stars"; count: number }
  | { kind: "emoji"; options: EmojiOption[] }
  | { kind: "thumbs" }
  | { kind: "singleChoice"; options: ChoiceOption[] }
  | { kind: "openText"; placeholder?: string; maxLength?: number };

export interface Question {
  id: string;
  order: number;
  type: QuestionType;
  prompt: string;
  required: boolean;
  config: QuestionConfig;
}

// ── Triggers ──────────────────────────────────────────────────────────────

export type TriggerType = "SINGLE" | "SEQUENCE";

export interface TriggerStep {
  order: number;
  event: string;
  match: JsonObject;
}

export interface Trigger {
  id: string;
  type: TriggerType;
  delaySeconds: number;
  sequenceWindowSeconds: number | null;
  fireEvery: number;
  warmupCount: number;
  steps: TriggerStep[];
}

// ── Survey + config envelope ─────────────────────────────────────────────────

export interface Survey {
  id: string;
  name: string;
  questions: Question[];
  audienceMatch?: JsonObject | null;
  samplePercent?: number | null;
  maxPerUserDays?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  triggers?: Trigger[] | null;
  /** `false` = required: hide the close button + block scrim/swipe dismissal. */
  dismissible?: boolean | null;
  /** `"sheet"` | `"dialog"` | null (inherit the project theme's position). */
  presentation?: string | null;
  successMessage?: string | null;
  /** Platform targeting for auto-presentation. Empty/absent = all platforms.
   *  The engine skips a survey whose list is non-empty and excludes the client's
   *  platform. Explicit inline `<MicroSurvey>` embeds ignore this. */
  platforms?: string[] | null;
}

export interface SDKConfig {
  projectId: string;
  fetchedAt?: string | null;
  theme: ProjectTheme | null;
  surveys: Survey[];
  /** The project turned event signals on: count tracked events and upload the
   *  counts (see eventCounter.ts). Absent on older servers, which means off. */
  eventSignals: boolean;
  /** Hashes of the project's test devices for the live debugger (see debug.ts).
   *  Empty when none are set, or on older servers. */
  debugUsers: string[];
  /** The project has server events waiting to be picked up: check the mailbox
   *  (`POST /api/sdk/pending`). Absent on older servers, which means off. */
  pendingEvents: boolean;
  /** Trigger event names that arrive by server stream rather than from the app.
   *  A sequence waiting on one of them as its next step checks more often. */
  serverEvents: string[];
}

/** Brand-level survey appearance (API-CONTRACT §Theme). All keys optional. */
export interface ProjectTheme {
  accent?: string;
  accentText?: string;
  background?: string;
  surface?: string;
  text?: string;
  secondaryText?: string;
  border?: string;
  cornerRadius?: number | null;
  controlRadius?: number;
  controlPill?: boolean;
  controlHeight?: number;
  spacing?: number;
  textScale?: number;
  position?: string; // "bottom" | "center"
  alignment?: string; // "leading" | "center"
  font?: string;
  titleSize?: number;
  titleWeight?: string;
  titleLineHeight?: number;
  titleLetterSpacing?: number;
}

// ── Device context ───────────────────────────────────────────────────────────

/** Where a survey was shown, sent with impressions and responses so results can
 *  be broken down by platform, release and language (API-CONTRACT "Device
 *  context"). Every field is optional; unknown ones are left out. */
export interface DeviceContext {
  platform?: string;
  appVersion?: string;
  osVersion?: string;
  locale?: string;
}

// ── Identity ─────────────────────────────────────────────────────────────────

export interface Identity {
  /** Amplitude user id, forwarded by an analytics plugin (e.g. React Native's). */
  amplitudeUserId?: string;
  /** Amplitude device id, forwarded by an analytics plugin. */
  amplitudeDeviceId?: string;
  /** Host-supplied id from `identify()`, for non-Amplitude integrations. */
  hostUserId?: string;
  /** Stable, persisted anonymous id — the final fallback. */
  anonymousId: string;
  /** User properties used for `audienceMatch`. */
  userProperties: JsonObject;
}

/** `endUserId` = Amplitude userId ?? deviceId ?? host id ?? anonymous id — the
 *  same order as iOS `MSIdentity.endUserId`. */
export function endUserIdOf(identity: Identity): string {
  return identity.amplitudeUserId ?? identity.amplitudeDeviceId ?? identity.hostUserId ?? identity.anonymousId;
}

// ── Answers / result ─────────────────────────────────────────────────────────

/** The exact JSON submitted under `answers[].value`, keyed per question type
 *  (API-CONTRACT §Answer value shapes). */
export type AnswerValue =
  | { value: number } // NPS / CES / CSAT_STAR
  | { value: "up" | "down" } // THUMBS
  | { value: string } // CSAT_EMOJI (chosen option value)
  | { choice: string } // SINGLE_CHOICE
  | { text: string }; // OPEN_TEXT

export interface SurveyAnswer {
  questionId: string;
  value: AnswerValue;
}

/** Outcome handed back when the survey UI closes. */
export interface SurveyResult {
  answers: SurveyAnswer[];
  /** `true` if the user advanced through and submitted the final question. */
  completed: boolean;
  /** `true` if closed/dismissed before completing. */
  dismissed: boolean;
}

// ── Persisted trigger state (port of Persistence.swift structs) ──────────────

export interface TriggerRecord {
  /** Next sequence step index expected (0 = waiting for step 0). */
  stepIndex: number;
  /** Unix seconds when step 0 was matched, to enforce `sequenceWindowSeconds`. */
  startedAt: number | null;
  /** How many times the trigger's full condition has been satisfied. */
  satisfiedCount: number;
}

export interface SurveyRecord {
  /** Unix seconds the survey was last shown to this user, for `maxPerUserDays`. */
  lastShownAt?: number | null;
  /** Sticky sampling decision (computed once, reused forever). */
  sampleDecision?: boolean | null;
}

export interface UserTriggerState {
  triggers: Record<string, TriggerRecord>;
  surveys: Record<string, SurveyRecord>;
}

export function newTriggerRecord(): TriggerRecord {
  return { stepIndex: 0, startedAt: null, satisfiedCount: 0 };
}

export function newUserTriggerState(): UserTriggerState {
  return { triggers: {}, surveys: {} };
}

// ── Config parsing / normalization (port of the Codable inits) ───────────────

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function numOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function strOrUndef(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

// Upper bounds on what a config can make the SDK draw. A scale, star row or option list is drawn
// one control per item, so an absurd value (count: 1000000000) would freeze the app. Real surveys
// sit far below these; the server applies the same bounds before sending the config.
const MAX_SCALE_POINTS = 101;
const MAX_SCALE_ABS = 1000;
const MAX_STARS = 100;
const MAX_OPTIONS = 100;

function boundedScale(min: number, max: number): { min: number; max: number } {
  const lo = Math.min(Math.max(min, -MAX_SCALE_ABS), MAX_SCALE_ABS);
  let hi = Math.min(Math.max(max, -MAX_SCALE_ABS), MAX_SCALE_ABS);
  if (hi - lo > MAX_SCALE_POINTS - 1) hi = lo + MAX_SCALE_POINTS - 1;
  return { min: lo, max: hi };
}

function boundedOptions(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw.slice(0, MAX_OPTIONS) : [];
}

function normalizeConfig(type: QuestionType, raw: Record<string, unknown>): QuestionConfig {
  switch (type) {
    case "NPS":
      return { kind: "scale", ...boundedScale(numOr(raw.min, 0), numOr(raw.max, 10)), minLabel: strOrUndef(raw.minLabel), maxLabel: strOrUndef(raw.maxLabel) };
    case "CES":
      return { kind: "scale", ...boundedScale(numOr(raw.min, 1), numOr(raw.max, 7)), minLabel: strOrUndef(raw.minLabel), maxLabel: strOrUndef(raw.maxLabel) };
    case "CSAT_STAR":
      return { kind: "stars", count: Math.min(numOr(raw.count, 5), MAX_STARS) };
    case "CSAT_EMOJI": {
      const opts = boundedOptions(raw.options);
      const options: EmojiOption[] = opts.map((o) => {
        const oo = asObject(o);
        return { value: String(oo.value ?? ""), emoji: typeof oo.emoji === "string" ? oo.emoji : "", label: strOrUndef(oo.label) };
      });
      return { kind: "emoji", options };
    }
    case "THUMBS":
      return { kind: "thumbs" };
    case "SINGLE_CHOICE": {
      const opts = boundedOptions(raw.options);
      const options: ChoiceOption[] = opts.map((o) => {
        const oo = asObject(o);
        const value = String(oo.value ?? "");
        return { value, label: typeof oo.label === "string" ? oo.label : value };
      });
      return { kind: "singleChoice", options };
    }
    case "OPEN_TEXT":
      return { kind: "openText", placeholder: strOrUndef(raw.placeholder), maxLength: typeof raw.maxLength === "number" ? raw.maxLength : undefined };
  }
}

function normalizeQuestion(raw: Record<string, unknown>): Question | null {
  const id = strOrUndef(raw.id);
  const type = strOrUndef(raw.type) as QuestionType | undefined;
  const prompt = strOrUndef(raw.prompt);
  if (!id || !type || prompt === undefined) return null;
  return {
    id,
    order: numOr(raw.order, 0),
    type,
    prompt,
    required: raw.required === true,
    config: normalizeConfig(type, asObject(raw.config)),
  };
}

function normalizeTrigger(raw: Record<string, unknown>): Trigger | null {
  const id = strOrUndef(raw.id);
  if (!id) return null;
  const type: TriggerType = raw.type === "SEQUENCE" ? "SEQUENCE" : "SINGLE";
  const steps: TriggerStep[] = (Array.isArray(raw.steps) ? raw.steps : [])
    .map((s) => {
      const so = asObject(s);
      const event = strOrUndef(so.event);
      if (!event) return null;
      return { order: numOr(so.order, 0), event, match: asObject(so.match) as JsonObject };
    })
    .filter((s): s is TriggerStep => s !== null);
  return {
    id,
    type,
    delaySeconds: numOr(raw.delaySeconds, 0),
    sequenceWindowSeconds: typeof raw.sequenceWindowSeconds === "number" ? raw.sequenceWindowSeconds : null,
    fireEvery: numOr(raw.fireEvery, 1),
    warmupCount: numOr(raw.warmupCount, 0),
    steps,
  };
}

function normalizeSurvey(raw: Record<string, unknown>): Survey | null {
  const id = strOrUndef(raw.id);
  const name = strOrUndef(raw.name);
  if (!id || name === undefined) return null;
  const questions = (Array.isArray(raw.questions) ? raw.questions : [])
    .map((q) => normalizeQuestion(asObject(q)))
    .filter((q): q is Question => q !== null);
  const triggers = (Array.isArray(raw.triggers) ? raw.triggers : [])
    .map((t) => normalizeTrigger(asObject(t)))
    .filter((t): t is Trigger => t !== null);
  return {
    id,
    name,
    questions,
    audienceMatch: (raw.audienceMatch as JsonObject | null) ?? null,
    samplePercent: typeof raw.samplePercent === "number" ? raw.samplePercent : null,
    maxPerUserDays: typeof raw.maxPerUserDays === "number" ? raw.maxPerUserDays : null,
    startsAt: strOrUndef(raw.startsAt) ?? null,
    endsAt: strOrUndef(raw.endsAt) ?? null,
    triggers,
    dismissible: typeof raw.dismissible === "boolean" ? raw.dismissible : null,
    presentation: strOrUndef(raw.presentation) ?? null,
    successMessage: strOrUndef(raw.successMessage) ?? null,
    platforms: Array.isArray(raw.platforms) ? raw.platforms.filter((p): p is string => typeof p === "string") : null,
  };
}

/** Parse a raw `/api/sdk/config` JSON string into a fully-normalized `SDKConfig`.
 *  Returns `null` if the payload is unusable. Lenient by design — the SDK must
 *  keep working against an older/newer server shape. */
export function parseConfig(rawText: string): SDKConfig | null {
  let root: Record<string, unknown>;
  try {
    root = asObject(JSON.parse(rawText));
  } catch {
    return null;
  }
  const projectId = strOrUndef(root.projectId);
  if (!projectId) return null;
  const surveys = (Array.isArray(root.surveys) ? root.surveys : [])
    .map((s) => normalizeSurvey(asObject(s)))
    .filter((s): s is Survey => s !== null);
  const theme = root.theme && typeof root.theme === "object" && !Array.isArray(root.theme) ? (root.theme as ProjectTheme) : null;
  return { projectId, fetchedAt: strOrUndef(root.fetchedAt) ?? null, theme,
    surveys,
    eventSignals: root.eventSignals === true,
    debugUsers: Array.isArray(root.debugUsers) ? root.debugUsers.filter((h): h is string => typeof h === "string") : [],
    pendingEvents: root.pendingEvents === true,
    serverEvents: Array.isArray(root.serverEvents) ? root.serverEvents.filter((n): n is string => typeof n === "string") : [],
  };
}
