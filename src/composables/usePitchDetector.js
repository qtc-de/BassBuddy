import { ref, shallowRef, onMounted, onUnmounted, watch } from 'vue';
import init, { detect_pitch } from '../pitch-wasm/pitch_wasm.js';
import { analyzeFrequency } from '../lib/notes.js';
import { DEFAULT_ALGORITHM_ID } from '../lib/algorithms.js';

// 8192 samples (~185ms @ 44.1kHz) gives low bass fundamentals (G1 ~= 49Hz)
// several more periods to work with than 4096 did, which makes the
// difference/correlation functions all three algorithms rely on far less
// noisy right where octave errors are most likely.
const FFT_SIZE = 8192;
const DETECT_INTERVAL_MS = 40; // ~25 detections/sec
const STABLE_HITS_REQUIRED = 2; // consecutive same-note detections before UI updates
const SILENCE_HOLD_MS = 250; // keep showing the last note briefly after signal drops

// RMS below which a buffer is treated as silence (no pitch reported).
// Raising this filters out quiet/incidental noise, e.g. barely brushing a
// string, at the cost of needing a firmer pluck to register at all.
export const DEFAULT_NOISE_GATE = 0.02;
export const MIN_NOISE_GATE = 0.001;
export const MAX_NOISE_GATE = 0.03;

export function usePitchDetector() {
  const isListening = ref(false);
  const error = ref(null);
  const frequency = ref(0);
  const note = shallowRef(null);
  const algorithm = ref(DEFAULT_ALGORITHM_ID);
  const noiseGate = ref(DEFAULT_NOISE_GATE);
  const inputDevices = shallowRef([]); // [{ deviceId, label }], audio-input kind only
  const selectedDeviceId = ref(''); // '' = let the browser pick the default

  let audioCtx = null;
  let analyser = null;
  let mediaStream = null;
  let sourceNode = null;
  let timerId = null;
  let buffer = null;
  let wasmReady = false;

  let pendingMidi = null;
  let pendingHits = 0;
  let lastVoicedAt = 0;

  async function ensureWasm() {
    if (!wasmReady) {
      await init();
      wasmReady = true;
    }
  }

  // Device labels are only populated once mic permission has been granted
  // at least once; call this again after getUserMedia succeeds to fill
  // them in, and on 'devicechange' so plugging/unplugging an interface
  // updates the list live.
  async function refreshDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      inputDevices.value = devices
        .filter((d) => d.kind === 'audioinput')
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
    } catch {
      // Enumeration failing (unsupported browser, etc.) just means no
      // device picker — the default getUserMedia behavior still works.
    }
  }

  function handleDeviceChange() {
    refreshDevices();
  }

  onMounted(() => {
    refreshDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', handleDeviceChange);
  });

  onUnmounted(() => {
    navigator.mediaDevices?.removeEventListener?.('devicechange', handleDeviceChange);
  });

  // Switching microphones while already listening restarts the stream
  // with the new device instead of silently continuing to read the old one.
  watch(selectedDeviceId, () => {
    if (isListening.value) {
      stop();
      start();
    }
  });

  function tick() {
    analyser.getFloatTimeDomainData(buffer);
    const freq = detect_pitch(algorithm.value, buffer, audioCtx.sampleRate, noiseGate.value);
    const now = performance.now();

    if (freq > 0) {
      lastVoicedAt = now;
      const info = analyzeFrequency(freq);

      if (pendingMidi === info.midi) {
        pendingHits += 1;
      } else {
        pendingMidi = info.midi;
        pendingHits = 1;
      }

      if (pendingHits >= STABLE_HITS_REQUIRED) {
        frequency.value = freq;
        note.value = info;
      }
    } else if (now - lastVoicedAt > SILENCE_HOLD_MS) {
      frequency.value = 0;
      note.value = null;
      pendingMidi = null;
      pendingHits = 0;
    }
  }

  async function start() {
    if (isListening.value) return;
    error.value = null;
    try {
      await ensureWasm();
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          ...(selectedDeviceId.value ? { deviceId: { exact: selectedDeviceId.value } } : {}),
        },
      });
      refreshDevices(); // labels are only available after permission is granted

      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      sourceNode = audioCtx.createMediaStreamSource(mediaStream);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      sourceNode.connect(analyser);

      buffer = new Float32Array(analyser.fftSize);
      pendingMidi = null;
      pendingHits = 0;
      lastVoicedAt = 0;

      timerId = setInterval(tick, DETECT_INTERVAL_MS);
      isListening.value = true;
    } catch (err) {
      error.value = err.message || String(err);
      stop();
    }
  }

  function stop() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
    if (sourceNode) {
      sourceNode.disconnect();
      sourceNode = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
    if (audioCtx) {
      audioCtx.close();
      audioCtx = null;
    }
    analyser = null;
    buffer = null;
    isListening.value = false;
    frequency.value = 0;
    note.value = null;
  }

  return {
    isListening,
    error,
    frequency,
    note,
    algorithm,
    noiseGate,
    inputDevices,
    selectedDeviceId,
    start,
    stop,
  };
}
