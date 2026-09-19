const NOTE_DURATION = 0.45; // seconds each note rings for
const NOTE_GAP = 0.15; // seconds of silence between notes
const SCHEDULE_LEAD = 0.05; // seconds before the first note starts

let audioCtx = null;

function getContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

/** Schedules one plucked-bass-ish tone: fast attack, exponential decay. */
function scheduleNote(ctx, freq, startTime) {
  const osc = ctx.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = freq;

  const gain = ctx.createGain();
  const peak = 0.25;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peak, startTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + NOTE_DURATION);

  osc.connect(gain).connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + NOTE_DURATION + 0.05);
}

/**
 * Plays a sequence of frequencies (Hz) back-to-back for "play what you
 * hear" exercises. Returns a promise that resolves once playback finishes.
 */
export async function playFrequencies(freqs) {
  if (!freqs || freqs.length === 0) return;

  const ctx = getContext();
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }

  const startTime = ctx.currentTime + SCHEDULE_LEAD;
  freqs.forEach((freq, i) => {
    scheduleNote(ctx, freq, startTime + i * (NOTE_DURATION + NOTE_GAP));
  });

  const totalMs = (SCHEDULE_LEAD + freqs.length * (NOTE_DURATION + NOTE_GAP)) * 1000;
  await new Promise((resolve) => setTimeout(resolve, totalMs));
}
