import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { DecisionCard } from "./DecisionCard";
import type { EventDecision } from "../../types/explainability";

afterEach(cleanup);

// A decision whose per-class scores are intentionally OUT of order, so the test
// proves the component sorts them descending (winner first) rather than trusting
// input order.
function makeDecision(): EventDecision {
  return {
    event_id: "abcdef12-0000-0000-0000-000000000000",
    timestamp_ms: 1000,
    duration_ms: 50,
    quantized_timestamp_ms: 1000,
    snap_delta_ms: 0,
    class: "Click",
    confidence: 0.71,
    assigned_notes: [],
    all_scores: [
      { class: "BilabialPlosive", score: 0.1 },
      { class: "Click", score: 0.71 },
      { class: "HihatNoise", score: 0.55 },
      { class: "HumVoiced", score: 0.05 },
    ],
    reasoning: "Classified as T/K (Snare) (71%), over runner-up S/TS (Hi-hat) (55%).",
    features: {
      spectral_centroid: 1800,
      zcr: 0.3,
      low_band_energy: 0.2,
      mid_band_energy: 0.6,
      high_band_energy: 0.2,
      peak_amplitude: 0.7,
    },
  };
}

describe("DecisionCard score bars", () => {
  it("renders one bar per class with the real percentages", () => {
    render(<DecisionCard event={makeDecision()} onClose={() => {}} />);

    const list = screen.getByTestId("score-bars");
    const rows = within(list).getAllByTestId("score-bar");
    expect(rows).toHaveLength(4);

    // The real scores must be surfaced as text (71% winner, 55% runner-up).
    expect(within(list).getByText(/71%/)).toBeTruthy();
    expect(within(list).getByText(/55%/)).toBeTruthy();
  });

  it("sorts score bars descending (winner first)", () => {
    render(<DecisionCard event={makeDecision()} onClose={() => {}} />);

    const rows = screen.getAllByTestId("score-bar");
    const pcts = rows.map((r) =>
      Number(r.getAttribute("data-score"))
    );
    const sorted = [...pcts].sort((a, b) => b - a);
    expect(pcts).toEqual(sorted);
    // Winner (Click, 0.71) is first.
    expect(rows[0].getAttribute("data-class")).toBe("Click");
  });
});
