### Algorithms

----

Three interchangeable pitch-detection algorithms are built into the wasm
module and selectable at runtime from the UI:

- **YIN** — cumulative mean-normalized difference function (default, most robust against octave errors)
- **Autocorrelation** — classic normalized autocorrelation peak-picking
- **Harmonic Product Spectrum** — frequency-domain, Goertzel-based harmonic scan

YIN additionally cross-checks its result against a Goertzel measurement at
half the detected frequency, and backs off an octave if that subharmonic
carries real energy. This specifically targets low bass notes (roughly
below 100 Hz) whose fundamental is naturally weak relative to their 2nd
harmonic through typical mics — without it, YIN can otherwise lock onto the
2nd harmonic and report the note an octave too high (e.g. G1 read as G2).
