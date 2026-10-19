// Runs the SDK straight from ../src (no build or npm link needed). Bare imports
// made by the SDK source (react, react-native, …) resolve from this app's
// node_modules, so there is exactly one copy of each.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const sdk = path.resolve(__dirname, "..");
const sdkSource = path.join(sdk, "src");

const config = getDefaultConfig(__dirname);
config.watchFolders = [sdkSource];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@microsurveysai/react-native") return { type: "sourceFile", filePath: path.join(sdkSource, "index.ts") };
  if (context.originModulePath.startsWith(sdkSource) && !moduleName.startsWith(".")) {
    return context.resolveRequest({ ...context, originModulePath: path.join(__dirname, "index.ts") }, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
