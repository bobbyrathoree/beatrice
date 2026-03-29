// Effect name selectors
// These return effect names used by the WebAudio frontend.
// Rust-side effects processing is not implemented.

pub fn gated_reverb() -> &'static str { "gated_reverb" }
pub fn dark_delay() -> &'static str { "dark_delay" }
pub fn wide_chorus() -> &'static str { "wide_chorus" }
pub fn sidechain_duck() -> &'static str { "sidechain_duck" }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_effect_selectors() {
        assert_eq!(gated_reverb(), "gated_reverb");
        assert_eq!(dark_delay(), "dark_delay");
        assert_eq!(wide_chorus(), "wide_chorus");
        assert_eq!(sidechain_duck(), "sidechain_duck");
    }
}
