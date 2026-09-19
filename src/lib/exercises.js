import { load as loadYaml } from 'js-yaml';
import { FRET_COUNT } from './notes.js';

const FLAT_TO_SHARP = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };
const VALID_NOTES = new Set(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']);

/** Virtual folder name shown for exercise sets imported from disk. */
export const UPLOADED_FOLDER = 'Uploaded Exercises';

const UPLOADED_STORAGE_KEY = 'bassbuddy:uploadedExercises';

function normalizeNote(raw, context) {
  const cleaned = String(raw).trim();
  const combined = cleaned.charAt(0).toUpperCase() + cleaned.slice(1).toLowerCase();
  const sharp = FLAT_TO_SHARP[combined] || combined;
  if (!VALID_NOTES.has(sharp)) {
    throw new Error(`${context}: invalid note "${raw}"`);
  }
  return sharp;
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
  const res = await fetch('/exercises/manifest.json');
  if (!res.ok) return [];
  const { files } = await res.json();

  const sets = [];
  for (const relPath of files) {
    try {
      const text = await (await fetch(`/exercises/${relPath}`)).text();
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
