// Synthesizer patch selectors
// These return patch names used by the WebAudio frontend for synthesis.
// Rust-side synthesis is not implemented — all sound generation happens in
// useAudioPlayback.ts via the Web Audio API.

/// Bass synth patch selector
pub fn bass_synth() -> &'static str {
    "bass"
}

/// Pad synth patch selector
pub fn pad_synth() -> &'static str {
    "pad"
}

/// Synth stab patch selector
pub fn stab_synth() -> &'static str {
    "stab"
}

/// Arpeggio synth patch selector
pub fn arp_synth() -> &'static str {
    "arp"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_patch_selectors() {
        assert_eq!(bass_synth(), "bass");
        assert_eq!(pad_synth(), "pad");
        assert_eq!(stab_synth(), "stab");
        assert_eq!(arp_synth(), "arp");
    }
}
