import { BASS_STRINGS, findFretPositionsForPitchClass } from './notes.js';

// Real recorded bass notes for "play what you hear" exercises, replacing
// the old oscillator synth. Each public/<String> String.m4a file is one
// take per string, plucked fret-by-fret from open (0) to the 15th fret at
// 60bpm with a whole note (4 beats = 4s) held per fret.
const NOTE_PERIOD = 4; // seconds between fret onsets in the recording
const ONSET_OFFSET = 0.03; // lead-in silence before each pluck in the recording
const PLAY_DURATION = 0.45; // seconds of each recorded note actually played back
const NOTE_GAP = 0.15; // seconds of silence between notes
const SCHEDULE_LEAD = 0.05; // seconds before the first note starts
const FADE_IN = 0.005; // avoids a click at slice start
const FADE_OUT = 0.05; // avoids a click where playback is cut off mid-sustain

const SAMPLE_FILES = { G: 'G String.m4a', D: 'D String.m4a', A: 'A String.m4a', E: 'E String.m4a' };

let audioCtx = null;
const bufferPromises = {};

function getContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function loadBuffer(ctx, stringName) {
  if (!bufferPromises[stringName]) {
    bufferPromises[stringName] = (async () => {
      const base = import.meta.env.BASE_URL;
      const res = await fetch(`${base}resources/${encodeURIComponent(SAMPLE_FILES[stringName])}`);
      const data = await res.arrayBuffer();
      return ctx.decodeAudioData(data);
    })();
  }
  return bufferPromises[stringName];
}

/**
 * Picks the cleanest recorded position for a pitch class: whichever
 * string plays it closest to the open string (lowest fret = cleanest
 * take in the recording, and away from the far end of the neck).
 */
function bestPosition(name) {
  const positions = findFretPositionsForPitchClass(name);
  return positions.reduce((best, p) => (p.fret < best.fret ? p : best), positions[0]);
}

function scheduleNote(ctx, buffer, fret, startTime) {
  const offset = fret * NOTE_PERIOD + ONSET_OFFSET;

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(1, startTime + FADE_IN);
  gain.gain.setValueAtTime(1, startTime + PLAY_DURATION - FADE_OUT);
  gain.gain.linearRampToValueAtTime(0, startTime + PLAY_DURATION);

  source.connect(gain).connect(ctx.destination);
  source.start(startTime, offset, PLAY_DURATION);
}

/**
 * Plays a sequence of pitch classes (e.g. "C#") back-to-back for "play
 * what you hear" exercises, using real recorded bass notes sliced out of
 * the per-string takes. Returns a promise that resolves once playback
 * finishes.
 */
export async function playNotes(names) {
  if (!names || names.length === 0) return;

  const ctx = getContext();
  if (ctx.state === 'suspended') {
    await ctx.resume();
  }

  const positions = names.map(bestPosition);
  const buffers = await Promise.all(
    positions.map((p) => loadBuffer(ctx, BASS_STRINGS[p.stringIndex].name))
  );

  const startTime = ctx.currentTime + SCHEDULE_LEAD;
  positions.forEach((p, i) => {
    scheduleNote(ctx, buffers[i], p.fret, startTime + i * (PLAY_DURATION + NOTE_GAP));
  });

  const totalMs = (SCHEDULE_LEAD + names.length * (PLAY_DURATION + NOTE_GAP)) * 1000;
  await new Promise((resolve) => setTimeout(resolve, totalMs));
}
