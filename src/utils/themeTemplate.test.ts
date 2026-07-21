import { describe, it, expect } from "vitest";
import { mapThemeNameToTemplate, templateForTheme } from "./themeTemplate";
import type { Theme } from "../bindings";

// Minimal Theme factory — only the fields templateForTheme reads matter.
function makeTheme(overrides: Partial<Theme>): Theme {
  return {
    name: "TEST",
    bpm_range: [80, 100],
    root_note: 60,
    scale_family: "NaturalMinor",
    chord_progression: { chords: ["Im"], bars_per_chord: 2 },
    bass_pattern: "RootFifth",
    arp_pattern: "Up158",
    arp_octave_range: [-1, 1],
    default_template: "synthwave_straight",
    sound: { drum_palette: "SynthwaveDrums", fx_profile: "GatedReverb", pad_sustain: true },
    bass_stab_max_velocity: 100,
    ...overrides,
  };
}

describe("mapThemeNameToTemplate", () => {
  it("maps BLADE RUNNER to the half-time synthwave template", () => {
    expect(mapThemeNameToTemplate("BLADE RUNNER")).toBe("synthwave_halftime");
  });

  it("maps STRANGER THINGS to the arp-drive template", () => {
    expect(mapThemeNameToTemplate("STRANGER THINGS")).toBe("arp_drive");
  });

  it("is case-insensitive", () => {
    expect(mapThemeNameToTemplate("blade runner")).toBe("synthwave_halftime");
    expect(mapThemeNameToTemplate("stranger things")).toBe("arp_drive");
  });

  it("falls back to the straight template for unknown theme names", () => {
    expect(mapThemeNameToTemplate("MIAMI NIGHTS")).toBe("synthwave_straight");
    expect(mapThemeNameToTemplate("")).toBe("synthwave_straight");
  });

  it("falls back to the straight template for null/undefined", () => {
    expect(mapThemeNameToTemplate(null)).toBe("synthwave_straight");
    expect(mapThemeNameToTemplate(undefined)).toBe("synthwave_straight");
  });
});

describe("templateForTheme", () => {
  it("uses the theme's own default_template (source of truth) over the name map", () => {
    // Name says STRANGER (→ arp_drive via legacy map) but the typed field wins.
    const theme = makeTheme({ name: "STRANGER THINGS", default_template: "synthwave_halftime" });
    expect(templateForTheme(theme)).toBe("synthwave_halftime");
  });

  it("falls back to the straight template for null (no theme object)", () => {
    expect(templateForTheme(null)).toBe("synthwave_straight");
    expect(templateForTheme(undefined)).toBe("synthwave_straight");
  });

  it("falls back to the legacy name map when default_template is absent", () => {
    // Simulate a theme object missing default_template (e.g. a legacy/partial shape).
    const legacy = makeTheme({ name: "BLADE RUNNER" });
    // @ts-expect-error — deliberately drop the field to exercise the fallback.
    delete legacy.default_template;
    expect(templateForTheme(legacy)).toBe("synthwave_halftime");
  });
});
