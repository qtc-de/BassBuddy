use crate::common::{is_silent, parabolic_peak, tau_bounds};

/// Classic normalized autocorrelation: correlate the signal with delayed
/// copies of itself and pick the strongest peak. Simpler and cheaper than
/// YIN, but more prone to picking an octave-related peak on notes with
/// strong harmonics.
pub fn detect(samples: &[f32], sample_rate: f32, silence_threshold: f64) -> f32 {
    let n = samples.len();
    if n < 4 || is_silent(samples, silence_threshold) {
        return 0.0;
    }

    let (min_tau, max_tau) = tau_bounds(sample_rate, n);
    if max_tau <= min_tau {
        return 0.0;
    }

    // Compute from tau=1, not min_tau: without the lags below min_tau the
    // search window's left edge has nothing to compare against and gets
    // mistaken for a local peak, even though it's just the tail of the
    // (still-descending) correlation curve near tau=0.
    let mut corr = vec![0.0f64; max_tau + 1];
    for tau in 1..=max_tau {
        let limit = n - tau;
        let mut sum = 0.0f64;
        let mut energy_a = 0.0f64;
        let mut energy_b = 0.0f64;
        for j in 0..limit {
            let a = samples[j] as f64;
            let b = samples[j + tau] as f64;
            sum += a * b;
            energy_a += a * a;
            energy_b += b * b;
        }
        // Normalize against the energy of the *same window* used for the
        // correlation sum on both sides, not the whole buffer — otherwise
        // the shrinking window at large tau is compared against a
        // constant full-buffer energy and short lags win spuriously.
        let denom = (energy_a * energy_b).sqrt();
        corr[tau] = if denom > 0.0 { sum / denom } else { 0.0 };
    }

    let (_, global_best_val) = (min_tau..=max_tau)
        .map(|t| (t, corr[t]))
        .fold((min_tau, f64::MIN), |acc, x| if x.1 > acc.1 { x } else { acc });

    if global_best_val < 0.35 {
        return 0.0;
    }

    // Pure autocorrelation gives near-equal correlation at a true period and
    // at its multiples (a harmonic-free tone repeats identically at 2x, 3x
    // its period too), which causes octave-down errors if we just take the
    // global max. The standard fix: walk up from the shortest lag and take
    // the first local peak that is nearly as strong as the global best,
    // since the true fundamental's peak is always the earliest one.
    let octave_tolerance = 0.9 * global_best_val;
    let mut best_tau = min_tau;
    for tau in min_tau..=max_tau {
        let ge_prev = corr[tau] >= corr[tau - 1];
        let ge_next = tau == max_tau || corr[tau] >= corr[tau + 1];
        if ge_prev && ge_next && corr[tau] >= octave_tolerance {
            best_tau = tau;
            break;
        }
    }

    let refined_tau = parabolic_peak(&corr, best_tau);
    if refined_tau <= 0.0 {
        return 0.0;
    }

    (sample_rate as f64 / refined_tau) as f32
}
