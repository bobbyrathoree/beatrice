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
        if self.bpm <= 0.0 {
            self.beat_positions_ms = Vec::new();
            return;
        }

        let subdivisions_per_beat = self.division.subdivisions_per_beat();
        let beats_per_bar = self.time_signature.beats_per_bar();
        if subdivisions_per_beat == 0 {
            self.beat_positions_ms = Vec::new();
            return;
        }

        let total_beats = self.bar_count * beats_per_bar;
        let total_subdivisions = total_beats * subdivisions_per_beat;

        let mut positions = Vec::with_capacity(total_subdivisions as usize);
        for i in 0..total_subdivisions {
            positions.push(self.calculate_position_at_index(i as usize));
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
        self.bpm = bpm.max(20.0).min(300.0);
        self.calculate_beat_positions();
    }

    /// Find the nearest beat position to a given timestamp
    pub fn get_nearest_beat(&self, timestamp_ms: f64) -> (f64, usize) {
        if self.bpm <= 0.0 {
            return (0.0, 0);
        }

        let ms_per_beat = 60000.0 / self.bpm;
        let subdivisions_per_beat = self.division.subdivisions_per_beat() as f64;
        let subdivision_duration = ms_per_beat / subdivisions_per_beat;

        let estimated_idx = (timestamp_ms / subdivision_duration).round() as i64;
        let estimated_idx = estimated_idx.max(0) as usize;

        let mut nearest_idx = estimated_idx;
        let mut nearest_pos = 0.0;
        let mut min_distance = f64::MAX;

        let start_idx = estimated_idx.saturating_sub(2);
        let end_idx = estimated_idx + 2;

        for i in start_idx..=end_idx {
            let pos = self.calculate_position_at_index(i);
            let distance = (pos - timestamp_ms).abs();
            if distance < min_distance {
                min_distance = distance;
                nearest_idx = i;
                nearest_pos = pos;
            }
        }

        (nearest_pos, nearest_idx)
    }

    /// Get bar number for a given timestamp (0-indexed)
    pub fn get_bar_number(&self, timestamp_ms: f64) -> u32 {
        if self.bpm <= 0.0 {
            return 0;
        }
        let ms_per_beat = 60000.0 / self.bpm;
        let ms_per_bar = ms_per_beat * self.time_signature.beats_per_bar() as f64;
        if ms_per_bar > 0.0 {
            (timestamp_ms / ms_per_bar).floor() as u32
        } else {
            0
        }
    }

    /// Get beat number within bar for a given timestamp (1-indexed)
    pub fn get_beat_in_bar(&self, timestamp_ms: f64) -> u32 {
        if self.bpm <= 0.0 {
            return 1;
        }
        let ms_per_beat = 60000.0 / self.bpm;
        let ms_per_bar = ms_per_beat * self.time_signature.beats_per_bar() as f64;
        if ms_per_bar > 0.0 && ms_per_beat > 0.0 {
            let position_in_bar = timestamp_ms % ms_per_bar;
            let beat = (position_in_bar / ms_per_beat).floor() as u32;
            (beat + 1).min(self.time_signature.beats_per_bar())
        } else {
            1
        }
    }

    /// Get grid position (bar, beat, subdivision) for a timestamp
    pub fn get_grid_position(&self, timestamp_ms: f64) -> GridPosition {
        let (_, subdivision_idx) = self.get_nearest_beat(timestamp_ms);
        let subdivisions_per_beat = self.division.subdivisions_per_beat() as usize;
        let beats_per_bar = self.time_signature.beats_per_bar() as usize;
        let total_subdivisions_per_bar = beats_per_bar * subdivisions_per_beat;

        let bar = (subdivision_idx / total_subdivisions_per_bar) as u32;
        let beat_in_bar = ((subdivision_idx / subdivisions_per_beat) % beats_per_bar) as u32;
        let subdivision = (subdivision_idx % subdivisions_per_beat) as u32;

        GridPosition { bar, beat: beat_in_bar, subdivision }
    }

    /// Get timestamp for a specific grid position
    pub fn get_timestamp_for_position(&self, position: &GridPosition) -> Option<f64> {
        let subdivisions_per_beat = self.division.subdivisions_per_beat() as usize;
        let beats_per_bar = self.time_signature.beats_per_bar() as usize;
        let total_subdivisions = position.bar as usize * (beats_per_bar * subdivisions_per_beat)
            + position.beat as usize * subdivisions_per_beat
            + position.subdivision as usize;
        Some(self.calculate_position_at_index(total_subdivisions))
    }

    /// Helper to calculate the timestamp for a specific subdivision index
    fn calculate_position_at_index(&self, index: usize) -> f64 {
        let ms_per_beat = 60000.0 / self.bpm;
        let subdivisions_per_beat = self.division.subdivisions_per_beat() as usize;
        let subdivision_duration = ms_per_beat / subdivisions_per_beat as f64;
        let beat = index / subdivisions_per_beat;
        let sub = index % subdivisions_per_beat;
        let mut pos = beat as f64 * ms_per_beat + sub as f64 * subdivision_duration;
        if self.feel == GrooveFeel::Swing && sub % 2 == 1 {
            let swing_delay = (subdivision_duration * self.swing_amount as f64 * 0.33).min(subdivision_duration * 0.5);
            pos += swing_delay;
        }
        pos
    }

    /// Get total duration of the grid in milliseconds
    pub fn total_duration_ms(&self) -> f64 {
        if self.bpm <= 0.0 { return 0.0; }
        let ms_per_beat = 60000.0 / self.bpm;
        let beats_per_bar = self.time_signature.beats_per_bar();
        ms_per_beat * beats_per_bar as f64 * self.bar_count as f64
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_grid_creation() {
        let grid = Grid::new(120.0, TimeSignature::FourFour, GridDivision::Quarter, 4);
        assert_eq!(grid.bpm, 120.0);
        assert_eq!(grid.bar_count, 4);
        assert_eq!(grid.beat_positions_ms.len(), 16);
    }

    #[test]
    fn test_infinite_grid() {
        let grid = Grid::new(120.0, TimeSignature::FourFour, GridDivision::Sixteenth, 4);
        // Request a position at 15 seconds (bar 8 at 120BPM)
        let (pos, idx) = grid.get_nearest_beat(15000.0);
        assert!((pos - 15000.0).abs() < 1.0);
        assert_eq!(idx, 120); // 15s / 125ms = 120
        
        let gp = grid.get_grid_position(15000.0);
        assert_eq!(gp.bar, 7); // 8th bar (0-indexed)
    }
}
