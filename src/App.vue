<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import Fretboard from './components/Fretboard.vue';
import {
  usePitchDetector,
  MIN_NOISE_GATE,
  MAX_NOISE_GATE,
  MIN_GAIN,
  MAX_GAIN,
} from './composables/usePitchDetector.js';
import { useExercises } from './composables/useExercises.js';
import { useSettings } from './composables/useSettings.js';
import { ALGORITHMS } from './lib/algorithms.js';
import { playNotes, unlockAudio, playbackError } from './lib/samples.js';

const {
  isListening,
  error,
  frequency,
  note,
  confirmedNote,
  algorithm,
  noiseGate,
  gain,
  inputDevices,
  selectedDeviceId,
  start,
  stop,
} = usePitchDetector();
const exercises = useExercises();
const { showNoteNames } = useSettings();

onMounted(() => exercises.loadAll());

// Feed only note *onsets* (a change to a new pitch) into the exercise
// engine — watching confirmedNote (not the faster-updating `note`, used
// for the live display) so a brief attack-transient octave blip can't get
// scored before the pitch actually settles.
watch(confirmedNote, (newNote, oldNote) => {
  if (newNote && (!oldNote || oldNote.midi !== newNote.midi)) {
    exercises.handleNoteOnset(newNote);
  }
});

function onExerciseFileChange(event) {
  const file = event.target.files[0];
  if (file) exercises.importFile(file);
  event.target.value = '';
}

const pickerOpen = ref(false);
const pickerButtonRef = ref(null);
const pickerPanelRef = ref(null);
const pickerPanelStyle = ref({});

const selectedSetLabel = computed(() => exercises.currentSet.value?.name ?? 'Free Play');

// The panel's on-screen position can't be pinned with plain CSS: the app
// is a centered column, so the button isn't reliably near either edge —
// centering the panel on the button overflows the left edge when the
// button sits near the left, and anchoring to the button's left edge
// overflows the right edge whenever the panel is wider than the space
// remaining to the right of the button (e.g. tablet widths, where the
// multi-column layout makes the panel quite wide). So measure both the
// button and the (already-rendered, off-screen-safe) panel after it
// opens, and clamp its position to stay fully inside the viewport.
const PICKER_MARGIN = 12; // px gap kept from the viewport edge

function positionPickerPanel() {
  const btn = pickerButtonRef.value;
  const panel = pickerPanelRef.value;
  if (!btn || !panel) return;
  const btnRect = btn.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  // Prefer centering the (usually much wider) panel on the button, rather
  // than lining up their left edges — the latter looked lopsided, pinned
  // to the right of the button instead of around it. Only fall back off
  // that centered position when it would push either edge past the
  // viewport.
  const maxLeft = window.innerWidth - panelRect.width - PICKER_MARGIN;
  const centered = btnRect.left + btnRect.width / 2 - panelRect.width / 2;
  const left = Math.max(PICKER_MARGIN, Math.min(centered, maxLeft));
  const top = btnRect.bottom + 8;
  pickerPanelStyle.value = { left: `${left}px`, top: `${top}px` };
}

watch(pickerOpen, (open) => {
  if (open) {
    nextTick(positionPickerPanel);
    window.addEventListener('resize', positionPickerPanel);
  } else {
    window.removeEventListener('resize', positionPickerPanel);
  }
});

onUnmounted(() => window.removeEventListener('resize', positionPickerPanel));

function togglePicker() {
  unlockAudio(); // opening the picker is likely the first real tap of the session
  pickerOpen.value = !pickerOpen.value;
}

function selectSet(index) {
  unlockAudio();
  exercises.startSet(index);
  pickerOpen.value = false;
}

// "Play what you hear" exercises: synthesize the exercise's notes as audio
// instead of showing them, so the player has to recall/find them by ear.
// `manual` is true only for the ▶ button's own click — a failure there
// surfaces an on-screen error, but the same silent-autoplay-block failure
// on exercise start/restart (an unattended setTimeout, not a tap) doesn't.
function replayCurrentSequence(manual = false) {
  unlockAudio();
  const exercise = exercises.currentExercise.value;
  if (!exercise) return;
  playNotes(exercise.notes, { manual });
}

function isHearMode(exercise) {
  return exercise?.mode === 'hear';
}

// Auto-play whenever a *new* hear-mode exercise becomes current (initial
// selection, or auto-advancing to the next one in a set).
watch(
  () => exercises.currentExercise.value,
  (exercise) => {
    if (isHearMode(exercise)) {
      setTimeout(replayCurrentSequence, 400);
    }
  }
);

// Restarting doesn't change the exercise reference (same notes, reset
// progress), so the watch above won't refire — replay explicitly instead.
function restartExercise() {
  exercises.restartExercise();
  if (isHearMode(exercises.currentExercise.value)) {
    setTimeout(replayCurrentSequence, 300);
  }
}

function restartSet() {
  exercises.restartSet();
  if (isHearMode(exercises.currentExercise.value)) {
    setTimeout(replayCurrentSequence, 300);
  }
}

function isScoringMode(exercise) {
  return exercise != null && (exercise.successOn != null || exercise.failureOn != null);
}

const progressText = computed(() => {
  const exercise = exercises.currentExercise.value;
  if (!exercise) return '';
  if (isScoringMode(exercise)) {
    const parts = [];
    if (exercise.successOn != null) parts.push(`${exercises.successCount.value} / ${exercise.successOn} correct`);
    if (exercise.failureOn != null) parts.push(`${exercises.failureCount.value} / ${exercise.failureOn} mistakes`);
    return parts.join(' · ');
  }
  const total = exercise.notes.length;
  const done = exercise.ordered
    ? exercises.sequenceIndex.value
    : total - [...exercises.remainingCounts.value.values()].reduce((a, b) => a + b, 0);
  return `${done} / ${total}`;
});

const nextNoteHint = computed(() => {
  const exercise = exercises.currentExercise.value;
  if (!exercise || isScoringMode(exercise) || !exercise.ordered || exercise.mode === 'hear' || exercises.isComplete.value)
    return '';
  return exercise.notes[exercises.sequenceIndex.value];
});

const activeAlgorithm = computed(() => ALGORITHMS.find((a) => a.id === algorithm.value));

const centsOffset = computed(() => (note.value ? Math.round(note.value.cents) : 0));
const needleStyle = computed(() => ({
  transform: `translateX(${centsOffset.value}%)`,
}));

function toggleListening() {
  unlockAudio();
  if (isListening.value) {
    stop();
  } else {
    start();
  }
}
</script>

<template>
  <main class="app">
    <h1>BassBuddy</h1>
    <p class="subtitle">Play a note on your bass — watch it land on the neck.</p>

    <div class="controls">
      <button class="mic-button" :class="{ active: isListening }" @click="toggleListening">
        {{ isListening ? 'Stop Listening' : 'Start Listening' }}
      </button>

      <label v-if="inputDevices.length > 1" class="algo-select">
        <span>Microphone</span>
        <select v-model="selectedDeviceId">
          <option value="">Default</option>
          <option v-for="device in inputDevices" :key="device.deviceId" :value="device.deviceId">
            {{ device.label }}
          </option>
        </select>
      </label>

      <label class="algo-select">
        <span>Algorithm</span>
        <select v-model.number="algorithm">
          <option v-for="algo in ALGORITHMS" :key="algo.id" :value="algo.id">{{ algo.name }}</option>
        </select>
      </label>

      <label class="checkbox-toggle">
        <input type="checkbox" v-model="showNoteNames" />
        <span>Show note names</span>
      </label>

      <label class="range-slider" title="Raise to ignore quiet string noise; lower to catch soft notes.">
        <span>Noise Gate</span>
        <input
          type="range"
          :min="MIN_NOISE_GATE"
          :max="MAX_NOISE_GATE"
          step="0.001"
          v-model.number="noiseGate"
        />
        <span class="range-value">{{ noiseGate.toFixed(3) }}</span>
      </label>

      <label
        class="range-slider"
        title="Digitally boosts a weak input (phone mic, low-output interfaces) before detection. Too much amplifies background noise too."
      >
        <span>Gain</span>
        <input type="range" :min="MIN_GAIN" :max="MAX_GAIN" step="0.5" v-model.number="gain" />
        <span class="range-value">×{{ gain.toFixed(1) }}</span>
      </label>
    </div>

    <p v-if="activeAlgorithm" class="algo-description">{{ activeAlgorithm.description }}</p>
    <p v-if="error" class="error">Mic error: {{ error }}</p>

    <div class="controls">
      <div class="exercise-picker">
        <button ref="pickerButtonRef" class="exercise-picker-button" @click="togglePicker">
          <span>{{ selectedSetLabel }}</span>
          <span class="caret">▾</span>
        </button>

        <template v-if="pickerOpen">
          <div class="picker-backdrop" @click="pickerOpen = false" />
          <div ref="pickerPanelRef" class="picker-panel" :style="pickerPanelStyle">
            <button
              class="picker-item picker-item-freeplay"
              :class="{ active: exercises.selectedSetIndex.value == null }"
              @click="selectSet(null)"
            >
              Free Play
            </button>

            <p v-if="exercises.sets.value.length === 0" class="picker-empty">No exercise sets yet.</p>

            <div v-for="group in exercises.groupedSets.value" :key="group.folder ?? '__root'" class="picker-group">
              <div v-if="group.folder" class="picker-group-label">{{ group.folder }}</div>
              <button
                v-for="item in group.items"
                :key="item.index"
                class="picker-item"
                :class="{ active: exercises.selectedSetIndex.value === item.index }"
                @click="selectSet(item.index)"
              >
                {{ item.set.name }}
                <span class="picker-item-count">
                  ({{ item.set.exercises.length }} exercise{{ item.set.exercises.length === 1 ? '' : 's' }})
                </span>
              </button>
            </div>
          </div>
        </template>
      </div>

      <label class="upload-button">
        Import Exercise Set…
        <input type="file" accept=".yaml,.yml" @change="onExerciseFileChange" />
      </label>
    </div>

    <p v-if="exercises.uploadError.value" class="error">{{ exercises.uploadError.value }}</p>
    <p v-if="playbackError" class="error">{{ playbackError }}</p>

    <section v-if="exercises.setComplete.value" class="exercise-panel">
      <div class="panel-icons">
        <button class="icon-button restart" title="Restart set" @click="restartSet">↻</button>
      </div>
      <p class="exercise-set-progress">Set Complete</p>
      <p class="exercise-name">
        {{ exercises.currentSet.value?.name }}
        <span class="check-icon">✓</span>
      </p>
    </section>

    <section v-else-if="exercises.currentExercise.value" class="exercise-panel">
      <div class="panel-icons">
        <button
          v-if="exercises.currentExercise.value.mode === 'hear'"
          class="icon-button"
          title="Replay"
          @click="replayCurrentSequence(true)"
        >
          ▶
        </button>
        <button class="icon-button restart" title="Restart exercise" @click="restartExercise">↻</button>
      </div>
      <p class="exercise-set-progress">
        Exercise {{ exercises.exerciseNumber.value }} of {{ exercises.exerciseCount.value }}
        <span v-if="exercises.currentSet.value">— {{ exercises.currentSet.value.name }}</span>
      </p>
      <p class="exercise-name">
        {{ exercises.currentExercise.value.name }}
        <span v-if="exercises.isComplete.value" class="check-icon" :class="{ 'fail-icon': exercises.completionOutcome.value === 'failure' }">
          {{ exercises.completionOutcome.value === 'failure' ? '✗' : '✓' }}
        </span>
      </p>
      <p v-if="exercises.currentExercise.value.description" class="exercise-description">
        {{ exercises.currentExercise.value.description }}
      </p>
      <p class="exercise-meta">
        {{ isScoringMode(exercises.currentExercise.value) ? 'Free play' : (exercises.currentExercise.value.ordered ? 'Play in order' : 'Play in any order') }}
        · {{ isScoringMode(exercises.currentExercise.value) ? '' : 'Progress: ' }}{{ progressText }}
        <span v-if="exercises.currentExercise.value.mode === 'hear'">· Play what you hear</span>
        <span v-if="nextNoteHint">· Next: {{ nextNoteHint }}</span>
      </p>
    </section>

    <Fretboard
      :midi="exercises.currentExercise.value ? null : note ? note.midi : null"
      :active-frets="exercises.activeFrets.value"
      :correct-positions="exercises.correctPositions.value"
      :wrong-positions="exercises.wrongMarkers.value"
      :show-note-names="showNoteNames"
    />

    <section class="readout">
      <div class="note-display">
        <span class="note-name">{{ note ? note.name : '–' }}</span>
        <span class="note-octave">{{ note ? note.octave : '' }}</span>
      </div>
      <div class="freq-display">{{ frequency > 0 ? frequency.toFixed(1) + ' Hz' : '—' }}</div>

      <div class="tuner-meter">
        <div class="tuner-track">
          <div class="tuner-center" />
          <div class="tuner-needle" :style="needleStyle" />
        </div>
        <div class="tuner-labels">
          <span>-50c</span>
          <span>in tune</span>
          <span>+50c</span>
        </div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.app {
  max-width: 60rem;
  margin: 0 auto;
  padding: 1.5rem 1rem 2rem;
  text-align: center;
  font-family: system-ui, sans-serif;
  color: #eee8dc;
}

h1 {
  margin-bottom: 0.25rem;
  letter-spacing: 0.05em;
}

.subtitle {
  color: #a89f8f;
  margin-top: 0;
  margin-bottom: 1rem;
}

.controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 1rem;
}

.algo-select {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  color: #a89f8f;
}

.algo-select select {
  font-size: 0.95rem;
  padding: 0.4rem 0.6rem;
  border-radius: 6px;
  border: 1px solid #8a7554;
  background: #2a1e12;
  color: #eee8dc;
}

.exercise-picker {
  position: relative;
}

.exercise-picker-button {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.95rem;
  padding: 0.55rem 1rem;
  border-radius: 6px;
  border: 1px solid #8a7554;
  background: #2a1e12;
  color: #eee8dc;
  cursor: pointer;
}

.exercise-picker-button .caret {
  font-size: 0.65rem;
  color: #a89f8f;
}

.picker-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
}

.picker-panel {
  /* position: fixed with left/top set inline by positionPickerPanel() in
     the script — plain CSS (centered on the button, or anchored to its
     left edge) can't stay on-screen in every case, since the app is a
     centered column and the button's distance from either viewport edge
     varies with screen width. See positionPickerPanel's comment. */
  position: fixed;
  z-index: 21;
  width: max-content;
  min-width: 16rem;
  max-width: 24rem;
  max-height: 22rem;
  overflow-y: auto;
  padding: 0.5rem;
  border-radius: 10px;
  background: #2a1e12;
  border: 1px solid #4a3722;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
  text-align: left;
}

/* On screens wide enough to spare the room, let the picker grow and lay
   its folders out as side-by-side columns instead of one long vertical
   list. CSS Grid, not multi-column: a height-constrained multicol
   container (column-width + our max-height/overflow-y below) pushes
   overflow into *extra columns going sideways* instead of scrolling — the
   opposite of what we want. Grid keeps the column count fixed to what
   actually fits the container's width and just adds rows (taller, not
   wider) when content overflows, so overflow-y's vertical scrollbar is
   the one that ever kicks in. */
@media (min-width: 640px) {
  .picker-panel {
    /* width: max-content (below) shrink-wraps to content, which would
       otherwise cap this at a single grid column — give it a real width
       here so the grid actually has room to lay out multiple columns. */
    width: min(92vw, 64rem);
    max-width: min(92vw, 64rem);
    max-height: 32rem;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
    align-content: start;
    column-gap: 1rem;
  }

  .picker-item-freeplay,
  .picker-empty {
    grid-column: 1 / -1;
  }
}

.picker-group {
  margin-bottom: 0.5rem;
}

.picker-group-label {
  padding: 0.5rem 0.6rem 0.15rem;
  font-size: 0.7rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #8a7554;
}

.picker-item {
  display: block;
  width: 100%;
  text-align: left;
  padding: 0.45rem 0.6rem;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: #eee8dc;
  font-size: 0.9rem;
  cursor: pointer;
}

.picker-item:hover {
  background: #3b2a1a;
}

.picker-item.active {
  background: #ff5a3c;
  color: #1a1006;
}

.picker-item-count {
  color: #a89f8f;
  font-size: 0.8rem;
}

.picker-item.active .picker-item-count {
  color: #1a1006;
  opacity: 0.75;
}

.picker-empty {
  margin: 0;
  padding: 0.45rem 0.6rem;
  font-size: 0.85rem;
  color: #a89f8f;
}

.checkbox-toggle {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.9rem;
  color: #a89f8f;
  cursor: pointer;
}

.checkbox-toggle input {
  width: 1.05rem;
  height: 1.05rem;
  accent-color: #ff5a3c;
  cursor: pointer;
}

.range-slider {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  color: #a89f8f;
}

.range-slider input[type='range'] {
  width: 7rem;
  accent-color: #ff5a3c;
  cursor: pointer;
}

.range-value {
  min-width: 3ch;
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
  color: #cbb896;
}

.algo-description {
  max-width: 40rem;
  margin: 0.75rem auto;
  font-size: 0.85rem;
  color: #a89f8f;
}

.upload-button {
  position: relative;
  font-size: 0.9rem;
  padding: 0.5rem 1rem;
  border-radius: 6px;
  border: 1px solid #8a7554;
  background: #2a1e12;
  color: #f0d9a8;
  cursor: pointer;
}

.upload-button input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.exercise-panel {
  position: relative;
  max-width: 32rem;
  min-height: 7rem;
  margin: 0.75rem auto;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  background: #2a1e12;
  border: 1px solid #4a3722;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0.35rem;
}

/* Reserve a gutter matching the icon-button's footprint so centered text
   never runs underneath it. */
.exercise-panel p {
  padding-right: 4.5rem;
}

.exercise-set-progress {
  margin: 0;
  font-size: 0.75rem;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: #8a7554;
}

.exercise-name {
  margin: 0;
  font-weight: 700;
  color: #f0d9a8;
}

.exercise-description {
  margin: 0;
  color: #eee8dc;
}

.exercise-meta {
  margin: 0;
  font-size: 0.85rem;
  color: #a89f8f;
}

/* Absolutely positioned so it never affects the panel's flow height —
   restarting/replaying must never shift the fretboard below it. */
.panel-icons {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  display: flex;
  gap: 0.4rem;
}

.icon-button {
  width: 1.75rem;
  height: 1.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.05rem;
  line-height: 1;
  border-radius: 50%;
  border: 1px solid #8a7554;
  background: transparent;
  color: #f0d9a8;
  cursor: pointer;
  transition: background 0.2s, color 0.2s, transform 0.2s;
}

.icon-button:hover {
  background: #f0d9a8;
  color: #1a1006;
}

.icon-button.restart:hover {
  transform: rotate(-40deg);
}

.check-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.1rem;
  height: 1.1rem;
  border-radius: 50%;
  background: #4caf50;
  color: #12250f;
  font-size: 0.7rem;
  font-weight: 700;
  vertical-align: middle;
}

.check-icon.fail-icon {
  background: #e05252;
  color: #2a0a0a;
}

.mic-button {
  font-size: 1rem;
  padding: 0.6rem 1.5rem;
  border-radius: 999px;
  border: 2px solid #f0d9a8;
  background: transparent;
  color: #f0d9a8;
  cursor: pointer;
  transition: background 0.2s, color 0.2s;
}

.mic-button.active {
  background: #ff5a3c;
  border-color: #ff5a3c;
  color: #1a1006;
}

.error {
  color: #ff8a70;
}

.readout {
  margin: 1rem 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.note-display {
  font-size: 4rem;
  font-weight: 800;
  line-height: 1;
}

.note-octave {
  font-size: 2rem;
  vertical-align: super;
  color: #a89f8f;
}

.freq-display {
  font-size: 1.1rem;
  color: #a89f8f;
  min-height: 1.4em;
}

.tuner-meter {
  width: 16rem;
}

.tuner-track {
  position: relative;
  height: 0.6rem;
  background: #2a1e12;
  border-radius: 999px;
  overflow: hidden;
}

.tuner-center {
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 2px;
  background: #f0d9a8;
}

.tuner-needle {
  position: absolute;
  left: 50%;
  top: 0;
  bottom: 0;
  width: 4px;
  background: #ff5a3c;
  transition: transform 0.1s linear;
}

.tuner-labels {
  display: flex;
  justify-content: space-between;
  font-size: 0.7rem;
  color: #a89f8f;
  margin-top: 0.25rem;
}

/* Phone-sized screens: bigger tap targets, a hero note display that
   doesn't dominate the viewport. Desktop sizing above is untouched. */
@media (max-width: 480px) {
  .app {
    padding: 1.5rem 1rem 2rem;
  }

  .note-display {
    font-size: 3rem;
  }

  .note-octave {
    font-size: 1.5rem;
  }

  .mic-button,
  .upload-button,
  .restart-button {
    padding-top: 0.75rem;
    padding-bottom: 0.75rem;
  }

  .algo-select select {
    padding: 0.55rem 0.6rem;
  }

  .checkbox-toggle {
    padding: 0.4rem 0;
  }
}
</style>
