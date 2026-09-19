// Keep ids in sync with pitch-wasm/src/lib.rs (ALGO_YIN / ALGO_ACF / ALGO_HPS).
export const ALGORITHMS = [
  {
    id: 0,
    key: 'yin',
    name: 'YIN',
    description: 'Cumulative mean-normalized difference. Robust against octave errors; the default.',
  },
  {
    id: 1,
    key: 'acf',
    name: 'Autocorrelation',
    description: 'Classic normalized autocorrelation peak-picking. Simpler and cheaper than YIN.',
  },
  {
    id: 2,
    key: 'hps',
    name: 'Harmonic Product Spectrum',
    description: 'Frequency-domain: scans candidate fundamentals via Goertzel, scored by their harmonics.',
  },
];

export const DEFAULT_ALGORITHM_ID = ALGORITHMS[0].id;
