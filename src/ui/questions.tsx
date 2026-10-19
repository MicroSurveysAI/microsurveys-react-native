//
// questions.tsx
//
// One renderer per question type, ported from the iOS UI/*View.swift files.
// Each takes the question, the current answer, and an `onChange`, and emits the
// exact `AnswerValue` JSON the backend expects (API-CONTRACT §Answer value
// shapes). Every visual value comes from the resolved `SurveyTheme`.
//

import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { LayoutChangeEvent, TextStyle } from "react-native";
import type { AnswerValue, ChoiceOption, EmojiOption, Question } from "../core";
import { clampRadius } from "./theme";
import type { FontWeight, SurveyTheme } from "./theme";

export interface QuestionInputProps {
  question: Question;
  theme: SurveyTheme;
  value: AnswerValue | undefined;
  onChange: (value: AnswerValue | undefined) => void;
  /** Focus text inputs as soon as they show (overlays; not inline embeds). */
  autoFocus?: boolean;
}

export function QuestionInput({ question, theme, value, onChange, autoFocus }: QuestionInputProps) {
  const cfg = question.config;
  switch (cfg.kind) {
    case "scale":
      return <ScaleInput min={cfg.min} max={cfg.max} minLabel={cfg.minLabel} maxLabel={cfg.maxLabel} theme={theme} value={numValue(value)} onPick={(n) => onChange({ value: n })} />;
    case "stars":
      return <StarsInput count={cfg.count} theme={theme} value={numValue(value)} onPick={(n) => onChange({ value: n })} />;
    case "emoji":
      return <EmojiInput options={cfg.options} theme={theme} value={strValue(value)} onPick={(v) => onChange({ value: v })} />;
    case "thumbs":
      return <ThumbsInput theme={theme} value={strValue(value)} onPick={(v) => onChange({ value: v })} />;
    case "singleChoice":
      return <ChoiceInput options={cfg.options} theme={theme} value={value && "choice" in value ? value.choice : undefined} onPick={(v) => onChange({ choice: v })} />;
    case "openText":
      return (
        <OpenTextInput
          placeholder={cfg.placeholder}
          maxLength={cfg.maxLength}
          theme={theme}
          autoFocus={autoFocus}
          // Like iOS: the answer is the trimmed text, and empty text is no answer.
          onText={(t) => onChange(t.trim().length > 0 ? { text: t.trim() } : undefined)}
        />
      );
  }
}

/** Whether `value` satisfies the question's `required` rule. */
export function isAnswerValid(question: Question, value: AnswerValue | undefined): boolean {
  return question.required ? value !== undefined : true;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function numValue(v: AnswerValue | undefined): number | undefined {
  return v && "value" in v && typeof v.value === "number" ? v.value : undefined;
}
function strValue(v: AnswerValue | undefined): string | undefined {
  return v && "value" in v && typeof v.value === "string" ? v.value : undefined;
}

/** A text style at `size` (scaled by the theme's text scale) in the theme font. */
export function font(theme: SurveyTheme, size: number, weight: FontWeight = "400"): TextStyle {
  return { fontSize: size * theme.textScale, fontWeight: weight, fontFamily: theme.fontFamily };
}

/** Large controls shouldn't grow without bound under accessibility text sizes. */
const MAX_FONT_SCALE = 1.6;

// ── Scale (NPS / CES) ─────────────────────────────────────────────────────────

const CHIP_GAP = 8;
/** Minimum chip side, as iOS `ChipButton(minSide: 44)`. */
const CHIP_MIN_SIDE = 44;

function ScaleInput({ min, max, minLabel, maxLabel, theme, value, onPick }: { min: number; max: number; minLabel?: string; maxLabel?: string; theme: SurveyTheme; value: number | undefined; onPick: (n: number) => void }) {
  const [width, setWidth] = useState(0);
  // Defend against a malformed (reversed/equal) range from the backend.
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const points: number[] = [];
  for (let i = lo; i <= hi; i++) points.push(i);

  // Compact scales (≤7, e.g. CES 1–7) stretch to fill the row like a segmented
  // control, never taller than wide (so pills stay round). Wider scales (NPS
  // 0–10) wrap as centered rows of square chips.
  const compact = points.length <= 7;
  const chipWidth = compact && width > 0 ? (width - CHIP_GAP * (points.length - 1)) / points.length : CHIP_MIN_SIDE;
  const chipHeight = compact ? Math.min(theme.controlHeight, chipWidth) : CHIP_MIN_SIDE;
  const hasLabels = !!minLabel || !!maxLabel;

  return (
    <View onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      <View style={[styles.scaleRow, !compact && styles.wrap]}>
        {width > 0 &&
          points.map((n) => {
            const on = value === n;
            return (
              <Pressable
                key={n}
                accessibilityRole="button"
                accessibilityLabel={String(n)}
                accessibilityState={{ selected: on }}
                onPress={() => onPick(n)}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    width: compact ? chipWidth : undefined,
                    minWidth: compact ? undefined : CHIP_MIN_SIDE,
                    height: chipHeight,
                    borderRadius: clampRadius(theme.controlRadius, compact ? chipWidth : CHIP_MIN_SIDE, chipHeight),
                    backgroundColor: on ? theme.accent : theme.surface,
                    borderColor: on ? theme.accent : theme.border,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[font(theme, 16, "500"), { color: on ? theme.accentText : theme.text }]}>
                  {n}
                </Text>
              </Pressable>
            );
          })}
      </View>
      {hasLabels && (
        <View style={styles.endLabels}>
          <Text style={[font(theme, 13), styles.endLabel, { color: theme.secondaryText }]} numberOfLines={2}>
            {minLabel}
          </Text>
          <Text style={[font(theme, 13), styles.endLabel, { color: theme.secondaryText, textAlign: "right" }]} numberOfLines={2}>
            {maxLabel}
          </Text>
        </View>
      )}
    </View>
  );
}

// ── Stars (CSAT_STAR) ─────────────────────────────────────────────────────────

function StarsInput({ count, theme, value, onPick }: { count: number; theme: SurveyTheme; value: number | undefined; onPick: (n: number) => void }) {
  const stars: number[] = [];
  for (let i = 1; i <= Math.max(1, count); i++) stars.push(i);
  return (
    <View style={styles.starsRow}>
      {stars.map((n) => {
        const on = value !== undefined && n <= value;
        return (
          <Pressable
            key={n}
            accessibilityRole="button"
            accessibilityLabel={`${n} star${n === 1 ? "" : "s"}`}
            accessibilityState={{ selected: value === n }}
            onPress={() => onPick(n)}
            hitSlop={4}
            style={styles.star}
          >
            <Text allowFontScaling={false} style={{ fontSize: 38, lineHeight: 46, color: theme.accent }}>
              {on ? "★" : "☆"}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Emoji (CSAT_EMOJI) ────────────────────────────────────────────────────────

function EmojiInput({ options, theme, value, onPick }: { options: EmojiOption[]; theme: SurveyTheme; value: string | undefined; onPick: (v: string) => void }) {
  return (
    <View style={styles.emojiRow}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityLabel={o.label || o.value}
            accessibilityState={{ selected: on }}
            onPress={() => onPick(o.value)}
            style={({ pressed }) => [
              styles.emojiCell,
              {
                borderRadius: theme.controlRadius,
                backgroundColor: on ? theme.accentTintStrong : theme.surface,
                borderColor: on ? theme.accent : theme.border,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Text allowFontScaling={false} style={styles.emojiGlyph}>
              {o.emoji}
            </Text>
            {!!o.label && (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[font(theme, 13), { color: theme.secondaryText, textAlign: "center" }]}>
                {o.label}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Thumbs ────────────────────────────────────────────────────────────────────

function ThumbsInput({ theme, value, onPick }: { theme: SurveyTheme; value: string | undefined; onPick: (v: "up" | "down") => void }) {
  const sides = [
    { value: "up" as const, emoji: "👍", label: "Thumbs up" },
    { value: "down" as const, emoji: "👎", label: "Thumbs down" },
  ];
  return (
    <View style={styles.thumbsRow}>
      {sides.map((s) => {
        const on = value === s.value;
        return (
          <Pressable
            key={s.value}
            accessibilityRole="button"
            accessibilityLabel={s.label}
            accessibilityState={{ selected: on }}
            onPress={() => onPick(s.value)}
            style={({ pressed }) => [
              styles.thumb,
              {
                height: theme.controlHeight,
                borderRadius: clampRadius(theme.controlRadius, Infinity, theme.controlHeight),
                backgroundColor: on ? theme.accent : theme.surface,
                borderColor: on ? theme.accent : theme.border,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Text allowFontScaling={false} style={styles.thumbGlyph}>
              {s.emoji}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Single choice ─────────────────────────────────────────────────────────────

function ChoiceInput({ options, theme, value, onPick }: { options: ChoiceOption[]; theme: SurveyTheme; value: string | undefined; onPick: (v: string) => void }) {
  return (
    <View style={styles.choices}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="radio"
            accessibilityLabel={o.label}
            accessibilityState={{ checked: on }}
            onPress={() => onPick(o.value)}
            style={({ pressed }) => [
              styles.choice,
              {
                minHeight: theme.controlHeight,
                borderRadius: clampRadius(theme.controlRadius, Infinity, theme.controlHeight),
                backgroundColor: on ? theme.accentTint : theme.surface,
                borderColor: on ? theme.accent : theme.border,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Text style={[font(theme, 16), styles.choiceLabel, { color: theme.text }]}>{o.label}</Text>
            <View
              style={[
                styles.radio,
                on ? { backgroundColor: theme.accent, borderColor: theme.accent } : { borderColor: theme.border },
              ]}
            >
              {on && (
                <Text allowFontScaling={false} style={[styles.radioCheck, { color: theme.accentText }]}>
                  ✓
                </Text>
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Open text ─────────────────────────────────────────────────────────────────

function OpenTextInput({ placeholder, maxLength, theme, autoFocus, onText }: { placeholder?: string; maxLength?: number; theme: SurveyTheme; autoFocus?: boolean; onText: (t: string) => void }) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  return (
    <View>
      <TextInput
        multiline
        // Raise the keyboard as soon as the question shows, like iOS `activate()`.
        autoFocus={autoFocus}
        value={text}
        onChangeText={(t) => {
          setText(t);
          onText(t);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={theme.secondaryText}
        maxLength={maxLength}
        textAlignVertical="top"
        style={[
          font(theme, 16),
          styles.textArea,
          {
            minHeight: theme.controlHeight * 2,
            borderRadius: theme.controlRadius,
            borderColor: focused ? theme.accent : theme.border,
            backgroundColor: theme.surface,
            color: theme.text,
          },
        ]}
      />
      {maxLength !== undefined && (
        <Text style={[font(theme, 13), styles.counter, { color: theme.secondaryText }]}>
          {text.length}/{maxLength}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  scaleRow: { flexDirection: "row", gap: CHIP_GAP },
  wrap: { flexWrap: "wrap", justifyContent: "center" },
  chip: { borderWidth: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  endLabels: { flexDirection: "row", gap: 12, marginTop: 10, paddingHorizontal: 2 },
  endLabel: { flex: 1 },
  starsRow: { flexDirection: "row", justifyContent: "center", gap: 6, height: 48, alignItems: "center" },
  star: { paddingHorizontal: 2 },
  emojiRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", columnGap: 10, rowGap: 12 },
  emojiCell: { minWidth: 64, paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1, alignItems: "center", gap: 2 },
  emojiGlyph: { fontSize: 32, lineHeight: 40 },
  thumbsRow: { flexDirection: "row", gap: 16 },
  thumb: { flex: 1, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  thumbGlyph: { fontSize: 32, lineHeight: 40 },
  choices: { gap: 10 },
  choice: { flexDirection: "row", alignItems: "center", borderWidth: 1, paddingVertical: 14, paddingHorizontal: 16, gap: 12 },
  choiceLabel: { flex: 1 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  radioCheck: { fontSize: 13, lineHeight: 16, fontWeight: "700" },
  textArea: { borderWidth: 1, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12 },
  counter: { marginTop: 6, textAlign: "right" },
});
