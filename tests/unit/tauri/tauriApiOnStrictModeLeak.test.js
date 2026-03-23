import { describe, expect, it, vi } from 'vitest';

// This test asserts a subtle but important behavior:
// In React StrictMode, effects can mount/unmount quickly. If unmount happens
// before the async `listen()` resolves, we must still unlisten once it does,
// otherwise we leak listeners and get duplicated events.

describe('tauriApi on() listener lifecycle', () => {
  it('unlistens if disposed before listen resolves', async () => {
    vi.resetModules();

    const unlistenBuffered = vi.fn();
    const unlistenSomeEvent = vi.fn();
    let callCount = 0;

    // Mock Tauri APIs used by utils/platform/tauriApi.js
    vi.doMock('@tauri-apps/api/event', () => {
      return {
        listen: vi.fn(async () => {
          // Resolve on a future tick to simulate real async behavior.
          await new Promise((r) => setTimeout(r, 0));
          callCount += 1;
          return callCount === 1 ? unlistenBuffered : unlistenSomeEvent;
        }),
      };
    });

    // Some environments may import core too; provide a safe stub.
    vi.doMock('@tauri-apps/api/core', () => {
      return {
        invoke: vi.fn(),
        convertFileSrc: vi.fn((p) => p),
      };
    });

    const mod = await import('../../../utils/platform/tauriApi.js');
    expect(typeof mod.installTauriApi).toBe('function');

    // Ensure the helper is installed onto window.
    await mod.installTauriApi();
    expect(window.tauriAPI).toBeTruthy();

    const off = window.tauriAPI.onScreenshotError(() => {});

    // Dispose immediately (before listen resolves).
    off();

    // Allow the mocked listen() to resolve.
    await new Promise((r) => setTimeout(r, 5));

    expect(unlistenBuffered).toHaveBeenCalledTimes(0);
    expect(unlistenSomeEvent).toHaveBeenCalledTimes(1);
  });
});
