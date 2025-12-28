// Musical Grid - Time signature, grid divisions, and groove feel
// Provides structure for quantization and musical timing

use serde::{Deserialize, Serialize};

/// Musical time signature
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TimeSignature {
    /// 4/4 time - most common (4 beats per bar)
    FourFour,

    /// 3/4 time - waltz feel (3 beats per bar)
    ThreeFour,
}

impl TimeSignature {
    /// Get number of beats per bar
    pub fn beats_per_bar(&self) -> u32 {
        match self {
            TimeSignature::FourFour => 4,
            TimeSignature::ThreeFour => 3,
        }
    }

    /// Get the note value that gets one beat (4 = quarter note)
    pub fn beat_unit(&self) -> u32 {
        4 // Both use quarter notes as the beat unit
    }
}

/// Grid division - defines the resolution of the musical grid
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GridDivision {
    /// Quarter notes (1 per beat)
    Quarter,

    /// Eighth notes (2 per beat)
    Eighth,

    /// Sixteenth notes (4 per beat)
    Sixteenth,

    /// Triplet feel (3 per beat)
    Triplet,
}

impl GridDivision {
    /// Get number of subdivisions per beat
    pub fn subdivisions_per_beat(&self) -> u32 {
        match self {
            GridDivision::Quarter => 1,
            GridDivision::Eighth => 2,
            GridDivision::Sixteenth => 4,
            GridDivision::Triplet => 3,
        }
    }
}

/// Groove feel - affects timing and emphasis
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GrooveFeel {
    /// Straight timing - even subdivisions
    Straight,

    /// Swing feel - delays off-beats
    Swing,

    /// Halftime feel - snare on 3 instead of 2 and 4
    Halftime,
}

/// Grid position - describes location in musical time
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct GridPosition {
    /// Bar number (0-indexed)
    pub bar: u32,

    /// Beat number within bar (0-indexed)
    pub beat: u32,

    /// Subdivision within beat (0-indexed)
    pub subdivision: u32,
}

/// Musical grid - defines the timing structure for a performance
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Grid {
    /// Beats per minute
    pub bpm: f64,

    /// Time signature (4/4, 3/4, etc.)
    pub time_signature: TimeSignature,

    /// Grid division (quarter, eighth, sixteenth, triplet)
    pub division: GridDivision,

    /// Groove feel (straight, swing, halftime)
    pub feel: GrooveFeel,

    /// Swing amount [0.0, 1.0] - only applies if feel is Swing
    /// 0.0 = straight, 0.5 = typical swing, 1.0 = maximum swing
    pub swing_amount: f32,

    /// Total number of bars in the grid
    pub bar_count: u32,

    /// All grid positions in milliseconds (pre-calculated)
    pub beat_positions_ms: Vec<f64>,
}

impl Grid {
    /// Create a new grid with specified parameters
    pub fn new(
        bpm: f64,
        time_signature: TimeSignature,
        division: GridDivision,
        bar_count: u32,
    ) -> Self {
        let mut grid = Grid {
            bpm,
            time_signature,
            division,
            feel: GrooveFeel::Straight,
            swing_amount: 0.0,
            bar_count,
            beat_positions_ms: Vec::new(),
        };

        grid.calculate_beat_positions();
        grid
    }

    /// Create a new grid with all parameters including feel
    pub fn new_with_feel(
        bpm: f64,
        time_signature: TimeSignature,
        division: GridDivision,
        feel: GrooveFeel,
        swing_amount: f32,
        bar_count: u32,
    ) -> Self {
        let mut grid = Grid {
            bpm,
            time_signature,
            division,
            feel,
            swing_amount: swing_amount.clamp(0.0, 1.0),
            bar_count,
            beat_positions_ms: Vec::new(),
        };

        grid.calculate_beat_positions();
        grid
    }

    /// Calculate all beat positions based on grid parameters
    fn calculate_beat_positions(&mut self) {
        let ms_per_beat = 60000.0 / self.bpm;
        let subdivisions_per_beat = self.division.subdivisions_per_beat();
        let beats_per_bar = self.time_signature.beats_per_bar();

        let total_beats = self.bar_count * beats_per_bar;
        let total_subdivisions = total_beats * subdivisions_per_beat;

        let mut positions = Vec::new();

        for i in 0..total_subdivisions {
            let beat = i / subdivisions_per_beat;
            let subdivision = i % subdivisions_per_beat;

            // Calculate base position
            let subdivision_duration = ms_per_beat / subdivisions_per_beat as f64;
            let mut position = beat as f64 * ms_per_beat + subdivision as f64 * subdivision_duration;

            // Apply swing if enabled
            if self.feel == GrooveFeel::Swing && subdivision % 2 == 1 {
                // Delay off-beats based on swing amount
                let swing_delay = (subdivision_duration * self.swing_amount as f64 * 0.33).min(subdivision_duration * 0.5);
                position += swing_delay;
            }

            // Apply halftime offset if enabled
            if self.feel == GrooveFeel::Halftime {
                // Halftime feel doubles the perceived beat interval
                // This is mostly a feel/emphasis change, not timing
                // For quantization purposes, we keep the same grid
            }

            positions.push(position);
        }

        self.beat_positions_ms = positions;
    }

    /// Update swing amount and recalculate positions
    pub fn set_swing_amount(&mut self, swing_amount: f32) {
        self.swing_amount = swing_amount.clamp(0.0, 1.0);
        self.calculate_beat_positions();
    }

    /// Update feel and recalculate positions
    pub fn set_feel(&mut self, feel: GrooveFeel) {
        self.feel = feel;
        self.calculate_beat_positions();
    }

    /// Update BPM and recalculate positions
    pub fn set_bpm(&mut self, bpm: f64) {
        self.bpm = bpm.max(20.0).min(300.0); // Reasonable BPM range
        self.calculate_beat_positions();
    }

    /// Find the nearest beat position to a given timestamp
    /// Returns (beat_position_ms, beat_index)
    pub fn get_nearest_beat(&self, timestamp_ms: f64) -> (f64, usize) {
        if self.beat_positions_ms.is_empty() {
            return (0.0, 0);
        }

        let mut nearest_idx = 0;
        let mut nearest_distance = f64::MAX;

        for (i, &pos) in self.beat_positions_ms.iter().enumerate() {
            let distance = (pos - timestamp_ms).abs();
            if distance < nearest_distance {
                nearest_distance = distance;
                nearest_idx = i;
            }
        }

        (self.beat_positions_ms[nearest_idx], nearest_idx)
    }

    /// Get bar number for a given timestamp (0-indexed)
    pub fn get_bar_number(&self, timestamp_ms: f64) -> u32 {
        let ms_per_beat = 60000.0 / self.bpm;
        let beats_per_bar = self.time_signature.beats_per_bar();
        let ms_per_bar = ms_per_beat * beats_per_bar as f64;

        if ms_per_bar > 0.0 {
            (timestamp_ms / ms_per_bar).floor() as u32
        } else {
            0
        }
    }

    /// Get beat number within bar for a given timestamp (1-indexed: 1, 2, 3, 4)
    pub fn get_beat_in_bar(&self, timestamp_ms: f64) -> u32 {
        let ms_per_beat = 60000.0 / self.bpm;
        let beats_per_bar = self.time_signature.beats_per_bar();
        let ms_per_bar = ms_per_beat * beats_per_bar as f64;

        if ms_per_bar > 0.0 {
            let position_in_bar = timestamp_ms % ms_per_bar;
            let beat = (position_in_bar / ms_per_beat).floor() as u32;
            (beat + 1).min(beats_per_bar)
        } else {
            1
        }
    }

    /// Get grid position (bar, beat, subdivision) for a timestamp
    pub fn get_grid_position(&self, timestamp_ms: f64) -> GridPosition {
        let (_, beat_idx) = self.get_nearest_beat(timestamp_ms);

        let subdivisions_per_beat = self.division.subdivisions_per_beat();
        let beats_per_bar = self.time_signature.beats_per_bar();

        let bar = beat_idx as u32 / (beats_per_bar * subdivisions_per_beat);
        let beat_in_bar = (beat_idx as u32 / subdivisions_per_beat) % beats_per_bar;
        let subdivision = beat_idx as u32 % subdivisions_per_beat;

        GridPosition {
            bar,
            beat: beat_in_bar,
            subdivision,
        }
    }

    /// Get timestamp for a specific grid position
    pub fn get_timestamp_for_position(&self, position: &GridPosition) -> Option<f64> {
        let subdivisions_per_beat = self.division.subdivisions_per_beat();
        let beats_per_bar = self.time_signature.beats_per_bar();

        let total_subdivisions_before = position.bar * beats_per_bar * subdivisions_per_beat
            + position.beat * subdivisions_per_beat
            + position.subdivision;

        self.beat_positions_ms.get(total_subdivisions_before as usize).copied()
    }

    /// Get total duration of the grid in milliseconds
    pub fn total_duration_ms(&self) -> f64 {
        let ms_per_beat = 60000.0 / self.bpm;
        let beats_per_bar = self.time_signature.beats_per_bar();
        ms_per_beat * beats_per_bar as f64 * self.bar_count as f64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_time_signature_beats() {
        assert_eq!(TimeSignature::FourFour.beats_per_bar(), 4);
        assert_eq!(TimeSignature::ThreeFour.beats_per_bar(), 3);
    }

    #[test]
    fn test_grid_division_subdivisions() {
        assert_eq!(GridDivision::Quarter.subdivisions_per_beat(), 1);
        assert_eq!(GridDivision::Eighth.subdivisions_per_beat(), 2);
        assert_eq!(GridDivision::Sixteenth.subdivisions_per_beat(), 4);
        assert_eq!(GridDivision::Triplet.subdivisions_per_beat(), 3);
    }

    #[test]
    fn test_grid_creation() {
        let grid = Grid::new(120.0, TimeSignature::FourFour, GridDivision::Quarter, 4);

        assert_eq!(grid.bpm, 120.0);
        assert_eq!(grid.bar_count, 4);
        assert_eq!(grid.time_signature, TimeSignature::FourFour);

        // 4 bars * 4 beats * 1 subdivision = 16 positions
        assert_eq!(grid.beat_positions_ms.len(), 16);
    }

    #[test]
    fn test_beat_positions_120_bpm() {
        let grid = Grid::new(120.0, TimeSignature::FourFour, GridDivision::Quarter, 1);

        // At 120 BPM, each beat is 500ms
        assert!((grid.beat_positions_ms[0] - 0.0).abs() < 0.01);
        assert!((grid.beat_positions_ms[1] - 500.0).abs() < 0.01);
        assert!((grid.beat_positions_ms[2] - 1000.0).abs() < 0.01);
        assert!((grid.beat_positions_ms[3] - 1500.0).abs() < 0.01);
    }

    #[test]
    fn test_nearest_beat() {
        let grid = Grid::new(120.0, TimeSignature::FourFour, GridDivision::Quarter, 1);

        let (pos, idx) = grid.get_nearest_beat(520.0);
        assert_eq!(idx, 1);
        assert!((pos - 500.0).abs() < 0.01);
    }

    #[test]
    fn test_bar_number() {
        let grid = Grid::new(120.0, TimeSignature::FourFour, GridDivision::Quarter, 4);

        // At 120 BPM with 4/4, each bar is 2000ms
        assert_eq!(grid.get_bar_number(500.0), 0);
        assert_eq!(grid.get_bar_number(2500.0), 1);
        assert_eq!(grid.get_bar_number(4500.0), 2);
    }

    #[test]
    fn test_beat_in_bar() {
        let grid = Grid::new(120.0, TimeSignature::FourFour, GridDivision::Quarter, 1);

        // At 120 BPM, each beat is 500ms
        assert_eq!(grid.get_beat_in_bar(100.0), 1);
        assert_eq!(grid.get_beat_in_bar(600.0), 2);
        assert_eq!(grid.get_beat_in_bar(1100.0), 3);
        assert_eq!(grid.get_beat_in_bar(1600.0), 4);
    }

    #[test]
    fn test_swing_timing() {
        let straight = Grid::new(120.0, TimeSignature::FourFour, GridDivision::Eighth, 1);
        let swing = Grid::new_with_feel(
            120.0,
            TimeSignature::FourFour,
            GridDivision::Eighth,
            GrooveFeel::Swing,
            0.5,
            1,
        );

        // Off-beats should be delayed with swing
        // Beat 1 subdivision 0 (on-beat) should be the same
        assert!((straight.beat_positions_ms[0] - swing.beat_positions_ms[0]).abs() < 0.01);

        // Beat 1 subdivision 1 (off-beat) should be delayed
        assert!(swing.beat_positions_ms[1] > straight.beat_positions_ms[1]);
    }

    #[test]
    fn test_grid_position() {
        let grid = Grid::new(120.0, TimeSignature::FourFour, GridDivision::Eighth, 2);

        let position = grid.get_grid_position(500.0); // Second beat
        assert_eq!(position.bar, 0);
        assert_eq!(position.beat, 1);
    }
}
