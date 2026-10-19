# MicroSurveys React Native demo

An Expo app that presents every question type through `@microsurveysai/react-native`, without a
backend, plus one survey shown through the full SDK path (event → trigger engine → overlay). Metro
runs the SDK straight from `../src`, so edits show up on reload.

```bash
npm install
npx expo start --ios       # or --android
```

For scripted screenshots, open the app with a URL instead of tapping:

```bash
xcrun simctl openurl booted "exp://127.0.0.1:8081/--/?present=1&position=center"
```

`present=<row>` opens that survey, `position=center` uses the dialog, `style=default` the default
theme, and `sdk=1` fires the SDK's demo event.
