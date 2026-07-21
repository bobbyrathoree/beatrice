import type { Theme } from "../bindings";

// Preferred path: derive the arrangement template from a resolved Theme object.
// Rust is the source of truth — each Theme carries a typed `default_template`, so
// the template travels WITH the theme and can't drift from a parallel name table.
// Falls back to the legacy name map only when no Theme object is available (e.g.
// replaying a run before the theme has been fetched).
export function templateForTheme(theme: Theme | null | undefined): string {
  return theme?.default_template ?? mapThemeNameToTemplate(theme?.name);
}

// LEGACY fallback: map a theme *name* to a template. Retained ONLY for run-replay
// of unknown/removed names where no live Theme object exists to read
// `default_template` off of. Prefer `templateForTheme` everywhere a Theme is in
// scope. Unknown or missing names fall back to the default straight template so
// replaying an old run whose theme has since been renamed/removed still arranges
// sensibly instead of crashing or silently using the wrong template.
export function mapThemeNameToTemplate(name: string | null | undefined): string {
  const upper = name?.toUpperCase() ?? "";
  if (upper.includes("BLADE RUNNER")) return "synthwave_halftime";
  if (upper.includes("STRANGER")) return "arp_drive";
  return "synthwave_straight";
}
