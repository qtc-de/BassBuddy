use crate::common::{goertzel_mag, hann_windowed, is_silent, parabolic_peak, tau_bounds, MIN_FREQ};

const YIN_THRESHOLD: f64 = 0.15;
// If the frequency-domain energy at half the detected frequency is at least
// this fraction of the energy at the detected frequency itself, treat the
// detected frequency as actually the 2nd harmonic of a real (if weak)
// fundamental one octave down, and correct for it. See `correct_weak_fundamental`.
const SUBHARMONIC_RATIO_THRESHOLD: f64 = 0.03;

/// YIN algorithm: cumulative-mean-normalized difference function, which
/// suppresses the octave errors that plague plain autocorrelation.
pub fn detect(samples: &[f32], sample_rate: f32, silence_threshold: f64) -> f32 {
    let n = samples.len();
    if n < 4 || is_silent(samples, silence_threshold) {
        return 0.0;
    }

    let (min_tau, max_tau) = tau_bounds(sample_rate, n);
    if max_tau <= min_tau {
        return 0.0;
    }

    let mut diff = vec![0.0f64; max_tau + 1];
    for tau in min_tau..=max_tau {
        let mut sum = 0.0f64;
        let limit = n - tau;
        for j in 0..limit {
            let d = samples[j] as f64 - samples[j + tau] as f64;
            sum += d * d;
        }
        diff[tau] = sum;
    }

    let mut cmnd = vec![0.0f64; max_tau + 1];
    let mut running_sum = 0.0f64;
    for tau in min_tau..=max_tau {
        running_sum += diff[tau];
        cmnd[tau] = if running_sum > 0.0 {
            diff[tau] * (tau - min_tau + 1) as f64 / running_sum
        } else {
            1.0
        };
    }

    let mut chosen_tau: Option<usize> = None;
    let mut tau = min_tau;
    while tau <= max_tau {
        if cmnd[tau] < YIN_THRESHOLD {
            let mut local_min_tau = tau;
            while local_min_tau + 1 <= max_tau && cmnd[local_min_tau + 1] < cmnd[local_min_tau] {
                local_min_tau += 1;
            }
            chosen_tau = Some(local_min_tau);
            break;
        }
        tau += 1;
    }

    let best_tau = match chosen_tau {
        Some(t) => t,
        None => {
            let (t, v) = (min_tau..=max_tau)
                .map(|t| (t, cmnd[t]))
                .fold((min_tau, f64::MAX), |acc, x| if x.1 < acc.1 { x } else { acc });
            if v > 0.5 {
                return 0.0;
            }
            t
        }
    };

    let refined_tau = parabolic_peak(&cmnd, best_tau);
    if refined_tau <= 0.0 {
        return 0.0;
    }

    let freq = sample_rate as f64 / refined_tau;
    correct_weak_fundamental(samples, sample_rate as f64, freq) as f32
}

/// YIN's threshold-based search is deliberately biased towards the
/// shortest lag that looks periodic enough, to avoid octave-*down* errors.
/// That same bias can make it lock onto a strong 2nd harmonic's own period
/// when the true fundamental is quite weak — common on bass notes below
/// ~100 Hz, since mic/preamp response often under-represents the lowest
/// fundamental. A time-domain fix (comparing YIN's own difference function
/// across lag scales) turns out to be unreliable: that function trends
/// with lag somewhat independently of true periodicity, so "checking
/// whether a longer lag also looks periodic" tends to misfire on ordinary
/// clean tones too. Measuring actual energy at the candidate subharmonic
/// with Goertzel is a genuinely independent signal instead: a real higher
/// note has essentially no energy at half its frequency (that would be a
/// subharmonic, not a harmonic), while a real note with a weak fundamental
/// still has *some* — just not enough to win YIN's time-domain threshold.
fn correct_weak_fundamental(samples: &[f32], sample_rate: f64, freq: f64) -> f64 {
    let windowed = hann_windowed(samples);
    let mut candidate = freq;
    for _ in 0..3 {
        let half = candidate / 2.0;
        if half < MIN_FREQ {
            break;
        }
        let mag_candidate = goertzel_mag(&windowed, sample_rate, candidate);
        if mag_candidate <= 0.0 {
            break;
        }
        let mag_half = goertzel_mag(&windowed, sample_rate, half);
        if mag_half / mag_candidate >= SUBHARMONIC_RATIO_THRESHOLD {
            candidate = half;
        } else {
            break;
        }
    }
    candidate
}
