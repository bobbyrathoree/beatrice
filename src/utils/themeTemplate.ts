// Map a theme *name* (as persisted on a Run, or read off a Theme object) to the
// arrangement template the backend uses. Kept as a standalone pure function so
// both the live pipeline and run-replay derive the template the same way, and
// so the unknown/legacy-name fallback is unit-testable without pulling in App.
//
// Unknown or missing names fall back to the default straight template, so
// replaying an old run whose theme has since been renamed/removed still
// arranges sensibly instead of crashing or silently using the wrong template.
export function mapThemeNameToTemplate(name: string | null | undefined): string {
  const upper = name?.toUpperCase() ?? "";
  if (upper.includes("BLADE RUNNER")) return "synthwave_halftime";
  if (upper.includes("STRANGER")) return "arp_drive";
  return "synthwave_straight";
}
