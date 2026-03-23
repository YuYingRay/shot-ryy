import React, { useEffect, useState } from 'react';
import { formatComboForDisplay } from '../../utils/platform/keybinds';
import { useI18n } from './I18nContext';

/**
 * ImageUploader Component - Handles the initial image upload UI
 * 
 * @param {Object} props
 * @param {Function} props.onPaste - Handler for image upload/paste
 */
const ImageUploader = ({ onPaste, shortcuts }) => {
  const { t } = useI18n();

  // Avoid SSR/client hydration mismatch: platform-specific shortcut glyphs (⌘ vs Ctrl)
  // must be computed after mount.
  const [shortcutLabel, setShortcutLabel] = useState('⌘⇧ 8');

  useEffect(() => {
    const combo = shortcuts?.screenshotRegion;
    if (!combo) {
      setShortcutLabel('⌘⇧ 8');
      return;
    }

    try {
      const platform = window?.platform || null;
      const s = formatComboForDisplay(combo, { platform, useSymbols: true });
      setShortcutLabel(s || '⌘⇧ 8');
    } catch {
      setShortcutLabel('⌘⇧ 8');
    }
  }, [shortcuts?.screenshotRegion]);

  return (
    <div className="w-full h-full flex items-center justify-center p-12">
      <div className="text-center w-80 space-y-4">
        <div
          className="p-8 rounded-2xl border transition-all duration-200 shadow-soft-md border-[color:var(--card-border)] bg-[color:var(--panel-bg)]"
          onDrop={(e) => {
            e.preventDefault();
            onPaste(e);
          }}
          onDragOver={(e) => { e.preventDefault(); }}
        >
          <input
            className="hidden"
            id="imagesUpload"
            type="file"
            onChange={onPaste}
            accept="image/png, image/jpeg, image/webp"
          />
          <label
            htmlFor="imagesUpload"
            className="flex flex-col items-center justify-center cursor-pointer"
          >
            <span className="w-16 h-16 mb-4 text-[color:var(--app-fg)] opacity-90">
              <svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" />
                <path fill="var(--app-bg)" d="M17 11h-4V7h-2v4H7v2h4v4h2v-4h4z" />
              </svg>
            </span>
            <p className="text-lg font-medium text-[color:var(--app-fg)] mb-1">{shortcutLabel}</p>
            <p className="text-xs text-[color:var(--app-muted)]">{t('orUploadImage')}</p>
          </label>
        </div>
      </div>
    </div>
  );
};

export default ImageUploader;