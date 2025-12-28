# Explainability UI - Visual Guide

## Timeline Component

```
┌──────────────────────────────────────────────────────────────────┐
│  EVENT TIMELINE                                    [6 EVENTS]     │
├──────────────────────────────────────────────────────────────────┤
│  ◼ BilabialPlosive  ◼ HihatNoise  ◼ Click  ◼ HumVoiced          │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ ████████████████████████████████████████████████████████████ │  │
│  │   ●  ← ●     ●        ● →    ●           ●                  │  │
│  │ Magenta Cyan Green   Magenta Yellow     Green                │  │
│  └────────────────────────────────────────────────────────────┘  │
│     0:00.00   0:01.00   0:02.00   0:03.00   0:04.00             │
│                                                                   │
│  Click on any event marker to see detailed decision info.        │
│  Marker size/opacity = confidence. Arrows = quantization.        │
└──────────────────────────────────────────────────────────────────┘
```

**Features:**
- Bold 4px border
- Event markers as colored circles
- Size varies 8-24px based on confidence
- Arrows show quantization direction
- Time labels below

## DecisionCard Component (Modal)

```
    ┌─────────────────────────────────────────────────┐
    │  EVENT DECISION                            [X]  │
    │  ID: abc123...                                  │
    ├─────────────────────────────────────────────────┤
    │                                                 │
    │  TIMING                                         │
    │  ┌──────────────────────────────────────────┐  │
    │  │  Original:     00:00.520                 │  │
    │  │  Quantized:    00:00.500                 │  │
    │  │  ─────────────────────────────────────   │  │
    │  │  Adjustment:   -20.0ms                   │  │
    │  └──────────────────────────────────────────┘  │
    │                                                 │
    │  CLASSIFICATION                                 │
    │  ┌──────────────────────────────────────────┐  │
    │  │  B/P (Kick)                              │  │ Magenta
    │  │  Confidence: ████████████████░░░░  92.0% │  │ background
    │  └──────────────────────────────────────────┘  │
    │                                                 │
    │  MAPPED TO                                      │
    │  [KICK]  [BASS]                                 │
    │                                                 │
    │  DECISION REASONING                             │
    │  ┌──────────────────────────────────────────┐  │
    │  │  High plosive confidence (92%) + near    │  │ Yellow
    │  │  downbeat + B-emphasis=0.8 triggered     │  │ background
    │  │  both kick drum and bass synth note      │  │
    │  └──────────────────────────────────────────┘  │
    │                                                 │
    │  [SHOW ME THE MODEL ▶]                         │
    │                                                 │
    └─────────────────────────────────────────────────┘
       Shadow offset 8px
```

## ModelInspector Panel (Expanded)

```
    ┌─────────────────────────────────────────────────┐
    │  MODEL ANALYSIS                                 │
    │                                                 │
    │  EXTRACTED FEATURES                             │
    │  ┌──────────────────────────────────────────┐  │
    │  │  Spectral Centroid     450.00Hz          │  │
    │  │  ████░░░░░░░░░░░░░░░░░░░░░░              │  │
    │  │  Center of mass of spectrum (brightness) │  │
    │  │                                          │  │
    │  │  Zero-Crossing Rate    0.15              │  │
    │  │  ███░░░░░░░░░░░░░░░░░░░░░░░              │  │
    │  │  Rate of sign changes (noisiness)        │  │
    │  │                                          │  │
    │  │  Low Band Energy       0.85              │  │
    │  │  █████████████████░░░░░░░                │  │
    │  │  Energy in bass frequencies              │  │
    │  │  ...                                     │  │
    │  └──────────────────────────────────────────┘  │
    │                                                 │
    │  CLASSIFICATION PROBABILITIES                   │
    │  ┌──────────────────────────────────────────┐  │
    │  │  ● BilabialPlosive                       │  │
    │  │  ███████████████████████████  92.0%      │  │ Magenta
    │  │                                          │  │
    │  │  ● Click                                 │  │
    │  │  ████░░░░░░░░░░░░░░░░░░░░░░  3.5%        │  │ Green
    │  │                                          │  │
    │  │  ● HihatNoise                            │  │
    │  │  ███░░░░░░░░░░░░░░░░░░░░░░░  2.8%        │  │ Cyan
    │  │                                          │  │
    │  │  ● HumVoiced                             │  │
    │  │  ██░░░░░░░░░░░░░░░░░░░░░░░░  1.7%        │  │ Yellow
    │  └──────────────────────────────────────────┘  │
    │                                                 │
    │  ┌──────────────────────────────────────────┐  │
    │  │ HOW IT WORKS: The model extracts          │  │
    │  │ acoustic features and computes            │  │
    │  │ probability distribution...               │  │
    │  └──────────────────────────────────────────┘  │
    └─────────────────────────────────────────────────┘
```

## Color Palette

```
Event Classes:
┌─────────────────┬─────────┬──────────┐
│ BilabialPlosive │ #FF00FF │ Magenta  │
├─────────────────┼─────────┼──────────┤
│ HihatNoise      │ #00FFFF │ Cyan     │
├─────────────────┼─────────┼──────────┤
│ Click           │ #00FF00 │ Green    │
├─────────────────┼─────────┼──────────┤
│ HumVoiced       │ #FFFF00 │ Yellow   │
└─────────────────┴─────────┴──────────┘

UI Elements:
- Background: #FFFFFF (White)
- Borders: #000000 (Black, 3-4px)
- Text: #000000 (Black)
- Shadows: Offset box shadows
- Accents: #F0F0F0 (Light gray)
- Reasoning: #FFF8E1 (Light yellow)
```

## Animation Flow

1. **Timeline loads:**
   - Fade in container (opacity 0→1)
   - Stagger markers (20ms delay each)
   - Scale 0→1 with bounce

2. **Marker hover:**
   - Scale 1→1.5
   - Increase z-index
   - Show tooltip (future)

3. **Click marker:**
   - Decision card modal fades in backdrop
   - Card scales 0.9→1 with opacity
   - Sections animate in order

4. **Toggle inspector:**
   - Height 0→auto transition
   - Fade in content
   - Stagger feature bars

5. **Close card:**
   - Reverse animations
   - Fade out backdrop
   - Scale down card

## Responsive Behavior

- Timeline: Horizontal scroll if too many events
- DecisionCard: Max-width 600px, full width on mobile
- Feature bars: Stack vertically always
- Time labels: Hide every other if > 20 markers
