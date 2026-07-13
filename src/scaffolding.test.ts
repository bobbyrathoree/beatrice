import { describe, it, expect } from "vitest";

// Placeholder test proving the Vitest + happy-dom scaffolding works.
// Later tasks (WAV render, mock parity, etc.) add real suites here.
describe("test scaffolding", () => {
  it("runs in a happy-dom environment", () => {
    expect(typeof document).toBe("object");
    expect(1 + 1).toBe(2);
  });
});
