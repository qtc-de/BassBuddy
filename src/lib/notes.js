const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const A4_FREQ = 440;
export const A4_MIDI = 69;

// Standard 4-string bass tuning, open-string frequencies (Hz).
export const BASS_STRINGS = [
  { name: 'G', freq: 98.0 },
  { name: 'D', freq: 73.42 },
  { name: 'A', freq: 55.0 },
  { name: 'E', freq: 41.2 },
];

export const FRET_COUNT = 15;

export function freqToMidi(freq) {
  return A4_MIDI + 12 * Math.log2(freq / A4_FREQ);
}

export function midiToFreq(midi) {
  return A4_FREQ * Math.pow(2, (midi - A4_MIDI) / 12);
}

export function midiToNoteName(midi) {
  const rounded = Math.round(midi);
  const name = NOTE_NAMES[((rounded % 12) + 12) % 12];
  const octave = Math.floor(rounded / 12) - 1;
  return { name, octave, label: `${name}${octave}` };
}

/**
 * Given a detected frequency, returns the nearest note info plus the cents
 * deviation from perfect pitch (-50..50).
 */
export function analyzeFrequency(freq) {
  const midi = freqToMidi(freq);
  const rounded = Math.round(midi);
  const cents = (midi - rounded) * 100;
  const { name, octave, label } = midiToNoteName(rounded);
  return { midi: rounded, name, octave, label, cents, freq };
}

/**
 * Name of the note (pitch class only, e.g. "C#") sounded by fretting the
 * given string at the given fret.
 */
export function noteNameAtFret(stringIndex, fret) {
  const string = BASS_STRINGS[stringIndex];
  const openMidi = Math.round(freqToMidi(string.freq));
  return midiToNoteName(openMidi + fret).name;
}

/**
 * Finds every (string, fret) position on the bass neck that plays the given
 * MIDI note, within FRET_COUNT frets of the nut.
 */
export function findFretPositions(midi) {
  const positions = [];
  BASS_STRINGS.forEach((string, stringIndex) => {
    const openMidi = Math.round(freqToMidi(string.freq));
    const fret = midi - openMidi;
    if (fret >= 0 && fret <= FRET_COUNT) {
      positions.push({ stringIndex, fret });
    }
  });
  return positions;
}

/**
 * Finds every (string, fret) position on the bass neck that plays the given
 * pitch class (e.g. "C#"), in any octave, within FRET_COUNT frets of the
 * nut. Unlike findFretPositions (which matches one exact octave), this is
 * what exercises should use: a played note is scored correct by pitch
 * class regardless of octave, so the fretboard highlight needs to consider
 * every octave too — otherwise a correct note whose only occurrences of
 * *that specific octave* fall outside the exercise's fretboard section
 * would score correct but show no marker at all.
 */
export function findFretPositionsForPitchClass(name) {
  const positions = [];
  BASS_STRINGS.forEach((string, stringIndex) => {
    for (let fret = 0; fret <= FRET_COUNT; fret++) {
      if (noteNameAtFret(stringIndex, fret) === name) {
        positions.push({ stringIndex, fret });
      }
    }
  });
  return positions;
}

/** Inverse of midiToNoteName: the MIDI number for a pitch class in a given octave. */
export function nameOctaveToMidi(name, octave) {
  return (octave + 1) * 12 + NOTE_NAMES.indexOf(name);
}

const NOTE_SPEC_RE = /^([A-G]#?)(-?\d+)?$/;

/**
 * Parses an exercise note spec (as normalized by exercises.js — already
 * sharp, e.g. "C#", with an optional trailing octave digit, e.g. "G2")
 * into its pitch class and octave (null if the spec didn't pin one down).
 */
export function parseNoteSpec(spec) {
  const m = NOTE_SPEC_RE.exec(spec);
  if (!m) return { name: spec, octave: null };
  const [, name, octaveStr] = m;
  return { name, octave: octaveStr != null ? Number(octaveStr) : null };
}

/**
 * Whether a detected note (from analyzeFrequency: { name, octave, ... })
 * satisfies a note spec — matching pitch class always, and matching the
 * exact octave too when the spec pinned one down.
 */
export function noteSpecMatches(spec, noteInfo) {
  const { name, octave } = parseNoteSpec(spec);
  return noteInfo.name === name && (octave == null || noteInfo.octave === octave);
}
