import { ref } from 'vue';
import { BASS_STRINGS, findFretPositions, findFretPositionsForPitchClass, nameOctaveToMidi, parseNoteSpec } from './notes.js';

// Only set by an explicit, manually-triggered playNotes(..., { manual: true })
// call (the ▶ Replay button) — never by exercise auto-play, so a blocked
// autoplay attempt on exercise start doesn't nag the player with an error
// they didn't cause. Cleared on that same manual call's success.
export const playbackError = ref('');

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

// "Play what you hear" exercises auto-play (a watcher schedules the first
// playback via setTimeout, and each subsequent exercise in a set can
// auto-advance without a fresh tap) — not from a direct click. Mobile
// browsers only allow an AudioContext to actually produce sound if it was
// resumed synchronously inside a real user gesture; a context resumed from
// a timer stays silently suspended. So resume (and, for older iOS/Safari,
// play one silent buffer) on the very first tap/keypress anywhere on the
// page, once, so the context is already running by the time auto-play
// tries to use it.
// Exported so call sites can invoke it directly inside their own click/tap
// handlers (belt-and-suspenders alongside the document-level listener
// below) — some iOS Safari versions are picky about a bubbled listener
// counting as "the" user gesture, so the buttons that actually kick off
// playback (Start Listening, the exercise picker, Replay) call this
// synchronously as the first thing they do too.
export function unlockAudio() {
  try {
    const ctx = getContext();
    if (ctx.state === 'suspended') ctx.resume();
    const silence = ctx.createBuffer(1, 1, ctx.sampleRate);
    const source = ctx.createBufferSource();
    source.buffer = silence;
    source.connect(ctx.destination);
    source.start(0);
  } catch (err) {
    console.error('BassBuddy: audio unlock failed:', err);
  }
}

if (typeof document !== 'undefined') {
  const onFirstGesture = () => {
    unlockAudio();
    document.removeEventListener('pointerdown', onFirstGesture);
    document.removeEventListener('touchend', onFirstGesture);
    document.removeEventListener('keydown', onFirstGesture);
  };
  document.addEventListener('pointerdown', onFirstGesture, { passive: true });
  document.addEventListener('touchend', onFirstGesture, { passive: true });
  document.addEventListener('keydown', onFirstGesture);
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
 * Picks the cleanest recorded position for a note spec: whichever string
 * plays it closest to the open string (lowest fret = cleanest take in the
 * recording, and away from the far end of the neck) — restricted to the
 * exact octave when the spec pins one down (e.g. "G2"), falling back to
 * any octave if that exact one isn't within the recorded 0-15 fret range
 * on any string.
 */
function bestPosition(spec) {
  const { name, octave } = parseNoteSpec(spec);
  if (octave != null) {
    const exact = findFretPositions(nameOctaveToMidi(name, octave));
    if (exact.length > 0) {
      return exact.reduce((best, p) => (p.fret < best.fret ? p : best), exact[0]);
    }
    console.warn(`BassBuddy: no recorded sample for "${spec}" (outside the 0-15 fret range) — using a different octave instead.`);
  }
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
 * Plays a sequence of note specs (e.g. "C#", or "G2" for a specific
 * octave) back-to-back for "play what you hear" exercises, using real
 * recorded bass notes sliced out of the per-string takes. Returns a
 * promise that resolves once playback finishes.
 */
export async function playNotes(names, { manual = false } = {}) {
  if (!names || names.length === 0) return;
  if (manual) playbackError.value = '';

  try {
    const ctx = getContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    if (ctx.state !== 'running') {
      // Autoplay was blocked (no user gesture has unlocked audio yet) —
      // scheduling notes now would just silently produce no sound.
      const msg = `audio blocked — context state is "${ctx.state}" instead of "running"`;
      console.warn('BassBuddy:', msg);
      if (manual) playbackError.value = msg;
      return;
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
  } catch (err) {
    console.error('BassBuddy: failed to play recorded notes:', err);
    if (manual) playbackError.value = `playback failed: ${err.message}`;
  }
}
