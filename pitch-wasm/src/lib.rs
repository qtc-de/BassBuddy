mod acf;
mod common;
mod hps;
mod yin;

use wasm_bindgen::prelude::*;

/// Algorithm ids used from JS. Keep in sync with src/lib/algorithms.js.
pub const ALGO_YIN: u32 = 0;
pub const ALGO_ACF: u32 = 1;
pub const ALGO_HPS: u32 = 2;

/// Detects the fundamental frequency of a mono audio buffer, tuned for
/// bass-guitar range (roughly 25 Hz - 500 Hz), using the selected algorithm.
///
/// Returns the frequency in Hz, or 0.0 if no confident pitch was found.
#[wasm_bindgen]
pub fn detect_pitch(algo: u32, samples: &[f32], sample_rate: f32, silence_threshold: f64) -> f32 {
    match algo {
        ALGO_ACF => acf::detect(samples, sample_rate, silence_threshold),
        ALGO_HPS => hps::detect(samples, sample_rate, silence_threshold),
        _ => yin::detect(samples, sample_rate, silence_threshold),
    }
}
