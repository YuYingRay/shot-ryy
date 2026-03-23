import { describe, expect, it } from 'vitest';
import { isTauriRuntime } from '../../../utils/platform/isTauri';

describe('isTauriRuntime', () => {
  it('returns false when no Tauri globals exist', () => {
    delete window.__TAURI_INTERNALS__;
    delete window.__TAURI__;
    delete window.tauriAPI;
    expect(isTauriRuntime()).toBe(false);
  });

  it('returns true when __TAURI_INTERNALS__ exists', () => {
    window.__TAURI_INTERNALS__ = {};
    expect(isTauriRuntime()).toBe(true);
    delete window.__TAURI_INTERNALS__;
  });

  it('returns true when __TAURI__ exists', () => {
    window.__TAURI__ = {};
    expect(isTauriRuntime()).toBe(true);
    delete window.__TAURI__;
  });

  it('returns true when tauriAPI exists', () => {
    window.tauriAPI = {};
    expect(isTauriRuntime()).toBe(true);
    delete window.tauriAPI;
  });
});
