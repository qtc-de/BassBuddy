import { ref, shallowRef, computed, watch } from 'vue';
import {
  loadBuiltInExerciseSets,
  loadUploadedExerciseSets,
  saveUploadedExercise,
  parseExerciseYaml,
  UPLOADED_FOLDER,
} from '../lib/exercises.js';
import { findFretPositionsForPitchClass } from '../lib/notes.js';

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
    return raw.randomCount ? { ...raw, notes: randomizedNotes.value } : raw;
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
  let wrongMarkerSeq = 0;

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
  // Matched by pitch class (any octave), not the exact octave played: a
  // note scores correct regardless of octave, so restricting the
  // highlight to only that one specific octave's positions could leave a
  // correctly-scored note with nowhere valid to show inside a narrow
  // fretboard window.
  function relevantPositions(name) {
    const frets = activeFrets.value;
    const positions = findFretPositionsForPitchClass(name);
    return frets == null ? positions : positions.filter((p) => frets.has(p.fret));
  }

  function markCorrect(name) {
    const next = new Set(correctPositions.value);
    for (const p of relevantPositions(name)) next.add(`${p.stringIndex}-${p.fret}`);
    correctPositions.value = next;
  }

  function markWrong(name) {
    const id = ++wrongMarkerSeq;
    const newMarkers = relevantPositions(name).map((p) => ({ id, stringIndex: p.stringIndex, fret: p.fret }));
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
    if (exercise.ordered) {
      const expected = exercise.notes[sequenceIndex.value];
      if (noteInfo.name === expected) {
        markCorrect(noteInfo.name);
        sequenceIndex.value += 1;
        justCompleted = sequenceIndex.value >= exercise.notes.length;
      } else {
        markWrong(noteInfo.name);
      }
    } else {
      const remaining = remainingCounts.value.get(noteInfo.name) || 0;
      if (remaining > 0) {
        const counts = new Map(remainingCounts.value);
        counts.set(noteInfo.name, remaining - 1);
        remainingCounts.value = counts;
        markCorrect(noteInfo.name);
        justCompleted = [...counts.values()].every((c) => c === 0);
      } else {
        markWrong(noteInfo.name);
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
    uploadError,
    loadAll,
    importFile,
    startSet,
    restartExercise,
    restartSet,
    handleNoteOnset,
  };
}
