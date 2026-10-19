import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2020",
  external: ["react", "react-native", "react-native-safe-area-context", "@react-native-async-storage/async-storage"],
});
