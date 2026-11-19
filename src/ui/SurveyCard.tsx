//
// SurveyCard.tsx
//
// The content of a survey: progress ("1 of 3"), close button, the current
// question's prompt + input, and a primary Next/Submit button. Handles
// multi-step navigation, required-answer gating, the closing "Thanks" state and
// reporting the result. Port of iOS `SurveyViewController`'s card; the caller
// supplies the chrome (sheet, dialog, or inline container).
//

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { AccessibilityInfo, Animated, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { LayoutChangeEvent } from "react-native";
import { thanksDurationMs, thanksMessage } from "../core";
import type { AnswerValue, Survey, SurveyAnswer, SurveyResult } from "../core";
import { CloseButton } from "./CloseButton";
import { QuestionInput, font, isAnswerValid } from "./questions";
import type { SurveyTheme } from "./theme";

/** Bottom padding inside the scroll area, taken back from the button's margin. */
const CLIP_ROOM = 4;

export interface SurveyCardHandle {
  /** Dismiss as the user closing the survey (scrim tap, swipe, back button). */
  dismiss(): void;
}

export interface SurveyCardProps {
  survey: Survey;
  theme: SurveyTheme;
  /** "sheet" adds room for the drag grabber above the content. */
  variant: "sheet" | "dialog" | "inline";
  /** Space to keep below the primary button (e.g. the home-indicator inset). */
  bottomInset?: number;
  /** Called exactly once, as soon as the outcome is known (submit or dismiss). */
  onResult: (result: SurveyResult) => void;
  /** Called when the card is done: right after a dismissal, or after the
   *  "Thanks" confirmation following a submit. */
  onClose: () => void;
}

export const SurveyCard = forwardRef<SurveyCardHandle, SurveyCardProps>(function SurveyCard(
  { survey, theme, variant, bottomInset, onResult, onClose },
  ref,
) {
  const questions = useMemo(() => [...survey.questions].sort((a, b) => a.order - b.order), [survey]);
  const dismissible = survey.dismissible !== false;

  const [index, setIndex] = useState(0);
  // Answers commit when the user advances (Next/Submit), as on iOS, so a
  // dismissal reports only questions the user moved past.
  const committed = useRef<Record<string, AnswerValue>>({});
  const [current, setCurrent] = useState<AnswerValue | undefined>(undefined);
  const [done, setDone] = useState(false);
  const [height, setHeight] = useState(0);
  const reported = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closed = useRef(false);
  const unmounted = useRef(false);

  useEffect(() => () => {
    unmounted.current = true;
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  /** Close the "Thanks" state once: on its timer or when the user taps it. */
  function closeThanks() {
    if (closed.current) return;
    closed.current = true;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    onClose();
  }

  /** Start the "Thanks" timer: sized to the message, doubled for screen readers. */
  function startThanksTimer() {
    const ms = thanksDurationMs(survey.successMessage, survey.successPace);
    const schedule = (screenReader: boolean) => {
      if (closed.current || unmounted.current || closeTimer.current) return;
      closeTimer.current = setTimeout(closeThanks, screenReader ? ms * 2 : ms);
    };
    AccessibilityInfo.isScreenReaderEnabled().then(schedule, () => schedule(false));
  }

  const question = questions[index];
  const isLast = index >= questions.length - 1;
  const valid = question ? isAnswerValid(question, current) : false;

  function collected(): SurveyAnswer[] {
    return questions.filter((q) => committed.current[q.id] !== undefined).map((q) => ({ questionId: q.id, value: committed.current[q.id]! }));
  }

  function report(completed: boolean) {
    if (reported.current) return false;
    reported.current = true;
    onResult({ answers: collected(), completed, dismissed: !completed });
    return true;
  }

  function dismiss() {
    if (report(false)) onClose();
  }

  useImperativeHandle(ref, () => ({ dismiss }));

  // A survey with no questions (misconfigured) has nothing to show.
  useEffect(() => {
    if (questions.length === 0) dismiss();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function advance() {
    if (!question || !valid) return;
    if (current !== undefined) committed.current[question.id] = current;
    if (!isLast) {
      setIndex(index + 1);
      setCurrent(undefined);
      return;
    }
    if (report(true)) {
      setDone(true);
      startThanksTimer();
    }
  }

  const pad = theme.spacing + 4;
  // Extra top room on the sheet so the title and close button clear the grabber.
  const topInset = variant === "sheet" ? pad + 12 : pad;
  const hasProgress = questions.length > 1;

  if (!question) return null;

  if (done) {
    return (
      // Keep the card's height so the sheet doesn't jump when the content swaps.
      // Tapping the thanks closes it at once.
      <Pressable
        onPress={closeThanks}
        accessibilityLiveRegion="polite"
        accessibilityHint="Closes the survey"
        style={[styles.thanks, { minHeight: height, padding: pad }]}
      >
        <FadeIn>
          <View style={styles.thanksStack}>
            <View style={[styles.check, { backgroundColor: theme.accent }]}>
              <Text allowFontScaling={false} style={[styles.checkGlyph, { color: theme.accentText }]}>
                ✓
              </Text>
            </View>
            <Text style={[promptStyle(theme), { color: theme.text, textAlign: "center", marginTop: theme.spacing }]}>{thanksMessage(survey.successMessage)}</Text>
          </View>
        </FadeIn>
      </Pressable>
    );
  }

  return (
    <View onLayout={(e: LayoutChangeEvent) => setHeight(e.nativeEvent.layout.height)} style={styles.card}>
      {hasProgress && (
        <Text style={[font(theme, 13), { color: theme.secondaryText, marginTop: topInset, marginHorizontal: pad }]}>
          {index + 1} of {questions.length}
        </Text>
      )}

      <ScrollView
        style={styles.scroll}
        // A little room under the last control, so its border never sits on the
        // scroll view's clipping edge (Android snaps that edge to whole pixels and
        // shaved the bottom of the text field). The button's margin gives it back.
        contentContainerStyle={{ paddingHorizontal: pad, paddingTop: hasProgress ? theme.spacing : topInset, paddingBottom: CLIP_ROOM, gap: theme.spacing + 8 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <FadeIn key={question.id}>
          <View style={{ gap: theme.spacing + 8 }}>
            <Text accessibilityRole="header" style={[promptStyle(theme), { color: theme.text, paddingRight: dismissible ? 48 : 0 }]}>
              {question.prompt}
            </Text>
            <QuestionInput question={question} theme={theme} value={current} onChange={setCurrent} autoFocus={variant !== "inline"} />
          </View>
        </FadeIn>
      </ScrollView>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !valid }}
        disabled={!valid}
        onPress={advance}
        style={({ pressed }) => [
          styles.button,
          {
            height: theme.controlHeight,
            marginTop: theme.spacing - CLIP_ROOM,
            marginHorizontal: pad,
            marginBottom: Math.max(pad, bottomInset ?? 0),
            borderRadius: Math.min(theme.controlRadius, theme.controlHeight / 2),
            backgroundColor: theme.accent,
            opacity: !valid ? 0.45 : pressed ? 0.9 : 1,
          },
        ]}
      >
        <Text maxFontSizeMultiplier={1.6} style={[font(theme, 16, "600"), { color: theme.accentText }]}>
          {isLast ? "Submit" : "Next"}
        </Text>
      </Pressable>

      {dismissible && (
        <CloseButton
          theme={theme}
          onPress={dismiss}
          // iOS pins the 44pt button `pad` from the card's top-right corner.
          style={Platform.OS === "ios" ? { top: pad, right: pad } : { top: variant === "sheet" ? pad + 4 : pad - 6, right: pad - 6 }}
        />
      )}
    </View>
  );
});

function promptStyle(theme: SurveyTheme) {
  return {
    fontSize: theme.titleSize,
    fontWeight: theme.titleWeight,
    fontFamily: theme.fontFamily,
    // iOS applies `lineHeightMultiple` to the font's natural line height (~1.2em).
    lineHeight: Math.round(theme.titleSize * 1.2 * theme.titleLineHeight),
    letterSpacing: theme.titleLetterSpacing,
    textAlign: theme.align,
  } as const;
}

/** Fades its children in on mount (question changes, the thanks state). */
function FadeIn({ children }: { children: ReactNode }) {
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    // JS driver: a native-driven opacity is re-committed as 0 when the keyboard
    // re-lays out the card (see SurveyModal).
    Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: false }).start();
  }, [opacity]);
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  card: { flexShrink: 1 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  button: { alignItems: "center", justifyContent: "center" },
  thanks: { alignItems: "center", justifyContent: "center" },
  // Stretch so a long message wraps inside the card instead of overflowing it.
  thanksStack: { alignItems: "center", alignSelf: "stretch" },
  check: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  checkGlyph: { fontSize: 26, fontWeight: "700", lineHeight: 30 },
});
