import React from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import SettingsModal from '../../../components/dialogs/SettingsModal.jsx';

vi.mock('@theme-toggles/react/css/Classic.css', () => ({}));
vi.mock('@theme-toggles/react', () => ({
  Classic: ({ toggled, onToggle }) => (
    <button type="button" aria-label="theme-toggle" data-toggled={String(!!toggled)} onClick={() => onToggle?.()}>
      toggle
    </button>
  ),
}));

const setJsonMock = vi.fn();
const getJsonMock = vi.fn();

vi.mock('../../../utils/platform/safeStorage', () => ({
  getJson: (...args) => getJsonMock(...args),
  setJson: (...args) => setJsonMock(...args),
}));

vi.mock('../../../components/context/ThemeContext.jsx', () => ({
  useTheme: () => ({
    theme: 'dark',
    themePreference: 'dark',
    setThemePreference: vi.fn(),
    toggleTheme: vi.fn(),
  }),
}));

vi.mock('../../../components/context/I18nContext', () => ({
  useI18n: () => ({
    lang: 'en',
    setLang: vi.fn(),
    supported: [
      { code: 'en', label: 'English' },
      { code: 'zh-Hans', label: '简体中文' },
      { code: 'fr', label: 'Français' },
    ],
    t: (key) => key,
  }),
}));

describe('SettingsModal', () => {
  beforeEach(() => {
    getJsonMock.mockReset();
    setJsonMock.mockReset();
    delete window.tauriAPI;
    getJsonMock.mockImplementation((key, fallback) => {
      if (key === 'settings.general') {
        return { hideAppWhenUnfocused: true, keepAppInTray: false, closeAfterSave: true };
      }
      if (key === 'settings.shortcuts') {
        return {
          copy: 'Meta+C',
          save: 'Meta+S',
          saveToFolder: 'Meta+Shift+S',
          screenshotRegion: 'Meta+Shift+8',
          screenshotRegionCopy: 'Meta+Shift+9',
        };
      }
      return fallback;
    });
  });

  const renderModal = (overrides = {}) => render(
    <SettingsModal
      isOpen
      onClose={vi.fn()}
      onSetAutoHideEnabled={vi.fn()}
      onChangeGeneralSettings={vi.fn()}
      onSaveShortcuts={vi.fn()}
      {...overrides}
    />
  );

  it('renders core settings sections', () => {
    renderModal();

    expect(screen.getByText('General')).toBeInTheDocument();
    expect(screen.getByText('Close window after')).toBeInTheDocument();
    expect(screen.getByText('Shortcuts')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Hide app when unfocused' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Keep app in tray' })).not.toBeChecked();
  });

  it('closes on Escape key', () => {
    const onClose = vi.fn();
    renderModal({ onClose });

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('persists general settings and shortcuts on Done when there are changes', async () => {
    const onSetAutoHideEnabled = vi.fn();
    const onChangeGeneralSettings = vi.fn();
    const onSaveShortcuts = vi.fn();
    window.tauriAPI = { updateShortcuts: vi.fn(async () => ({ ok: true })) };

    renderModal({ onSetAutoHideEnabled, onChangeGeneralSettings, onSaveShortcuts });

    const doneButton = screen.getByRole('button', { name: 'Done' });

    fireEvent.click(screen.getByLabelText('Hide app when unfocused'));
    fireEvent.click(screen.getByLabelText('Keep app in tray'));

    fireEvent.click(doneButton);

    await waitFor(() => {
      expect(onSetAutoHideEnabled).toHaveBeenCalledWith(false);
    });
    expect(onChangeGeneralSettings).toHaveBeenCalledWith(expect.objectContaining({
      hideAppWhenUnfocused: false,
      keepAppInTray: true,
      closeAfterSave: true,
    }));
    expect(onSaveShortcuts).toHaveBeenCalled();
    expect(window.tauriAPI.updateShortcuts).toHaveBeenCalledWith(expect.objectContaining({
      regionShortcut: 'Meta+Shift+8',
      instantShortcut: 'Meta+Shift+9',
    }));
    expect(setJsonMock).toHaveBeenCalledTimes(2);
  });

  it('does not persist unchanged state', async () => {
    const onClose = vi.fn();
    renderModal({ onClose });

    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    await waitFor(() => {
      expect(onClose).toHaveBeenCalledTimes(1);
    });
    expect(setJsonMock).not.toHaveBeenCalled();
  });
});
