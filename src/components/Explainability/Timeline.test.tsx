import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Timeline, type ArrangedTimelineNote } from "./Timeline";
import type { EventDecision } from "../../types/explainability";

afterEach(cleanup);

function makeEvents(): EventDecision[] {
  return [
    {
      event_id: "evt-1",
      timestamp_ms: 500,
      duration_ms: 50,
      quantized_timestamp_ms: 500,
      snap_delta_ms: 0,
      class: "BilabialPlosive",
      confidence: 0.9,
      assigned_notes: [],
      all_scores: [],
      reasoning: "",
      features: {
        spectral_centroid: 400,
        zcr: 0.08,
        low_band_energy: 0.6,
        mid_band_energy: 0.3,
        high_band_energy: 0.1,
        peak_amplitude: 0.7,
      },
    },
  ];
}

describe("Timeline input-vs-arrangement lane", () => {
  it("renders only the input lane when no arranged notes are given", () => {
    render(<Timeline events={makeEvents()} onEventClick={() => {}} />);
    expect(screen.getAllByTestId("timeline-input-marker")).toHaveLength(1);
    expect(screen.queryByTestId("timeline-output-marker")).toBeNull();
    expect(screen.queryByTestId("timeline-connectors")).toBeNull();
  });

  it("renders both lanes plus connectors when arranged notes are provided", () => {
    const arrangedNotes: ArrangedTimelineNote[] = [
      { timestamp_ms: 512, source_event_id: "evt-1", class: "BilabialPlosive", lane_name: "KICK" },
      { timestamp_ms: 512, source_event_id: "evt-1", class: "BilabialPlosive", lane_name: "BASS" },
    ];
    render(
      <Timeline events={makeEvents()} onEventClick={() => {}} arrangedNotes={arrangedNotes} />
    );

    expect(screen.getAllByTestId("timeline-input-marker")).toHaveLength(1);
    expect(screen.getAllByTestId("timeline-output-marker")).toHaveLength(2);

    // Connectors: one line per arranged note whose source event exists.
    const svg = screen.getByTestId("timeline-connectors");
    expect(svg.querySelectorAll("line")).toHaveLength(2);
  });
});
