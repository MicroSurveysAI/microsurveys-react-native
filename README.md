# MicroSurveys React Native SDK

In-app micro-surveys for React Native and Expo apps, published to npm as
`@microsurveysai/react-native`. The React Native counterpart to the
[MicroSurveys iOS SDK](https://github.com/MicroSurveysAI/microsurveys-ios), for apps built on
[MicroSurveys](https://microsurveys.ai). Surveys you publish in the dashboard
are evaluated **on-device** against the events you already track, and presented natively as a
bottom sheet or dialog. Works with Expo (including Expo Go) and bare React Native, on iOS and
Android.

```bash
npx expo install @microsurveysai/react-native @react-native-async-storage/async-storage react-native-safe-area-context
```

## Quick start

```tsx
import { MicroSurveys, MicroSurveysProvider } from "@microsurveysai/react-native";

export const ms = new MicroSurveys({ apiKey: "ms_live_…" });

export default function App() {
  return (
    <MicroSurveysProvider instance={ms}>
      <RootNavigator />
    </MicroSurveysProvider>
  );
}
```

Then either forward your Amplitude events:

```ts
import { add } from "@amplitude/analytics-react-native";

add(ms.amplitudePlugin()); // events + identity flow in; events pass through unmodified
```

or track and identify manually:

```ts
ms.identify("user_123", { plan: "pro" });
ms.track("checkout_completed", { amount: 42 });
```

Inside components, `useMicroSurveys()` returns the same `track` / `identify`.

## Inline surveys

```tsx
import { MicroSurvey } from "@microsurveysai/react-native";

<MicroSurvey surveyId="svy_abc" onComplete={(result) => console.log(result)} />;
```

## Options

| `new MicroSurveys({...})` | Default | |
| --- | --- | --- |
| `apiKey` | — | Your project API key. |
| `apiBaseURL` | `https://console.microsurveys.ai` | For self-hosted deployments. |
| `refreshOnForeground` | `true` | On app foreground, retry queued ingest and refresh a stale config. |
| `configTTLms` | 12h | How long the cached config counts as fresh. |
| `storage` | AsyncStorage | A synchronous store (e.g. MMKV) to persist into instead. |
| `appVersion` | — | Your app's version (e.g. `"3.2.0"`), sent with responses so results can be compared across releases. With Expo, pass `Application.nativeApplicationVersion` from `expo-application`. |

`<MicroSurveysProvider>` also takes `autoStart` (default `true`) and `fontFamily` (a font your app
registered, e.g. with `expo-font`; surveys use the system font otherwise).

To preview a survey without a backend, render `<SurveyModal survey={…} theme={…} />` directly.

Full guide: https://docs.microsurveys.ai/react-native-sdk

## Example app

[`example/`](./example) is an Expo app that presents every question type without a backend:

```bash
cd example && npm install && npx expo start --ios
```

## Development

```bash
npm install
npm run typecheck
npm test        # vitest
npm run build   # tsup → ESM + CJS + d.ts
```

> Releases are published to npm and tagged here, with notes on the
> [Releases](https://github.com/MicroSurveysAI/microsurveys-react-native/releases) page. This
> repository doesn't take pull requests; found a bug or need something? Open an issue.

## License

MIT
