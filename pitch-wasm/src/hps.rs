use crate::common::{goertzel_mag, hann_windowed, is_silent, parabolic_peak, MAX_FREQ, MIN_FREQ};

const CENTS_STEP: f64 = 8.0;
const HARMONICS: [f64; 3] = [1.0, 2.0, 3.0];
const HARMONIC_WEIGHT: [f64; 3] = [1.0, 0.6, 0.35];

/// Harmonic Product Spectrum via Goertzel: scans candidate fundamental
/// frequencies on a cents grid and scores each by its own energy plus its
/// first two harmonics' energy. This is a frequency-domain technique,
/// distinct from the time-domain YIN/autocorrelation approaches, and tends
/// to lock onto the true fundamental even when it is weaker than a harmonic.
pub fn detect(samples: &[f32], sample_rate: f32, silence_threshold: f64) -> f32 {
    if samples.len() < 4 || is_silent(samples, silence_threshold) {
        return 0.0;
    }
    let sr = sample_rate as f64;
    let nyquist = sr / 2.0;

    let steps = ((1200.0 / CENTS_STEP) * (MAX_FREQ / MIN_FREQ).log2()).ceil() as usize;
    if steps == 0 {
        return 0.0;
    }

    // A Hann window trades a bit of frequency resolution for much lower
    // spectral leakage, which matters here: at bass fundamentals the
    // analysis window only spans a handful of periods, so leakage from the
    // fundamental itself can otherwise pull the estimated peak off-frequency
    // by tens of cents.
    let windowed = hann_windowed(samples);

    let mut scores = vec![0.0f64; steps + 1];

    for i in 0..=steps {
        let freq = MIN_FREQ * 2f64.powf((i as f64 * CENTS_STEP) / 1200.0);
        let mut score = 0.0;
        for (h, weight) in HARMONICS.iter().zip(HARMONIC_WEIGHT.iter()) {
            let hf = freq * h;
            if hf < nyquist {
                score += weight * goertzel_mag(&windowed, sr, hf);
            }
        }
        scores[i] = score;
    }

    let (best_i, best_score) = scores
        .iter()
        .enumerate()
        .fold((0usize, f64::MIN), |acc, (i, &v)| if v > acc.1 { (i, v) } else { acc });

    if best_score <= 0.0 {
        return 0.0;
    }

    let refined_i = parabolic_peak(&scores, best_i);
    let freq = MIN_FREQ * 2f64.powf((refined_i * CENTS_STEP) / 1200.0);
    freq as f32
}
