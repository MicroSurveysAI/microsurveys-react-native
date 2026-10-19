//
// theme.ts
//
// Maps the dashboard's `ProjectTheme` onto concrete style values, starting from
// the same light/dark defaults as iOS `SurveyTheme.default` and overriding only
// the keys provided (port of iOS `Presenter.makeTheme`). Pure, so it's unit
// tested without a device.
//

import type { ProjectTheme } from "../core";

export type ColorScheme = "light" | "dark";
export type FontWeight = "400" | "500" | "600" | "700";

export interface SurveyTheme {
  /** Dim behind the sheet/dialog. */
  scrim: string;
  surface: string;
  text: string;
  secondaryText: string;
  accent: string;
  accentText: string;
  border: string;
  /** Neutral fill (close button, unselected tracks). */
  track: string;
  /** Selected-control tints (accent at low opacity). */
  accentTint: string;
  accentTintStrong: string;

  /** Dialog corner radius, and the sheet's when `cornerRadius` is configured. */
  cornerRadius: number;
  /** Sheet top-corner radius: device-like by default, `cornerRadius` if set. */
  sheetCornerRadius: number;
  /** No `cornerRadius` configured: sheets keep the platform's native corners. */
  nativeSheetCorners: boolean;
  /** Resolved for dark mode (drives chrome the dashboard theme doesn't cover). */
  dark: boolean;
  controlRadius: number;
  controlHeight: number;
  spacing: number;

  /** Body/option/button/caption text multiplier (not the title). */
  textScale: number;
  titleSize: number;
  titleWeight: FontWeight;
  titleLineHeight: number;
  titleLetterSpacing: number;

  position: "bottom" | "center";
  align: "left" | "center";
  /** A host-registered font family, or undefined for the system font. */
  fontFamily?: string;
}

const PALETTES: Record<ColorScheme, Pick<SurveyTheme, "surface" | "text" | "secondaryText" | "accent" | "accentText" | "border" | "track"> & { background: string }> = {
  light: {
    background: "#09090B",
    surface: "#FFFFFF",
    text: "#18181B",
    secondaryText: "#71717A",
    accent: "#2E7272", // Slate Teal (brand primary)
    accentText: "#FFFFFF",
    border: "#E4E4E7",
    track: "#F4F4F5",
  },
  dark: {
    background: "#000000",
    surface: "#1A1A1E",
    text: "#FAFAFA",
    secondaryText: "#A1A1AA",
    accent: "#41B2B2",
    accentText: "#FFFFFF",
    border: "#333338",
    track: "#27272A",
  },
};

const WEIGHTS: Record<string, FontWeight> = { regular: "400", medium: "500", semibold: "600", bold: "700" };

export interface ResolveThemeOptions {
  scheme?: ColorScheme;
  /** Per-survey `presentation` ("sheet" | "dialog"), overriding the theme position. */
  presentation?: string | null;
  /** Font family the host registered (e.g. via expo-font). */
  fontFamily?: string;
}

export function resolveTheme(project: ProjectTheme | null | undefined, opts: ResolveThemeOptions = {}): SurveyTheme {
  const p = project ?? {};
  const base = PALETTES[opts.scheme ?? "light"];

  const accent = color(p.accent) ?? base.accent;
  const controlHeight = num(p.controlHeight) ?? 48;
  let cornerRadius = 16;
  let sheetCornerRadius = 28;
  let controlRadius = 12;
  // A configured cornerRadius overrides the device-like sheet corner too, and
  // seeds the control radius (iOS: radius - 2) unless controlRadius is set.
  const cr = num(p.cornerRadius);
  if (cr !== undefined) {
    cornerRadius = cr;
    sheetCornerRadius = cr;
    controlRadius = Math.max(0, cr - 2);
  }
  controlRadius = num(p.controlRadius) ?? controlRadius;
  if (p.controlPill === true) controlRadius = controlHeight / 2;

  let position: SurveyTheme["position"] = p.position === "center" ? "center" : "bottom";
  switch (opts.presentation) {
    case "dialog":
    case "center":
      position = "center";
      break;
    case "sheet":
    case "bottom":
      position = "bottom";
      break;
  }

  return {
    // A fixed ~40% dim of the (opaque) configured background, like iOS.
    scrim: withAlpha(color(p.background) ?? base.background, 0.4),
    surface: color(p.surface) ?? base.surface,
    text: color(p.text) ?? base.text,
    secondaryText: color(p.secondaryText) ?? base.secondaryText,
    accent,
    accentText: color(p.accentText) ?? base.accentText,
    border: color(p.border) ?? base.border,
    track: base.track,
    accentTint: withAlpha(accent, 0.1),
    accentTintStrong: withAlpha(accent, 0.12),
    cornerRadius,
    sheetCornerRadius,
    nativeSheetCorners: cr === undefined,
    dark: opts.scheme === "dark",
    controlRadius,
    controlHeight,
    spacing: num(p.spacing) ?? 16,
    textScale: Math.max(0.5, num(p.textScale) ?? 1),
    titleSize: num(p.titleSize) ?? 20,
    titleWeight: WEIGHTS[(p.titleWeight ?? "").toLowerCase()] ?? "600",
    titleLineHeight: num(p.titleLineHeight) ?? 1.1,
    titleLetterSpacing: num(p.titleLetterSpacing) ?? 0,
    position,
    align: p.alignment === "center" ? "center" : "left",
    fontFamily: opts.fontFamily,
  };
}

/** Corner radius for a control of the given size: a pill radius past half the
 *  shorter side would distort, so clamp it (as iOS `ChipButton` does). */
export function clampRadius(radius: number, width: number, height: number): number {
  return Math.min(radius, Math.min(width, height) / 2);
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Normalizes `#RGB`, `#RRGGBB` or `#RRGGBBAA` (with or without `#`) to
 *  `#RRGGBB[AA]`. Returns undefined for empty/invalid input so callers keep
 *  their default. */
export function color(hex: string | null | undefined): string | undefined {
  if (typeof hex !== "string") return undefined;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(h)) return undefined;
  return "#" + h.toUpperCase();
}

/** `#RRGGBB[AA]` → `rgba(r, g, b, alpha)` (replacing any existing alpha). */
export function withAlpha(hex: string, alpha: number): string {
  const h = (color(hex) ?? "#000000").slice(1);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
