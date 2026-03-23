export function isTauriRuntime() {
  if (typeof window === 'undefined') return false;
  return !!(window.__TAURI_INTERNALS__ || window.__TAURI__ || window.tauriAPI);
}
