use std::f64::consts::PI;

/// Shared tuning constants and helpers for all pitch-detection algorithms.
/// Range covers a low-B five-string bass through the upper frets of a
/// standard 4-string bass.
pub const MIN_FREQ: f64 = 25.0;
pub const MAX_FREQ: f64 = 500.0;

/// Goertzel magnitude of `samples` at an arbitrary (non-bin-aligned) target
/// frequency. Equivalent to a single-frequency DFT coefficient.
pub fn goertzel_mag(samples: &[f64], sample_rate: f64, target_freq: f64) -> f64 {
    let n = samples.len() as f64;
    let k = target_freq * n / sample_rate;
    let w = 2.0 * PI * k / n;
    let cosine = w.cos();
    let coeff = 2.0 * cosine;

    let mut q1 = 0.0f64;
    let mut q2 = 0.0f64;
    for &s in samples {
        let q0 = coeff * q1 - q2 + s;
        q2 = q1;
        q1 = q0;
    }
    let real = q1 - q2 * cosine;
    let imag = q2 * w.sin();
    (real * real + imag * imag).sqrt()
}

/// Hann-windowed copy of `samples` as f64, to reduce spectral leakage before
/// a Goertzel/DFT-style frequency-domain measurement.
pub fn hann_windowed(samples: &[f32]) -> Vec<f64> {
    let n = samples.len();
    samples
        .iter()
        .enumerate()
        .map(|(i, &s)| {
            let w = 0.5 - 0.5 * (2.0 * PI * i as f64 / (n - 1) as f64).cos();
            s as f64 * w
        })
        .collect()
}

pub fn rms(samples: &[f32]) -> f64 {
    let n = samples.len();
    if n == 0 {
        return 0.0;
    }
    (samples.iter().map(|&s| (s as f64) * (s as f64)).sum::<f64>() / n as f64).sqrt()
}

pub fn is_silent(samples: &[f32], threshold: f64) -> bool {
    rms(samples) < threshold
}

/// tau bounds (in samples) corresponding to MIN_FREQ..MAX_FREQ at the given
/// sample rate, clamped to the buffer length.
pub fn tau_bounds(sample_rate: f32, n: usize) -> (usize, usize) {
    let min_tau = (sample_rate as f64 / MAX_FREQ).floor().max(2.0) as usize;
    let max_tau = ((sample_rate as f64 / MIN_FREQ).ceil() as usize).min(n / 2);
    (min_tau, max_tau)
}

/// Parabolic interpolation of the minimum/maximum around index `i` of `values`,
/// returning a refined (sub-sample) index.
pub fn parabolic_peak(values: &[f64], i: usize) -> f64 {
    if i == 0 || i + 1 >= values.len() {
        return i as f64;
    }
    let s0 = values[i - 1];
    let s1 = values[i];
    let s2 = values[i + 1];
    let denom = 2.0 * (2.0 * s1 - s2 - s0);
    if denom.abs() > f64::EPSILON {
        i as f64 + (s2 - s0) / (2.0 * denom)
    } else {
        i as f64
    }
}
