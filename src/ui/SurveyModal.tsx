//
// SurveyModal.tsx
//
// Presents one survey over the app as a bottom sheet (grabber, swipe down to
// dismiss) or a centered dialog, per the survey's `presentation` or the project
// theme's `position`. Port of iOS `SurveyViewController`'s presentation: dims
// the app, avoids the keyboard, respects safe areas, and blocks every dismissal
// path for `dismissible: false` surveys.
//
// Exported so hosts can preview a survey without a backend (as the demo app
// does); auto-triggered surveys are presented by <MicroSurveysProvider>.
//

import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import {
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  View,
  useColorScheme,
  useWindowDimensions,
} from "react-native";
import type { LayoutChangeEvent, PanResponderGestureState } from "react-native";
import { SafeAreaProvider, initialWindowMetrics, useSafeAreaInsets } from "react-native-safe-area-context";
import type { ProjectTheme, Survey, SurveyResult } from "../core";
import { SurveyCard } from "./SurveyCard";
import type { SurveyCardHandle } from "./SurveyCard";
import { FLOATING_SHEET_INSET, FLOATING_SHEET_RADIUS, usesGlassChrome } from "./platform";
import { resolveTheme } from "./theme";
import type { SurveyTheme } from "./theme";

export interface SurveyModalProps {
  /** The survey to show; the modal is visible while this is non-null. */
  survey: Survey | null;
  /** The dashboard theme (`/api/sdk/config` → `theme`). Defaults apply when absent. */
  theme?: ProjectTheme | null;
  /** A font family your app registered (e.g. with expo-font). Defaults to the system font. */
  fontFamily?: string;
  /** Called once with the outcome, as soon as it is known. */
  onResult?: (result: SurveyResult) => void;
  /** Called after the survey has animated away. Clear `survey` here. */
  onClose?: () => void;
}

export function SurveyModal({ survey, theme: projectTheme, fontFamily, onResult, onClose }: SurveyModalProps) {
  const scheme = useColorScheme() === "dark" ? "dark" : "light";
  const theme = useMemo(
    () => resolveTheme(projectTheme, { scheme, presentation: survey?.presentation, fontFamily }),
    [projectTheme, scheme, survey?.presentation, fontFamily],
  );

  const card = useRef<SurveyCardHandle>(null);

  if (!survey) return null;
  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      // Android back button.
      onRequestClose={() => {
        if (survey.dismissible !== false) card.current?.dismiss();
      }}
    >
      {/* The modal is its own native window; give it its own safe-area context. */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <Presentation key={survey.id} card={card} survey={survey} theme={theme} onResult={onResult} onClose={onClose} />
      </SafeAreaProvider>
    </Modal>
  );
}

interface PresentationProps {
  card: RefObject<SurveyCardHandle | null>;
  survey: Survey;
  theme: SurveyTheme;
  onResult?: (result: SurveyResult) => void;
  onClose?: () => void;
}

function Presentation({ card, survey, theme, onResult, onClose }: PresentationProps) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const isSheet = theme.position === "bottom";
  const dismissible = survey.dismissible !== false;
  // iOS 26+ sheets float inset from the edges on Face ID iPhones (home-button
  // devices have no bottom inset and keep an edge-to-edge sheet). UIKit doesn't
  // lay a floating sheet out narrower: it lays out the full-width sheet and
  // scales it down to fit the inset, so everything inside renders at ~96%.
  // Do the same so text wraps and controls size exactly like the native SDK.
  const floating = isSheet && usesGlassChrome && insets.bottom > 0;
  const floatScale = floating ? (window.width - 2 * FLOATING_SHEET_INSET) / window.width : 1;
  // Radii are drawn before the scale, so pre-divide to land on the native value.
  const sheetRadius = floating && theme.nativeSheetCorners ? FLOATING_SHEET_RADIUS / floatScale : theme.sheetCornerRadius;
  // Dim behind the survey: a system sheet dims 20% black on iOS (32% scrim on
  // Android, per Material); the dialog uses the configured background at 40%,
  // as the iOS SDK's custom card does.
  const scrim = isSheet ? (Platform.OS === "ios" ? "rgba(0, 0, 0, 0.2)" : "rgba(0, 0, 0, 0.32)") : theme.scrim;

  // 0 = hidden, 1 = shown. `drag` follows a swipe-down on the sheet.
  const progress = useRef(new Animated.Value(0)).current;
  const drag = useRef(new Animated.Value(0)).current;
  const [sheetHeight, setSheetHeight] = useState(window.height);
  const sheetTop = useRef(window.height);
  // Height of the on-screen keyboard (0 when hidden).
  const [keyboard, setKeyboard] = useState(0);
  const keyboardUp = keyboard > 0;
  // On iOS the sheet stays pinned to the bottom and extends behind the keyboard,
  // insetting its content instead of lifting as a whole (as the native SDK does
  // via additionalSafeAreaInsets). Dialogs and Android sheets just move up.
  const insetForKeyboard = isSheet && Platform.OS === "ios";
  // That inset is a spacer under the card, animated alongside the keyboard. It's
  // local on purpose: LayoutAnimation is app-wide, and replaying committed props
  // made native-driven views (the dialog mid fade-in) snap back to opacity 0.
  const keyboardSpacer = useRef(new Animated.Value(0)).current;
  const keyboardDuration = useRef(250);

  // These run on the JS driver on purpose. A native-driven value never reaches
  // React, so when the keyboard re-lays out the modal, React re-commits the
  // starting value (opacity 0, off-screen) and the survey vanishes on screen.
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: isSheet ? 320 : 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [progress, isSheet]);

  useEffect(() => {
    const update = (height: number, duration?: number) => {
      // iOS reports the keyboard's animation duration; match it.
      if (duration) keyboardDuration.current = duration;
      setKeyboard(height);
    };
    const show = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", (e) =>
      update(e.endCoordinates.height, e.duration),
    );
    const hide = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", (e) => update(0, e.duration));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  // The card keeps `pad` above the keyboard; the spacer covers the rest. The
  // floating sheet's bottom edge sits FLOATING_SHEET_INSET up and its content is scaled.
  const spacerTarget = insetForKeyboard && keyboard > 0 ? (keyboard - (floating ? FLOATING_SHEET_INSET : 0)) / floatScale : 0;
  useEffect(() => {
    Animated.timing(keyboardSpacer, {
      toValue: spacerTarget,
      duration: keyboardDuration.current,
      easing: Easing.bezier(0.17, 0.59, 0.4, 0.77), // close to the iOS keyboard curve
      useNativeDriver: false,
    }).start();
  }, [keyboardSpacer, spacerTarget]);

  function animateOut() {
    Keyboard.dismiss();
    Animated.timing(progress, { toValue: 0, duration: 240, easing: Easing.in(Easing.cubic), useNativeDriver: false }).start(() => onClose?.());
  }

  function requestDismiss() {
    if (dismissible) card.current?.dismiss();
  }

  const pan = useMemo(
    () =>
      PanResponder.create({
        // Own touches that start in the sheet's header band (grabber, progress) from
        // the start: otherwise a responder higher up the tree (e.g. a draggable
        // dev overlay at the app root) claims them and the sheet never sees the
        // drag. Buttons in the band (close) are deeper and still win taps.
        onStartShouldSetPanResponder: (e) => isSheet && dismissible && e.nativeEvent.pageY - sheetTop.current < DRAG_HEADER_HEIGHT,
        // Elsewhere, take over a downward drag nothing inside wanted.
        onMoveShouldSetPanResponder: (_, g) => isSheet && dismissible && isDownwardDrag(g),
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, g) => drag.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_, g) => {
          if (isDownwardDrag(g) && (g.dy > 120 || g.vy > 1)) requestDismiss();
          else Animated.spring(drag, { toValue: 0, useNativeDriver: false, bounciness: 0 }).start();
        },
        onPanResponderTerminate: () => Animated.spring(drag, { toValue: 0, useNativeDriver: false, bounciness: 0 }).start(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isSheet, dismissible],
  );

  const cardContent = (
    <SurveyCard
      ref={card}
      survey={survey}
      theme={theme}
      variant={isSheet ? "sheet" : "dialog"}
      // The sheet runs under the home indicator; keep the button above it
      // (unless the keyboard is up, which already lifts the sheet).
      bottomInset={isSheet && !keyboardUp ? insets.bottom : 0}
      onResult={(r) => onResult?.(r)}
      onClose={animateOut}
    />
  );

  return (
    <View style={StyleSheet.absoluteFill} accessibilityViewIsModal>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: scrim, opacity: progress }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={requestDismiss}
          // Not a VoiceOver/TalkBack element (as on iOS): the close button and
          // the platform's escape gesture already dismiss.
          accessible={false}
          importantForAccessibility="no"
        />
      </Animated.View>

      <KeyboardAvoidingView
        behavior={insetForKeyboard ? undefined : Platform.OS === "ios" ? "padding" : "height"}
        // The dialog centers in the safe area, like iOS. (Its bottom inset is a
        // margin on the dialog: this view's paddingBottom belongs to the keyboard.)
        style={[styles.fill, isSheet ? styles.bottom : [styles.center, { paddingTop: insets.top }]]}
        pointerEvents="box-none"
      >
        {isSheet ? (
          <Animated.View
            {...pan.panHandlers}
            onLayout={(e: LayoutChangeEvent) => {
              setSheetHeight(e.nativeEvent.layout.height);
              sheetTop.current = e.nativeEvent.layout.y;
            }}
            style={[
              styles.sheet,
              shadow,
              floating
                ? {
                    borderRadius: sheetRadius,
                    borderCurve: "continuous",
                    borderWidth: StyleSheet.hairlineWidth / floatScale,
                    borderColor: theme.dark ? "rgba(255, 255, 255, 0.14)" : "rgba(0, 0, 0, 0.18)",
                  }
                : { borderTopLeftRadius: sheetRadius, borderTopRightRadius: sheetRadius, borderCurve: "continuous" },
              {
                maxHeight: window.height - insets.top - 24,
                backgroundColor: theme.surface,
                transform: [
                  {
                    translateY: Animated.add(
                      progress.interpolate({
                        inputRange: [0, 1],
                        // Shown: scaling about the center lifts the bottom edge by
                        // h(1-s)/2; shift so it rests FLOATING_SHEET_INSET above the screen edge.
                        outputRange: [sheetHeight, floating ? (sheetHeight * (1 - floatScale)) / 2 - FLOATING_SHEET_INSET : 0],
                      }),
                      drag,
                    ),
                  },
                  { scale: floatScale },
                ],
              },
            ]}
          >
            <View style={[styles.grabber, { backgroundColor: theme.secondaryText }]} />
            {cardContent}
            {insetForKeyboard && <Animated.View style={{ height: keyboardSpacer }} />}
          </Animated.View>
        ) : (
          <Animated.View
            style={[
              styles.dialog,
              shadow,
              {
                maxHeight: window.height - insets.top - insets.bottom - 48,
                marginBottom: insets.bottom,
                backgroundColor: theme.surface,
                borderRadius: theme.cornerRadius,
                borderCurve: "continuous",
                opacity: progress,
                transform: [{ scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) }],
              },
            ]}
          >
            {cardContent}
          </Animated.View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
}

/** Height of the sheet's top band that always drags the sheet. */
const DRAG_HEADER_HEIGHT = 72;

function isDownwardDrag(g: PanResponderGestureState): boolean {
  return g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx);
}

const shadow = {
  shadowColor: "#000",
  shadowOpacity: 0.18,
  shadowRadius: 24,
  shadowOffset: { width: 0, height: -4 },
  elevation: 16,
} as const;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  bottom: { justifyContent: "flex-end" },
  center: { justifyContent: "center", paddingHorizontal: 20 },
  sheet: { width: "100%", maxWidth: 640, alignSelf: "center" },
  dialog: { width: "100%", maxWidth: 480, alignSelf: "center", overflow: "hidden" },
  grabber: { position: "absolute", top: 6, alignSelf: "center", width: 36, height: 5, borderRadius: 3, opacity: 0.35, zIndex: 1 },
});
