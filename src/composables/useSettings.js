import { ref, watch } from 'vue';

const STORAGE_KEY = 'bassbuddy:showNoteNames';

function readStoredShowNoteNames() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

const showNoteNames = ref(readStoredShowNoteNames());

watch(showNoteNames, (value) => {
  try {
    localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // Storage unavailable (private mode, etc.) — setting just won't persist.
  }
});

/** Shared, localStorage-persisted app settings. */
export function useSettings() {
  return { showNoteNames };
}
