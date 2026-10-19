//
// App.tsx
//
// A tiny host app that presents each question type through the SDK, so the
// survey UI can be checked on a simulator without wiring up a backend or
// Amplitude. The React Native counterpart of the iOS SDK's DemoApp.
//
// Scripting hooks for screenshots (simctl can't tap): open the app with a URL
// carrying `present=<row>` (and optionally `position=center`, `style=default`),
// e.g. in Expo Go: xcrun simctl openurl booted "exp://127.0.0.1:8081/--/?present=1"
//

import { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { MicroSurveys, MicroSurveysProvider, SurveyModal, parseConfig } from "@microsurveysai/react-native";
import type { KeyValueStorage, ProjectTheme, Survey, SurveyResult } from "@microsurveysai/react-native";

// ── Sample surveys (same as the iOS DemoApp) ────────────────────────────────────

const DEMOS: { title: string; subtitle?: string; questions: unknown[] }[] = [
  {
    title: "CSAT – Emoji",
    questions: [
      { id: "q1", type: "CSAT_EMOJI", prompt: "How was your overall ride experience?", required: true, config: { options: [
        { value: "1", emoji: "😡", label: "Awful" },
        { value: "2", emoji: "🙁", label: "Bad" },
        { value: "3", emoji: "😐", label: "Okay" },
        { value: "4", emoji: "🙂", label: "Good" },
        { value: "5", emoji: "😍", label: "Great" },
      ] } },
    ],
  },
  {
    title: "NPS 0–10",
    questions: [{ id: "q1", type: "NPS", prompt: "How likely are you to recommend us to a friend?", required: true, config: { min: 0, max: 10, minLabel: "Not likely", maxLabel: "Very likely" } }],
  },
  {
    title: "CSAT – Stars",
    questions: [{ id: "q1", type: "CSAT_STAR", prompt: "How was your overall ride experience?", required: true, config: { count: 5 } }],
  },
  {
    title: "CES 1–7",
    subtitle: "Wallet effort survey",
    questions: [{ id: "q1", type: "CES", prompt: "How easy was it to understand your wallet balance?", required: true, config: { min: 1, max: 7, minLabel: "Very difficult", maxLabel: "Very easy" } }],
  },
  { title: "Thumbs", questions: [{ id: "q1", type: "THUMBS", prompt: "Was this helpful?", required: true, config: {} }] },
  {
    title: "Single choice",
    questions: [{ id: "q1", type: "SINGLE_CHOICE", prompt: "What brought you here today?", required: true, config: { options: [
      { value: "ride", label: "Book a ride" },
      { value: "wallet", label: "Check my wallet" },
      { value: "support", label: "Get support" },
    ] } }],
  },
  {
    title: "Open text",
    questions: [{ id: "q1", type: "OPEN_TEXT", prompt: "Anything else you'd like to tell us?", required: false, config: { placeholder: "Type here…", maxLength: 280 } }],
  },
  {
    title: "Multi-question",
    subtitle: "Emoji → NPS → Stars → Text",
    questions: [
      { id: "q1", order: 0, type: "CSAT_EMOJI", prompt: "How was your ride?", required: true, config: { options: [
        { value: "1", emoji: "🙁", label: "Bad" },
        { value: "2", emoji: "😐", label: "Okay" },
        { value: "3", emoji: "😍", label: "Great" },
      ] } },
      { id: "q2", order: 1, type: "NPS", prompt: "How likely are you to recommend us?", required: true, config: { min: 0, max: 10 } },
      { id: "q3", order: 2, type: "CSAT_STAR", prompt: "Rate your driver", required: true, config: { count: 5 } },
      { id: "q4", order: 3, type: "OPEN_TEXT", prompt: "Anything else?", required: false, config: {} },
    ],
  },
];

function surveyFor(index: number, presentation: string): Survey {
  const demo = DEMOS[index]!;
  const config = parseConfig(JSON.stringify({ projectId: "demo", surveys: [{ id: `demo-${index}`, name: demo.title, presentation, questions: demo.questions }] }));
  return config!.surveys[0]!;
}

/** Tall pill controls in a custom palette, as the dashboard's `controlPill` sends. */
const CORAL: ProjectTheme = { accent: "#FF6B6B", accentText: "#121C4D", text: "#121C4D", controlHeight: 60, controlPill: true };

// ── Through the SDK: a cached config with an event trigger ──────────────────────

const SDK_EVENT = "demo_event";

function memoryStore(seed: Record<string, string>): KeyValueStorage {
  const map = new Map(Object.entries(seed));
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v), removeItem: (k) => void map.delete(k) };
}

function createDemoSDK(): MicroSurveys {
  const config = {
    projectId: "demo",
    theme: {},
    surveys: [
      {
        id: "sdk-demo",
        name: "Triggered",
        questions: [{ id: "q1", type: "THUMBS", prompt: `Shown by the trigger engine on "${SDK_EVENT}". Helpful?`, required: true, config: {} }],
        triggers: [{ id: "t1", type: "SINGLE", delaySeconds: 0, steps: [{ order: 0, event: SDK_EVENT, match: {} }] }],
      },
    ],
  };
  return new MicroSurveys({
    apiKey: "ms_test_demo",
    // Unreachable on purpose: the demo never talks to a real backend.
    apiBaseURL: "http://127.0.0.1:9",
    refreshOnForeground: false,
    storage: memoryStore({
      "com.microsurveys.config.cache": JSON.stringify({ rawConfig: JSON.stringify(config), etag: null, storedAt: Date.now() }),
    }),
  });
}

// ── Screen ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [sdk] = useState(createDemoSDK);
  return (
    <SafeAreaProvider>
      <MicroSurveysProvider instance={sdk} autoStart={false}>
        <DemoList sdk={sdk} />
      </MicroSurveysProvider>
    </SafeAreaProvider>
  );
}

function DemoList({ sdk }: { sdk: MicroSurveys }) {
  const dark = useColorScheme() === "dark";
  const c = dark ? { bg: "#000", card: "#1C1C1E", text: "#FFF", sub: "#8E8E93", sep: "#38383A" } : { bg: "#F2F2F7", card: "#FFF", text: "#000", sub: "#6C6C70", sep: "#E5E5EA" };

  const [coral, setCoral] = useState(true);
  const [center, setCenter] = useState(false);
  const [presented, setPresented] = useState<Survey | null>(null);
  const [lastResult, setLastResult] = useState("—");

  const theme = coral ? CORAL : null;
  const present = (row: number, centered = center) => setPresented(surveyFor(row, centered ? "dialog" : "sheet"));

  // Scripting: `?present=<row>&position=center&style=default`.
  useEffect(() => {
    const handle = (url: string | null | undefined) => {
      const q = (key: string) => url?.match(new RegExp(`[?&]${key}=([^&]+)`))?.[1];
      setCoral(q("style") !== "default");
      const centered = q("position") === "center";
      setCenter(centered);
      const row = q("present");
      if (row !== undefined && DEMOS[Number(row)]) setTimeout(() => present(Number(row), centered), 600);
      if (q("sdk") !== undefined) setTimeout(() => sdk.track(SDK_EVENT), 600);
    };
    void Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener("url", (e) => handle(e.url));
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showResult = (r: SurveyResult) => setLastResult(JSON.stringify(r, null, 1));

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={["top", "left", "right"]}>
      <StatusBar style="auto" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.title, { color: c.text }]}>MicroSurveys Demo</Text>

        <Segmented options={["Default", "Coral (pill)"]} selected={coral ? 1 : 0} onSelect={(i) => setCoral(i === 1)} c={c} />
        <Segmented options={["Bottom sheet", "Center dialog"]} selected={center ? 1 : 0} onSelect={(i) => setCenter(i === 1)} c={c} />

        <Text style={[styles.section, { color: c.sub }]}>PRESENT A SURVEY</Text>
        <View style={[styles.group, { backgroundColor: c.card }]}>
          {DEMOS.map((d, i) => (
            <Row key={d.title} title={d.title} subtitle={d.subtitle} last={i === DEMOS.length - 1} onPress={() => present(i)} c={c} />
          ))}
        </View>

        <Text style={[styles.section, { color: c.sub }]}>THROUGH THE SDK</Text>
        <View style={[styles.group, { backgroundColor: c.card }]}>
          <Row title={`track("${SDK_EVENT}")`} subtitle="Trigger engine → provider overlay" last onPress={() => sdk.track(SDK_EVENT)} c={c} />
        </View>

        <Text style={[styles.section, { color: c.sub }]}>LAST RESULT</Text>
        <View style={[styles.group, { backgroundColor: c.card, padding: 14 }]}>
          <Text style={[styles.mono, { color: c.text }]}>{lastResult}</Text>
        </View>
      </ScrollView>

      <SurveyModal survey={presented} theme={theme} onResult={showResult} onClose={() => setPresented(null)} />
    </SafeAreaView>
  );
}

type Colors = { bg: string; card: string; text: string; sub: string; sep: string };

function Segmented({ options, selected, onSelect, c }: { options: string[]; selected: number; onSelect: (i: number) => void; c: Colors }) {
  return (
    <View style={[styles.segmented, { backgroundColor: c.sep }]}>
      {options.map((o, i) => (
        <Pressable key={o} onPress={() => onSelect(i)} style={[styles.segment, i === selected && { backgroundColor: c.card }]}>
          <Text style={{ color: c.text, fontWeight: i === selected ? "600" : "400", fontSize: 13 }}>{o}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Row({ title, subtitle, last, onPress, c }: { title: string; subtitle?: string; last?: boolean; onPress: () => void; c: Colors }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }, !last && { borderBottomColor: c.sep, borderBottomWidth: StyleSheet.hairlineWidth }]}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.text, fontSize: 17 }}>{title}</Text>
        {!!subtitle && <Text style={{ color: c.sub, fontSize: 13, marginTop: 2 }}>{subtitle}</Text>}
      </View>
      <Text style={{ color: c.sub, fontSize: 18 }}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 8, paddingBottom: 48 },
  title: { fontSize: 32, fontWeight: "700", marginBottom: 8 },
  segmented: { flexDirection: "row", borderRadius: 9, padding: 2 },
  segment: { flex: 1, alignItems: "center", paddingVertical: 7, borderRadius: 7 },
  section: { fontSize: 13, marginTop: 16, marginLeft: 16 },
  group: { borderRadius: 10, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 11, paddingHorizontal: 16, minHeight: 44 },
  mono: { fontFamily: "Menlo", fontSize: 12 },
});
