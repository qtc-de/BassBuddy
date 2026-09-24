import { ref, shallowRef, computed, watch } from 'vue';
import {
  loadBuiltInExerciseSets,
  loadUploadedExerciseSets,
  saveUploadedExercise,
  parseExerciseYaml,
  UPLOADED_FOLDER,
} from '../lib/exercises.js';
import { findFretPositions, findFretPositionsForPitchClass, noteSpecMatches, parseNoteSpec } from '../lib/notes.js';

const WRONG_MARKER_TTL_MS = 700;
const AUTO_ADVANCE_DELAY_MS = 2000; // time to see "exercise complete" before moving on

function shuffled(n) {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** Draws `count` true-random notes from `pool`, avoiding back-to-back repeats. */
function randomNotesFrom(pool, count) {
  const notes = [];
  for (let i = 0; i < count; i++) {
    let choice = pool[Math.floor(Math.random() * pool.length)];
    let attempts = 0;
    while (pool.length > 1 && choice === notes[notes.length - 1] && attempts < 20) {
      choice = pool[Math.floor(Math.random() * pool.length)];
      attempts++;
    }
    notes.push(choice);
  }
  return notes;
}

export function useExercises() {
  const sets = shallowRef([]);
  const selectedSetIndex = ref(null); // null = free play, otherwise index into sets
  const sessionOrder = ref([]); // exercise indices within the selected set, in play order
  const sessionPosition = ref(0); // pointer into sessionOrder
  const setComplete = ref(false);
  const uploadError = ref(null);
  let advanceTimeoutId = null;

  const currentSet = computed(() => (selectedSetIndex.value != null ? sets.value[selectedSetIndex.value] : null));

  // Sets grouped by their folder (null = root, i.e. no subfolder) for the
  // exercise picker: root-level sets first, then subfolders alphabetically,
  // with the "Uploaded Exercises" virtual folder always pinned last.
  const groupedSets = computed(() => {
    const groups = new Map();
    sets.value.forEach((set, index) => {
      const key = set.folder ?? null;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ index, set });
    });

    const keys = [...groups.keys()].sort((a, b) => {
      if (a === b) return 0;
      if (a === null) return -1;
      if (b === null) return 1;
      if (a === UPLOADED_FOLDER) return 1;
      if (b === UPLOADED_FOLDER) return -1;
      return a.localeCompare(b);
    });

    return keys.map((folder) => ({ folder, items: groups.get(folder) }));
  });

  // The exercise as authored (stable — only changes when navigating to a
  // different exercise). For randomNotes exercises, the actual note
  // sequence to play is generated fresh per attempt (see randomizedNotes
  // below) rather than read directly off this object.
  const rawExercise = computed(() => {
    const set = currentSet.value;
    if (!set || setComplete.value) return null;
    const exerciseIndex = sessionOrder.value[sessionPosition.value];
    return set.exercises[exerciseIndex] ?? null;
  });

  const randomizedNotes = ref([]);

  const currentExercise = computed(() => {
    const raw = rawExercise.value;
    if (!raw) return null;
    if (!raw.randomCount) return raw;
    // {{note}} in the description is substituted with the actual first
    // note of this attempt's random draw — the only way a static YAML
    // description can correctly name "the starting note" when the real
    // sequence is generated fresh every time (see randomNotesFrom).
    const first = randomizedNotes.value[0];
    const description = first != null ? raw.description.replaceAll('{{note}}', first) : raw.description;
    return { ...raw, notes: randomizedNotes.value, description };
  });

  const activeFrets = computed(() => currentExercise.value?.fretboard?.frets ?? null);

  const exerciseNumber = computed(() => sessionPosition.value + 1);
  const exerciseCount = computed(() => sessionOrder.value.length);

  // Per-exercise progress state, rebuilt whenever the current exercise changes.
  const correctPositions = ref(new Set()); // "stringIndex-fret" keys, persist until exercise changes
  const wrongMarkers = ref([]); // [{ id, stringIndex, fret }] transient
  const sequenceIndex = ref(0);
  const remainingCounts = ref(new Map());
  const isComplete = ref(false);
  const completionOutcome = ref(null); // 'success' | 'failure' | null, only meaningful once isComplete
  const successCount = ref(0);
  const failureCount = ref(0);
  let wrongMarkerSeq = 0;

  /** success_on/failure_on exercises are freeform: any note in the pool
   *  scores, any number of times, instead of the ordered/remainingCounts
   *  logic that requires each note exactly once (in or out of sequence). */
  function isScoringMode(exercise) {
    return exercise != null && (exercise.successOn != null || exercise.failureOn != null);
  }

  function clearAdvanceTimeout() {
    if (advanceTimeoutId != null) {
      clearTimeout(advanceTimeoutId);
      advanceTimeoutId = null;
    }
  }

  function resetProgress() {
    const raw = rawExercise.value;
    if (raw?.randomCount) {
      randomizedNotes.value = randomNotesFrom(raw.notes, raw.randomCount);
    }
    correctPositions.value = new Set();
    wrongMarkers.value = [];
    sequenceIndex.value = 0;
    isComplete.value = false;
    completionOutcome.value = null;
    successCount.value = 0;
    failureCount.value = 0;
    const counts = new Map();
    if (currentExercise.value) {
      for (const n of currentExercise.value.notes) {
        counts.set(n, (counts.get(n) || 0) + 1);
      }
    }
    remainingCounts.value = counts;
  }

  // Watch rawExercise (not currentExercise): currentExercise's `notes`
  // array is itself replaced by resetProgress for randomNotes exercises,
  // so watching it would re-trigger resetProgress on every regeneration.
  watch(rawExercise, resetProgress, { immediate: true });

  function startSet(index) {
    clearAdvanceTimeout();
    selectedSetIndex.value = index;
    setComplete.value = false;
    sessionPosition.value = 0;
    if (index == null) {
      sessionOrder.value = [];
      return;
    }
    const set = sets.value[index];
    sessionOrder.value = set.ordered ? set.exercises.map((_, i) => i) : shuffled(set.exercises.length);
  }

  function advance() {
    if (sessionPosition.value + 1 >= sessionOrder.value.length) {
      setComplete.value = true;
    } else {
      sessionPosition.value += 1;
    }
  }

  /** Redo the current exercise instead of waiting for/after the auto-advance. */
  function restartExercise() {
    clearAdvanceTimeout();
    resetProgress();
  }

  /** Start the current set over from the beginning (re-shuffling if unordered). */
  function restartSet() {
    if (selectedSetIndex.value != null) startSet(selectedSetIndex.value);
  }

  // Only mark positions within the exercise's relevant fretboard section
  // (if it has one) — a correct/wrong note shouldn't light up a dimmed,
  // out-of-scope fret just because the same pitch class also lives there.
  //
  // Prefer the EXACT octave actually played (e.g. playing G2 highlights
  // only G2, not G1 too, even if both sit inside the active window — one
  // fret window can span more than an octave across the 4 strings since
  // each is tuned a fourth apart). Only fall back to matching the pitch
  // class in any octave if that exact octave has no position at all
  // inside the window — otherwise a correctly-scored note could end up
  // with nowhere valid to show.
  function relevantPositions(midi, name) {
    const frets = activeFrets.value;
    const exact = findFretPositions(midi);
    const exactInWindow = frets == null ? exact : exact.filter((p) => frets.has(p.fret));
    if (exactInWindow.length > 0) return exactInWindow;

    const anyOctave = findFretPositionsForPitchClass(name);
    return frets == null ? anyOctave : anyOctave.filter((p) => frets.has(p.fret));
  }

  function markCorrect(midi, name) {
    const next = new Set(correctPositions.value);
    for (const p of relevantPositions(midi, name)) next.add(`${p.stringIndex}-${p.fret}`);
    correctPositions.value = next;
  }

  function markWrong(midi, name) {
    const id = ++wrongMarkerSeq;
    const newMarkers = relevantPositions(midi, name).map((p) => ({ id, stringIndex: p.stringIndex, fret: p.fret }));
    wrongMarkers.value = [...wrongMarkers.value, ...newMarkers];
    setTimeout(() => {
      wrongMarkers.value = wrongMarkers.value.filter((m) => m.id !== id);
    }, WRONG_MARKER_TTL_MS);
  }

  /** Feed a freshly-detected (onset) note into the active exercise. No-op in free play. */
  function handleNoteOnset(noteInfo) {
    const exercise = currentExercise.value;
    if (!exercise || isComplete.value || !noteInfo) return;

    let justCompleted = false;
    if (isScoringMode(exercise)) {
      const matched = exercise.notes.some((spec) => noteSpecMatches(spec, noteInfo));
      if (matched) {
        markCorrect(noteInfo.midi, noteInfo.name);
        successCount.value += 1;
      } else {
        markWrong(noteInfo.midi, noteInfo.name);
        failureCount.value += 1;
      }

      if (exercise.successOn != null && successCount.value >= exercise.successOn) {
        justCompleted = true;
        completionOutcome.value = 'success';
      } else if (exercise.failureOn != null && failureCount.value >= exercise.failureOn) {
        justCompleted = true;
        completionOutcome.value = 'failure';
      }
    } else if (exercise.ordered) {
      const expected = exercise.notes[sequenceIndex.value];
      if (noteSpecMatches(expected, noteInfo)) {
        markCorrect(noteInfo.midi, noteInfo.name);
        sequenceIndex.value += 1;
        justCompleted = sequenceIndex.value >= exercise.notes.length;
      } else {
        markWrong(noteInfo.midi, noteInfo.name);
      }
    } else {
      // Match by scanning remainingCounts's specs rather than a direct
      // Map.get(noteInfo.name): a spec can pin an octave (e.g. "G2"),
      // which noteInfo.name (pitch class only) can never equal directly.
      // An octave-specific spec is the tighter match, so it's preferred
      // over a same-pitch-class-any-octave spec when both would match.
      let matchKey = null;
      for (const [spec, count] of remainingCounts.value) {
        if (count <= 0 || !noteSpecMatches(spec, noteInfo)) continue;
        if (parseNoteSpec(spec).octave != null) {
          matchKey = spec;
          break;
        }
        if (matchKey == null) matchKey = spec;
      }

      if (matchKey != null) {
        const counts = new Map(remainingCounts.value);
        counts.set(matchKey, counts.get(matchKey) - 1);
        remainingCounts.value = counts;
        markCorrect(noteInfo.midi, noteInfo.name);
        justCompleted = [...counts.values()].every((c) => c === 0);
      } else {
        markWrong(noteInfo.midi, noteInfo.name);
      }
    }

    if (justCompleted) {
      isComplete.value = true;
      clearAdvanceTimeout();
      advanceTimeoutId = setTimeout(() => {
        advanceTimeoutId = null;
        advance();
      }, AUTO_ADVANCE_DELAY_MS);
    }
  }

  /** Loads built-in exercise sets (from public/exercises) plus any
   *  previously-uploaded ones persisted in localStorage. */
  async function loadAll() {
    const builtIns = await loadBuiltInExerciseSets();
    const uploaded = loadUploadedExerciseSets();
    sets.value = [...builtIns, ...uploaded];
  }

  async function importFile(file) {
    uploadError.value = null;
    try {
      const text = await file.text();
      const parsed = { ...parseExerciseYaml(text, file.name), folder: UPLOADED_FOLDER };
      saveUploadedExercise(file.name, text);
      sets.value = [...sets.value, parsed];
      startSet(sets.value.length - 1);
    } catch (err) {
      uploadError.value = err.message;
    }
  }

  return {
    sets,
    groupedSets,
    selectedSetIndex,
    currentSet,
    currentExercise,
    exerciseNumber,
    exerciseCount,
    setComplete,
    activeFrets,
    correctPositions,
    wrongMarkers,
    sequenceIndex,
    remainingCounts,
    isComplete,
    completionOutcome,
    successCount,
    failureCount,
    uploadError,
    loadAll,
    importFile,
    startSet,
    restartExercise,
    restartSet,
    handleNoteOnset,
  };
}
