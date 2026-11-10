// On-device persistence. Everything stays in the phone's local storage;
// nothing is sent to a server.
const KEY = 'utility-mapper/v1';

const defaults = () => ({
  features: [],
  settings: { unit: 'ft', base: 'street', hidden: [] },
});

export function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY));
    if (!raw || !Array.isArray(raw.features)) return defaults();
    return { ...defaults(), ...raw, settings: { ...defaults().settings, ...raw.settings } };
  } catch {
    return defaults();
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function makeId() {
  return `u_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
