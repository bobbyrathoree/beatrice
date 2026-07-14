import { describe, it, expect } from "vitest";
import { mapThemeNameToTemplate } from "./themeTemplate";

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
