import { load as loadYaml } from 'js-yaml';
import { FRET_COUNT } from './notes.js';

const FLAT_TO_SHARP = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };
const VALID_NOTES = new Set(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']);

/** Virtual folder name shown for exercise sets imported from disk. */
export const UPLOADED_FOLDER = 'Uploaded Exercises';

const UPLOADED_STORAGE_KEY = 'bassbuddy:uploadedExercises';

// A trailing (optionally negative) integer pins the note to one specific
// octave (e.g. "G2"); without it, the pitch class part before it is
// checked/normalized exactly as before and matches any octave.
const NOTE_OCTAVE_RE = /^([A-Za-z][#bB]?)(-?\d+)?$/;

function normalizeNote(raw, context) {
  const cleaned = String(raw).trim();
  const m = NOTE_OCTAVE_RE.exec(cleaned);
  if (!m) {
    throw new Error(`${context}: invalid note "${raw}"`);
  }
  const [, pitchPart, octavePart] = m;
  const combined = pitchPart.charAt(0).toUpperCase() + pitchPart.slice(1).toLowerCase();
  const sharp = FLAT_TO_SHARP[combined] || combined;
  if (!VALID_NOTES.has(sharp)) {
    throw new Error(`${context}: invalid note "${raw}"`);
  }
  return octavePart != null ? `${sharp}${octavePart}` : sharp;
}

function parsePositiveInt(value, context, key) {
  if (value == null) return null;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${context}: "${key}" must be a positive integer`);
  }
  return value;
}

function parseBoolean(value, context, key, defaultValue) {
  if (value == null) return defaultValue;
  if (typeof value !== 'boolean') {
    throw new Error(`${context}: "${key}" must be true or false`);
  }
  return value;
}

function normalizeFretboard(spec, context) {
  if (spec == null) return null;
  if (Array.isArray(spec.frets)) {
    const frets = spec.frets.map(Number).filter((f) => Number.isInteger(f) && f >= 0 && f <= FRET_COUNT);
    return { frets: new Set(frets) };
  }
  if (spec.start != null && spec.end != null) {
    const start = Number(spec.start);
    const end = Number(spec.end);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) {
      throw new Error(`${context}: invalid fretboard start/end`);
    }
    const frets = new Set();
    for (let f = Math.max(0, start); f <= Math.min(FRET_COUNT, end); f++) frets.add(f);
    return { frets };
  }
  return null;
}

/**
 * Parses and validates a BassBuddy exercise YAML document. A file is a
 * single practice *set*: its top-level `ordered` key says whether the
 * set's exercises are worked through in the listed order or shuffled, and
 * is independent of each exercise's own `ordered` key (which is about the
 * order of *notes* within that one exercise).
 *
 * Each exercise's `mode` (defaults to "see") controls how the notes are
 * presented: "see" shows them as usual; "hear" plays them as audio (via
 * Web Audio synthesis) instead, for ear-training — the fretboard/UI hides
 * the "next note" text hint in that mode so it doesn't give away the answer.
 *
 * An exercise can use `randomNotes: N` instead of (or alongside) a fixed
 * `notes` list: the app draws N *fresh* random notes every time the
 * exercise starts or restarts, from `notes` as the pool if given, or the
 * full chromatic scale otherwise. This lets one exercise cover a fretboard
 * zone indefinitely with genuine variation, instead of needing several
 * pre-written exercises with different fixed note lists for variety.
 *
 * Each entry in `notes` is a pitch class (e.g. "C#", "Db") by default,
 * matched in any octave — append an integer octave (e.g. "G2") to require
 * that exact octave instead; a bare pitch class still matches every
 * octave. See notes.js's parseNoteSpec/noteSpecMatches for the matching
 * logic used at runtime.
 *
 * An exercise can also use `success_on: N` and/or `failure_on: N` in place
 * of a fixed sequence: the player plays freely from the `notes` pool (any
 * order, any number of repeats — this replaces the ordered/remainingCounts
 * scoring entirely), scoring a success point for every note that's in the
 * pool and a failure point for every note that isn't, and the exercise
 * ends the instant either count reaches its target (whichever is hit
 * first, if both are set). Presence of either key puts the exercise in
 * this "scoring" mode regardless of its own `ordered` value.
 *
 * In scoring mode, `accept_duplicates` (default true) controls whether a
 * note that's already scored a success point can score another: true (the
 * default) keeps the current unlimited-repeats behavior; false means only
 * the first time a given pitch+octave is played counts — a *different*
 * octave of an already-played pitch class still counts as a fresh point,
 * but only if that octave is actually reachable within the exercise's
 * fretboard window (its `fretboard` key, or the whole neck if unset). This
 * is for forcing a player through every distinct playable position of a
 * fretboard zone rather than letting them repeat one spot.
 *
 * Returns { sourceName, name, ordered, folder: null, exercises: [...] }.
 * `name` is the set's own display name (`bassbuddy.name`), falling back to
 * `sourceName` (the file name) when omitted. `folder` is always null here —
 * it's not part of the YAML, callers that know the set's location (its
 * subfolder under public/exercises, or that it was uploaded) fill it in.
 * Throws with a descriptive message on malformed input.
 */
export function parseExerciseYaml(text, sourceName = 'exercise') {
  let doc;
  try {
    doc = loadYaml(text);
  } catch (err) {
    throw new Error(`${sourceName}: could not parse YAML (${err.message})`);
  }

  const root = doc && doc.bassbuddy;
  if (!root || !Array.isArray(root.exercises)) {
    throw new Error(`${sourceName}: missing "bassbuddy.exercises" list`);
  }

  const exercises = root.exercises.map((raw, i) => {
    const context = `${sourceName} exercise #${i + 1}`;
    const hasFixedNotes = raw && Array.isArray(raw.notes) && raw.notes.length > 0;
    const randomCount = raw && Number.isInteger(raw.randomNotes) && raw.randomNotes > 0 ? raw.randomNotes : null;
    if (!raw || (!hasFixedNotes && !randomCount)) {
      throw new Error(`${context}: needs a non-empty "notes" list or a positive "randomNotes" count`);
    }
    const successOn = parsePositiveInt(raw.success_on, context, 'success_on');
    const failureOn = parsePositiveInt(raw.failure_on, context, 'failure_on');
    const acceptDuplicates = parseBoolean(raw.accept_duplicates, context, 'accept_duplicates', true);
    // With randomNotes set, `notes` (if given) is the pool to draw from
    // rather than a fixed sequence; the actual per-attempt sequence is
    // generated at runtime (see useExercises.js).
    const notes = hasFixedNotes ? raw.notes.map((n) => normalizeNote(n, context)) : [...VALID_NOTES];
    return {
      name: raw.name || `Exercise ${i + 1}`,
      description: raw.description || '',
      ordered: raw.ordered !== false,
      mode: raw.mode === 'hear' ? 'hear' : 'see',
      randomCount,
      successOn,
      failureOn,
      acceptDuplicates,
      notes,
      fretboard: normalizeFretboard(raw.fretboard, context),
    };
  });

  return { sourceName, name: root.name || sourceName, ordered: root.ordered !== false, folder: null, exercises };
}

/**
 * Fetches manifest.json + every listed file from /exercises (which may
 * live in subfolders) and parses them. Each set's `folder` is set to its
 * path relative to public/exercises (e.g. "scales", or null for files at
 * the root). Files that fail to parse are skipped with a console warning
 * rather than breaking the whole set.
 */
export async function loadBuiltInExerciseSets() {
  // import.meta.env.BASE_URL (Vite's configured `base`) rather than a bare
  // leading slash — this app is deployed at a subpath on GitHub Pages
  // project sites (e.g. /BassBuddy/), where an absolute "/exercises/..."
  // path would resolve to the wrong (site-root) URL.
  const base = import.meta.env.BASE_URL;
  const res = await fetch(`${base}exercises/manifest.json`);
  if (!res.ok) return [];
  const { files } = await res.json();

  const sets = [];
  for (const relPath of files) {
    try {
      const text = await (await fetch(`${base}exercises/${relPath}`)).text();
      const slash = relPath.lastIndexOf('/');
      const baseName = slash === -1 ? relPath : relPath.slice(slash + 1);
      const folder = slash === -1 ? null : relPath.slice(0, slash);
      sets.push({ ...parseExerciseYaml(text, baseName), folder });
    } catch (err) {
      console.warn(`Skipping exercise file "${relPath}": ${err.message}`);
    }
  }
  return sets;
}

function readUploadedEntries() {
  try {
    const raw = localStorage.getItem(UPLOADED_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeUploadedEntries(entries) {
  try {
    localStorage.setItem(UPLOADED_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage unavailable (private mode, quota, etc.) — the upload just
    // won't persist across reloads, but still works for this session.
  }
}

/**
 * Persists an uploaded exercise file's raw text to localStorage (upserted
 * by file name), so it reappears under the "Uploaded Exercises" folder on
 * future visits. Stores raw YAML text rather than the parsed result since
 * parsed sets contain Sets (fretboard.frets) that don't round-trip through
 * JSON.
 */
export function saveUploadedExercise(fileName, text) {
  const entries = readUploadedEntries().filter((e) => e.fileName !== fileName);
  entries.push({ fileName, text });
  writeUploadedEntries(entries);
}

/** Loads every exercise set previously saved via saveUploadedExercise. */
export function loadUploadedExerciseSets() {
  const sets = [];
  for (const { fileName, text } of readUploadedEntries()) {
    try {
      sets.push({ ...parseExerciseYaml(text, fileName), folder: UPLOADED_FOLDER });
    } catch (err) {
      console.warn(`Skipping stored exercise "${fileName}": ${err.message}`);
    }
  }
  return sets;
}
