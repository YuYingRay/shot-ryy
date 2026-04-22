import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import hotkeys from 'hotkeys-js';

import { getJson, setJson } from '../utils/platform/safeStorage';
import { defaultShortcuts } from '../utils/platform/preferences';
import { analyzeShortcuts, normalizeShortcuts } from '../utils/platform/shortcuts';
import { comboFromKeyboardEvent, formatComboForDisplay, isValidCombo, normalizeCombo } from '../utils/platform/keybinds';

const isWindows = typeof navigator !== 'undefined' && /Win/i.test(navigator.platform || '');

const DEFAULT_SETTINGS = Object.freeze({
  hideAppWhenUnfocused: true,
  keepAppInTray: !isWindows,
  hideWindowOnLaunch: false,
  openAtLogin: false,
  hideDockIconWhenHidden: false,
  closeAfterCopy: false,
  closeAfterSave: false,
  closeAfterSaveToFolder: false,
  closeAfterDrag: false,
});

const GENERAL_OPTIONS = [
  { key: 'hideAppWhenUnfocused', label: 'Hide app when unfocused' },
  { key: 'keepAppInTray', label: 'Keep app in tray' },
  { key: 'hideWindowOnLaunch', label: 'Hide window on launch' },
  { key: 'openAtLogin', label: 'Open at login' },
  { key: 'hideDockIconWhenHidden', label: 'Hide dock icon when app hidden' },
];

const CLOSE_AFTER_OPTIONS = [
  { key: 'closeAfterCopy', label: 'Copying image to clipboard' },
  { key: 'closeAfterSave', label: 'Saving image' },
  { key: 'closeAfterSaveToFolder', label: 'Saving to folder' },
];

const SHORTCUT_ROWS = [
  { key: 'copy', label: 'Copy image', scope: 'In app' },
  { key: 'save', label: 'Save image', scope: 'In app' },
  { key: 'saveToFolder', label: 'Save to folder', scope: 'In app' },
  { key: 'screenshotRegion', label: 'Capture region', scope: 'Global' },
  { key: 'screenshotRegionCopy', label: 'Capture + copy output', scope: 'Global' },
];

const loadGeneralSettings = () => {
  try {
    return { ...DEFAULT_SETTINGS, ...getJson('settings.general', {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

const loadShortcutSettings = () => {
  try {
    return normalizeShortcuts(getJson('settings.shortcuts', defaultShortcuts));
  } catch {
    return normalizeShortcuts(defaultShortcuts);
  }
};

function ShortcutChip({ combo }) {
  const shown = formatComboForDisplay(combo, { useSymbols: true }) || 'Unassigned';
  return <span className="rounded-[8px] bg-white/5 px-2.5 py-1 text-[12px] text-white">{shown}</span>;
}

function Section({ title, children }) {
  return (
    <div className="flex flex-col gap-2.5">
      {title && (
        <div className="px-1 text-[13px] font-inter font-medium text-white/50">{title}</div>
      )}
      <section className="rounded-[20px] bg-[#2C2C2C] p-[28px]">
        {children}
      </section>
    </div>
  );
}

export default function SettingsModal({
  isOpen = false,
  shortcuts,
  autoHideEnabled,
  onSetAutoHideEnabled,
  onClose,
  onSaveShortcuts,
  onChangeGeneralSettings,
}) {
  const [settings, setSettings] = useState(loadGeneralSettings);
  const [shortcutDraft, setShortcutDraft] = useState(loadShortcutSettings);
  const [recordingKey, setRecordingKey] = useState(null);
  const [shortcutError, setShortcutError] = useState('');
  const [animateIn, setAnimateIn] = useState(false);
  const [mounted, setMounted] = useState(isOpen);

  const initialSettingsRef = useRef(loadGeneralSettings());
  const initialShortcutsRef = useRef(loadShortcutSettings());

  useEffect(() => {
    if (!isOpen) return;

    const nextSettings = {
      ...loadGeneralSettings(),
      ...(typeof autoHideEnabled === 'boolean' ? { hideAppWhenUnfocused: !!autoHideEnabled } : {}),
    };
    const nextShortcuts = shortcuts && typeof shortcuts === 'object'
      ? normalizeShortcuts(shortcuts)
      : loadShortcutSettings();

    setSettings(nextSettings);
    setShortcutDraft(nextShortcuts);
    setRecordingKey(null);
    setShortcutError('');
    initialSettingsRef.current = nextSettings;
    initialShortcutsRef.current = nextShortcuts;
  }, [isOpen, shortcuts, autoHideEnabled]);

  useEffect(() => {
    if (typeof autoHideEnabled !== 'boolean') return;
    setSettings((prev) => ({ ...prev, hideAppWhenUnfocused: !!autoHideEnabled }));
  }, [autoHideEnabled]);

  useEffect(() => {
    if (!shortcuts || typeof shortcuts !== 'object') return;
    setShortcutDraft(normalizeShortcuts(shortcuts));
  }, [shortcuts]);

  useEffect(() => {
    if (!isOpen || !recordingKey) return;

    const previousFilter = hotkeys.filter;
    hotkeys.filter = () => true;

    const handler = (event) => {
      try {
        event.preventDefault();
        event.stopPropagation();
      } catch {}

      if (String(event?.key || '').toLowerCase() === 'escape') {
        setRecordingKey(null);
        return false;
      }

      const combo = normalizeCombo(comboFromKeyboardEvent(event));
      if (!combo || !isValidCombo(combo)) return false;

      setShortcutDraft((prev) => ({ ...prev, [recordingKey]: combo }));
      setRecordingKey(null);
      setShortcutError('');
      return false;
    };

    try {
      hotkeys('*', { capture: true, keydown: true, keyup: false }, handler);
      window.dispatchEvent(new CustomEvent('shortcuts:recording:changed', { detail: true }));
    } catch {}

    return () => {
      try {
        hotkeys.unbind('*', handler);
      } catch {}
      hotkeys.filter = previousFilter;
      try {
        window.dispatchEvent(new CustomEvent('shortcuts:recording:changed', { detail: false }));
      } catch {}
    };
  }, [isOpen, recordingKey]);

  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      let raf = 0;
      raf = requestAnimationFrame(() => setAnimateIn(true));
      return () => {
        if (raf) cancelAnimationFrame(raf);
      };
    }

    setAnimateIn(false);
    const timeout = window.setTimeout(() => setMounted(false), 220);
    return () => window.clearTimeout(timeout);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const prevOverflow = typeof document !== 'undefined' ? document.body.style.overflow : '';
    if (typeof document !== 'undefined') {
      document.body.style.overflow = 'hidden';
    }

    const onEsc = (event) => {
      if (event.key === 'Escape' && !recordingKey) {
        event.preventDefault();
        try { onClose && onClose(); } catch {}
      }
    };

    window.addEventListener('keydown', onEsc);
    return () => {
      window.removeEventListener('keydown', onEsc);
      if (typeof document !== 'undefined') {
        document.body.style.overflow = prevOverflow;
      }
    };
  }, [isOpen, onClose, recordingKey]);



  const normalizedShortcutDraft = useMemo(() => normalizeShortcuts(shortcutDraft), [shortcutDraft]);
  const analysis = useMemo(() => analyzeShortcuts(normalizedShortcutDraft), [normalizedShortcutDraft]);
  const hasGeneralChanges = useMemo(
    () => JSON.stringify(settings) !== JSON.stringify(initialSettingsRef.current),
    [settings]
  );
  const hasShortcutChanges = useMemo(
    () => JSON.stringify(normalizedShortcutDraft) !== JSON.stringify(initialShortcutsRef.current),
    [normalizedShortcutDraft]
  );
  const hasChanges = hasGeneralChanges || hasShortcutChanges;
  const panelInset = 16;

  const updateSetting = useCallback((key, value) => {
    setSettings((prev) => ({ ...prev, [key]: !!value }));
  }, []);

  const saveAndClose = async () => {
    const normalized = normalizeShortcuts(shortcutDraft);
    const result = analyzeShortcuts(normalized);

    if (result.hasIssues) {
      setShortcutError('Fix shortcut conflicts/invalid combinations before saving.');
      return;
    }

    if (!hasChanges) {
      try { onClose && onClose(); } catch {}
      return;
    }

    try { setJson('settings.general', settings); } catch {}
    try { onChangeGeneralSettings && onChangeGeneralSettings(settings); } catch {}
    try { onSetAutoHideEnabled && onSetAutoHideEnabled(!!settings.hideAppWhenUnfocused); } catch {}

    try {
      const api = (typeof window !== 'undefined') ? (window.tauriAPI || window.electronAPI) : null;
      if (typeof api?.setKeepInTrayEnabled === 'function') {
        api.setKeepInTrayEnabled(!!settings.keepAppInTray);
      }
      if (typeof api?.setOpenAtLoginEnabled === 'function') {
        api.setOpenAtLoginEnabled(!!settings.openAtLogin);
      }
      if (typeof api?.setHideDockIconWhenHiddenEnabled === 'function') {
        api.setHideDockIconWhenHiddenEnabled(!!settings.hideDockIconWhenHidden);
      }
    } catch {}

    try { setJson('settings.shortcuts', normalized); } catch {}
    try { onSaveShortcuts && onSaveShortcuts(normalized); } catch {}

    let shortcutUpdateFailed = null;
    try {
      const api = (typeof window !== 'undefined') ? (window.tauriAPI || window.electronAPI) : null;
      if (typeof api?.updateShortcuts === 'function') {
        const res = await api.updateShortcuts({
          regionShortcut: normalized.screenshotRegion,
          instantShortcut: normalized.screenshotRegionCopy,
          windowShortcut: '',
        });
        if (res && res.ok === false) {
          const details = [
            res?.region?.ok === false ? `Region: ${res?.region?.error || 'registration failed'}` : null,
            res?.instant?.ok === false ? `Region+Copy: ${res?.instant?.error || 'registration failed'}` : null,
            res?.window?.ok === false ? `Window: ${res?.window?.error || 'registration failed'}` : null,
          ].filter(Boolean).join(' | ');
          shortcutUpdateFailed = details || 'Global shortcut registration failed.';
        }
      }
    } catch (e) {
      shortcutUpdateFailed = String(e?.message || e || 'Global shortcut registration failed.');
    }

    if (shortcutUpdateFailed) {
      setShortcutError(shortcutUpdateFailed);
      return;
    }

    try {
      window.dispatchEvent(new CustomEvent('shortcuts:updated', { detail: normalized }));
    } catch {}

    try { onClose && onClose(); } catch {}
  };

  if (!mounted) return null;

  const modalContent = (
    <div
      className="fixed inset-0 flex items-center justify-center window-no-drag"
      style={{
        zIndex: 300000,
        WebkitAppRegion: 'no-drag',
        opacity: animateIn ? 1 : 0,
        transition: 'opacity 180ms ease',
      }}
    >
      {/* Backdrop — click to dismiss */}
      <div
        className="absolute inset-0 bg-black/55"
        onClick={() => { try { onClose && onClose(); } catch {} }}
        aria-label="Close settings overlay"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        className="relative flex flex-col overflow-hidden rounded-[26px] border border-white/12 text-white shadow-[0_24px_80px_rgba(0,0,0,0.62)]"
        style={{
          zIndex: 1,
          width: '62vw',
          minWidth: 720,
          maxWidth: 920,
          height: 'auto',
          padding: `${panelInset}px`,
          backgroundColor: 'rgba(28, 28, 28, 0.95)',
          backdropFilter: 'blur(24px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(24px) saturate(1.4)',
          WebkitAppRegion: 'no-drag',
          transform: animateIn ? 'translateY(0px) scale(1)' : 'translateY(8px) scale(0.985)',
          transition: 'transform 200ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        <div className="flex items-center border-b border-white/10 px-5 py-4">
          <h2 id="settings-modal-title" className="text-[16px] font-medium">Settings</h2>
        </div>

        <div className="px-6 py-6">
          <div className="grid grid-cols-2 gap-5 items-start">
            {/* Left column — General */}
            <Section title="General">
              <div className="space-y-1">
                {GENERAL_OPTIONS.map((option) => (
                  <label key={option.key} className="flex cursor-pointer items-center justify-between gap-3 rounded-[8px] px-3 py-2 text-[13px] hover:bg-white/5 transition-colors">
                    <span className="text-white/90">{option.label}</span>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[#7c3aed]"
                      checked={!!settings[option.key]}
                      onChange={(e) => updateSetting(option.key, e.target.checked)}
                    />
                  </label>
                ))}
                <div className="pt-2 pb-0.5">
                  <div className="rounded-[8px] px-3 py-1.5 text-[13px] text-white/50 font-inter">Close window after</div>
                </div>
                {CLOSE_AFTER_OPTIONS.map((option) => (
                  <label key={option.key} className="flex cursor-pointer items-center justify-between gap-3 rounded-[8px] px-3 py-2 text-[13px] hover:bg-white/5 transition-colors">
                    <span className="text-white/90">{option.label}</span>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[#7c3aed]"
                      checked={!!settings[option.key]}
                      onChange={(e) => updateSetting(option.key, e.target.checked)}
                    />
                  </label>
                ))}
              </div>
            </Section>

            {/* Right column — Shortcuts */}
            <Section title="Shortcuts">
              <div className="space-y-2">
                {SHORTCUT_ROWS.map((row) => {
                  const invalid = analysis.invalid?.[row.key];
                  const conflict = analysis.conflicts?.[row.key];
                  return (
                    <div key={row.key} className="rounded-[8px] px-3 py-2 hover:bg-white/5 transition-colors">
                      <div className="mb-1.5 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[12px] text-white">{row.label}</div>
                          <div className="text-[11px] text-white/50">{row.scope}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <ShortcutChip combo={shortcutDraft[row.key]} />
                          <button
                            type="button"
                            className={`rounded-[8px] px-2.5 py-1 text-[11px] ${recordingKey === row.key ? 'bg-purple-600/25 text-white' : 'bg-white/5 text-white/90 hover:bg-white/10'}`}
                            onClick={() => {
                              setRecordingKey((prev) => (prev === row.key ? null : row.key));
                              setShortcutError('');
                            }}
                          >
                            {recordingKey === row.key ? 'Press keys…' : 'Change'}
                          </button>
                          <button
                            type="button"
                            className="rounded-[8px] bg-white/5 px-2.5 py-1 text-[11px] text-white/90 hover:bg-white/10"
                            onClick={() => {
                              setShortcutDraft((prev) => ({ ...prev, [row.key]: defaultShortcuts[row.key] || '' }));
                              if (recordingKey === row.key) setRecordingKey(null);
                              setShortcutError('');
                            }}
                          >
                            Reset
                          </button>
                        </div>
                      </div>
                      {invalid && <div className="text-[11px] text-red-300">{invalid}</div>}
                      {!invalid && conflict && <div className="text-[11px] text-amber-300">Conflicts with another shortcut: {formatComboForDisplay(conflict, { useSymbols: false })}</div>}
                    </div>
                  );
                })}
                <div className="flex items-center justify-between gap-2 pt-1">
                  <div className="text-[11px] text-white/45">Press Esc while recording to cancel.</div>
                  <button
                    type="button"
                    className="rounded-[8px] bg-white/5 px-2.5 py-1 text-[11px] text-white/90 hover:bg-white/10"
                    onClick={() => {
                      setShortcutDraft(normalizeShortcuts(defaultShortcuts));
                      setRecordingKey(null);
                      setShortcutError('');
                    }}
                  >
                    Reset all
                  </button>
                </div>
                {(shortcutError || analysis.hasIssues) && (
                  <div className="rounded-[8px] border border-amber-400/30 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-200">
                    {shortcutError || 'Resolve shortcut conflicts before saving.'}
                  </div>
                )}
              </div>
            </Section>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-white/10 px-5 py-3">
          <button
            type="button"
            className="shotstyle-footer-btn bg-[#7700FF] font-inter font-light text-white"
            onClick={saveAndClose}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );

  return modalContent;
}
