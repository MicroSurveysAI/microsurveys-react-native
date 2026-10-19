//
// platform.ts
//
// iOS 26 redesigned system chrome ("Liquid Glass"): sheets float inset from the
// screen edges with corners concentric to the display, and close buttons are
// glass circles. The iOS SDK gets these from UIKit (`UISheetPresentationController`,
// `UIButton.Configuration.glass()`); this SDK draws its own, so it mirrors them
// here to look the same on the same device. Android keeps Material conventions.
//

import { Platform } from "react-native";

/** True on iOS 26+, where the native SDK's sheet floats and its close button is glass. */
export const usesGlassChrome = Platform.OS === "ios" && parseInt(String(Platform.Version), 10) >= 26;

/** Inset of a floating iOS 26 sheet from the screen edges, measured from the native sheet. */
export const FLOATING_SHEET_INSET = 8;

/** Corner radius of a floating iOS 26 sheet on Face ID iPhones (concentric with
 *  the display corners), measured from the native sheet. */
export const FLOATING_SHEET_RADIUS = 52;
