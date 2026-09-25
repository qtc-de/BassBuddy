<script setup>
import { computed } from 'vue';
import { BASS_STRINGS, FRET_COUNT, findFretPositions, noteNameAtFret } from '../lib/notes.js';

const props = defineProps({
  midi: { type: Number, default: null },
  activeFrets: { type: Set, default: null }, // null = whole neck relevant
  correctPositions: { type: Set, default: () => new Set() }, // "stringIndex-fret" keys
  wrongPositions: { type: Array, default: () => [] }, // [{ stringIndex, fret }]
  repeatPositions: { type: Array, default: () => [] }, // [{ id, stringIndex, fret }], transient
  showNoteNames: { type: Boolean, default: false },
});

const markerFrets = [3, 5, 7, 9, 12, 15];

const positions = computed(() => (props.midi == null ? [] : findFretPositions(props.midi)));

function isActive(stringIndex, fret) {
  return positions.value.some((p) => p.stringIndex === stringIndex && p.fret === fret);
}

function isDimmed(fret) {
  return props.activeFrets != null && !props.activeFrets.has(fret);
}

function isCorrect(stringIndex, fret) {
  return props.correctPositions.has(`${stringIndex}-${fret}`);
}

const wrongSet = computed(() => new Set(props.wrongPositions.map((p) => `${p.stringIndex}-${p.fret}`)));

function isWrong(stringIndex, fret) {
  return wrongSet.value.has(`${stringIndex}-${fret}`);
}

// Keyed by id (not just position) so each new repeat at the same spot gets
// a fresh DOM node — a mere class toggle wouldn't restart the CSS
// animation if a second repeat lands before the first one's ring finishes.
const repeatMap = computed(() => {
  const m = new Map();
  for (const marker of props.repeatPositions) m.set(`${marker.stringIndex}-${marker.fret}`, marker);
  return m;
});

function repeatMarkerAt(stringIndex, fret) {
  return repeatMap.value.get(`${stringIndex}-${fret}`) ?? null;
}

const frets = Array.from({ length: FRET_COUNT + 1 }, (_, i) => i);
</script>

<template>
  <div class="fretboard">
    <div class="fret-numbers">
      <span class="nut-spacer" />
      <span
        v-for="fret in frets"
        :key="fret"
        class="fret-number"
        :class="{ marker: markerFrets.includes(fret), dim: isDimmed(fret) }"
      >
        {{ fret }}
      </span>
    </div>

    <div class="strings">
      <div v-for="(string, stringIndex) in BASS_STRINGS" :key="string.name" class="string-row">
        <span class="string-label">{{ string.name }}</span>
        <div class="cells">
          <div v-for="fret in frets" :key="fret" class="cell" :class="{ nut: fret === 0, dim: isDimmed(fret) }">
            <div class="string-line" />
            <div v-if="isCorrect(stringIndex, fret)" class="note-dot correct">
              {{ showNoteNames ? noteNameAtFret(stringIndex, fret) : '' }}
              <div
                v-if="repeatMarkerAt(stringIndex, fret)"
                :key="repeatMarkerAt(stringIndex, fret).id"
                class="repeat-ring"
              />
            </div>
            <div v-else-if="isWrong(stringIndex, fret)" class="note-dot wrong">
              {{ showNoteNames ? noteNameAtFret(stringIndex, fret) : '' }}
            </div>
            <div v-else-if="isActive(stringIndex, fret)" class="note-dot live">
              {{ showNoteNames ? noteNameAtFret(stringIndex, fret) : '' }}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fretboard {
  margin-top: 1rem;
  overflow-x: auto;
  background: #3b2a1a;
  border-radius: 8px;
  padding: 1rem;
  box-shadow: inset 0 0 20px rgba(0, 0, 0, 0.4);
}

.fret-numbers {
  display: flex;
  margin-bottom: 0.25rem;
}

.nut-spacer {
  width: 2.5rem;
  flex-shrink: 0;
}

.fret-number {
  width: 3rem;
  flex-shrink: 0;
  text-align: center;
  font-size: 0.75rem;
  color: #cbb896;
}

.fret-number.marker {
  color: #f0d9a8;
  font-weight: 700;
}

.strings {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.string-row {
  display: flex;
  align-items: center;
}

.string-label {
  width: 2.5rem;
  flex-shrink: 0;
  text-align: center;
  font-weight: 700;
  color: #f0d9a8;
}

.cells {
  display: flex;
}

.cell {
  width: 3rem;
  height: 2.5rem;
  flex-shrink: 0;
  position: relative;
  border-right: 2px solid #8a7554;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cell.nut {
  border-right: 4px solid #f0d9a8;
}

.cell.dim {
  opacity: 0.35;
}

.fret-number.dim {
  opacity: 0.35;
}

.string-line {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 2px;
  background: #c8b28a;
  transform: translateY(-50%);
}

.note-dot {
  position: relative;
  z-index: 1;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 50%;
  animation: pulse 0.6s ease-out;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.65rem;
  font-weight: 700;
  color: rgba(0, 0, 0, 0.75);
  line-height: 1;
}

.note-dot.live {
  background: #ff5a3c;
  box-shadow: 0 0 12px rgba(255, 90, 60, 0.9);
}

.note-dot.correct {
  background: #4caf50;
  box-shadow: 0 0 12px rgba(76, 175, 80, 0.9);
}

.note-dot.wrong {
  background: #e53935;
  box-shadow: 0 0 12px rgba(229, 57, 53, 0.9);
}

@keyframes pulse {
  from {
    transform: scale(1.4);
    opacity: 0.4;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

/* Brief bright ring around an already-correct dot when its note is
   played again — the dot itself stays steady green, so without this a
   repeat hit was registered (another success point, etc.) with no
   visible feedback at all. */
.repeat-ring {
  position: absolute;
  inset: -0.35rem;
  border-radius: 50%;
  border: 2px solid #fff;
  pointer-events: none;
  animation: repeat-ring 0.9s ease-out forwards;
}

@keyframes repeat-ring {
  from {
    transform: scale(0.85);
    opacity: 1;
    box-shadow: 0 0 10px rgba(255, 255, 255, 0.9);
  }
  to {
    transform: scale(1.5);
    opacity: 0;
    box-shadow: 0 0 0 rgba(255, 255, 255, 0);
  }
}

/* Smaller cells on phones show more of the neck before the built-in
   horizontal scroll (.fretboard already has overflow-x: auto) kicks in.
   Desktop sizing above is untouched. */
@media (max-width: 480px) {
  .nut-spacer,
  .string-label {
    width: 2rem;
  }

  .fret-number {
    width: 2.4rem;
    font-size: 0.7rem;
  }

  .cell {
    width: 2.4rem;
    height: 2.2rem;
  }

  .note-dot {
    width: 1.5rem;
    height: 1.5rem;
    font-size: 0.6rem;
  }
}
</style>
