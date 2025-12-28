# Explainability Components - Phase 10

These components provide transparency into Beatrice's AI decision-making process, showing users exactly how events were detected, classified, and arranged.

## Components

### Timeline
A horizontal timeline showing all detected events with visual indicators for confidence, quantization adjustments, and event classes.

### DecisionCard
A modal popup that shows detailed information about a single event, including:
- Original vs. quantized timestamp
- Classification and confidence score
- What instruments it mapped to
- Decision reasoning
- Optional model inspector

### ModelInspector
An expandable panel showing the raw model features and classification probabilities for an event.

## Usage Example

```tsx
import { useState } from 'react';
import { Timeline, DecisionCard } from './components/Explainability';
import type { EventDecision } from './types/explainability';

function ResultsView() {
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  // Mock data - in production, this would come from the backend
  const mockEvents: EventDecision[] = [
    {
      event_id: 'abc123',
      original_timestamp_ms: 520,
      quantized_timestamp_ms: 500,
      snap_delta_ms: -20,
      class: 'BilabialPlosive',
      confidence: 0.92,
      mapped_to: ['KICK', 'BASS'],
      reasoning: 'High plosive confidence (92%) + near downbeat + B-emphasis=0.8 triggered both kick drum and bass synth note',
      features: {
        spectral_centroid: 450,
        zcr: 0.15,
        low_band_energy: 0.85,
        mid_band_energy: 0.45,
        high_band_energy: 0.12,
      },
    },
    {
      event_id: 'def456',
      original_timestamp_ms: 1005,
      quantized_timestamp_ms: 1000,
      snap_delta_ms: -5,
      class: 'HihatNoise',
      confidence: 0.88,
      mapped_to: ['HIHAT'],
      reasoning: 'High-frequency noise signature with ZCR=0.72 matched hi-hat pattern',
      features: {
        spectral_centroid: 4200,
        zcr: 0.72,
        low_band_energy: 0.08,
        mid_band_energy: 0.25,
        high_band_energy: 0.89,
      },
    },
  ];

  const selectedEvent = mockEvents.find(e => e.event_id === selectedEventId);

  return (
    <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Timeline showing all events */}
      <Timeline
        events={mockEvents}
        onEventClick={setSelectedEventId}
        maxDuration={5000}
      />

      {/* Decision card modal */}
      <DecisionCard
        event={selectedEvent || null}
        onClose={() => setSelectedEventId(null)}
      />
    </div>
  );
}
```

## Styling

All components use neo-brutalist styling matching the Beatrice design system:
- Bold borders (3-4px solid black)
- High contrast colors
- Event class colors:
  - BilabialPlosive: #FF00FF (Magenta)
  - HihatNoise: #00FFFF (Cyan)
  - Click: #00FF00 (Green)
  - HumVoiced: #FFFF00 (Yellow)
- Framer Motion animations for smooth interactions

## Integration with Backend

To integrate with the Rust backend:

1. Create a Tauri command to fetch event decisions:
```rust
#[tauri::command]
fn get_event_decisions(run_id: String) -> Result<Vec<EventDecision>, String> {
    // Load quantized events and arrangement
    // Build EventDecision objects with reasoning
    // Return to frontend
}
```

2. Update the frontend to call this command:
```tsx
import { invoke } from '@tauri-apps/api/core';

const events = await invoke<EventDecision[]>('get_event_decisions', { runId });
```

## Future Enhancements

- Add filtering by event class
- Add zoom/pan controls for long recordings
- Export decision data as JSON
- Add comparison view for different quantization settings
- Show template rules overlay on timeline
