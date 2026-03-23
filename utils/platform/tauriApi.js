// Installs a minimal Tauri API bridge for the renderer.
// The app historically used a global API object; in Tauri we implement it via invoke/event.

export async function installTauriApi() {
  if (typeof window === 'undefined') return;
  if (window.tauriAPI) return;

  let invoke;
  let listen;
  let save;
  let open;
  let convertFileSrc;

  try {
    ({ invoke, convertFileSrc } = await import('@tauri-apps/api/core'));
  } catch {
    return;
  }

  try {
    ({ listen } = await import('@tauri-apps/api/event'));
  } catch {
    listen = null;
  }

  // Buffer important early events (notably screenshot insertion) so they aren't dropped
  // before React mounts and registers listeners.
  let bufferedScreenshotCaptured = null;
  try {
    const mod = await import('./tauriEventBuffer');
    if (mod?.createBufferedTauriEvent && listen) {
      bufferedScreenshotCaptured = mod.createBufferedTauriEvent(listen, 'screenshot-captured', { maxBuffer: 3 });
    }
  } catch {
    bufferedScreenshotCaptured = null;
  }

  try {
    ({ save, open } = await import('@tauri-apps/plugin-dialog'));
  } catch {
    save = null;
    open = null;
  }

  const on = (eventName, callback) => {
    if (!listen || typeof callback !== 'function') return () => {};
    let unlisten = null;
    let disposed = false;

    listen(eventName, (event) => {
      try {
        callback(event?.payload);
      } catch {}
    })
      .then((fn) => {
        // If the subscriber was disposed before `listen()` resolved (React StrictMode can do this),
        // immediately unlisten to avoid leaking listeners.
        if (disposed) {
          try { fn && fn(); } catch {}
          return;
        }
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      disposed = true;
      try {
        unlisten && unlisten();
      } catch {}
    };
  };
  const filePathToAssetUrl = (filePath) => {
    if (!filePath || typeof filePath !== 'string') return filePath;
    if (typeof convertFileSrc === 'function') return convertFileSrc(filePath);
    return filePath;
  };

  const readFileAsDataUrl = async (filePathOrOpts, maybeOpts) => {
    let filePath = null;
    let maxDim = null;

    if (typeof filePathOrOpts === 'string') {
      filePath = filePathOrOpts;
    } else if (filePathOrOpts && typeof filePathOrOpts === 'object') {
      filePath = filePathOrOpts.filePath || null;
      maxDim = filePathOrOpts.maxDim ?? null;
    }

    if (maybeOpts && typeof maybeOpts === 'object') {
      maxDim = maxDim ?? maybeOpts.maxDim ?? null;
    }

    if (!filePath) throw new Error('Missing filePath');

    // Cache data URLs to avoid repeated expensive base64 encodes.
    if (!readFileAsDataUrl._cache) {
      readFileAsDataUrl._cache = new Map();
    }
    const key = `${String(filePath)}|${maxDim == null ? '' : String(maxDim)}`;
    const cache = readFileAsDataUrl._cache;
    if (cache.has(key)) {
      return await cache.get(key);
    }

    const p = invoke('read_file_as_data_url', { args: { filePath, maxDim } });
    cache.set(key, p);
    try {
      const v = await p;
      if (cache.size > 64) {
        const firstKey = cache.keys().next().value;
        if (firstKey != null) cache.delete(firstKey);
      }
      return v;
    } catch (e) {
      cache.delete(key);
      throw e;
    }
  };

  // Menu-bar UX: temporarily disable auto-hide when native dialogs steal focus.
  const getDesiredAutoHide = () => {
    try {
      const raw = window?.localStorage?.getItem?.('settings.autoHideEnabled');
      if (raw == null) return true;
      return !!JSON.parse(raw);
    } catch {
      return true;
    }
  };

  const setAutoHide = async (enabled) => {
    try {
      await invoke('app_set_auto_hide_enabled', { args: { enabled: !!enabled } });
    } catch {
      // Older builds may not have the command; ignore.
    }
  };

  const withAutoHideDisabled = async (fn) => {
    await setAutoHide(false);
    try {
      return await fn();
    } finally {
      await setAutoHide(getDesiredAutoHide());
    }
  };

  const readFileAsAssetUrl = async (filePathOrOpts, maybeOpts) => {
    let filePath = null;
    let maxDim = null;

    if (typeof filePathOrOpts === 'string') {
      filePath = filePathOrOpts;
    } else if (filePathOrOpts && typeof filePathOrOpts === 'object') {
      filePath = filePathOrOpts.filePath || null;
      maxDim = filePathOrOpts.maxDim ?? null;
    }

    if (maybeOpts && typeof maybeOpts === 'object') {
      maxDim = maxDim ?? maybeOpts.maxDim ?? null;
    }

    if (!filePath) throw new Error('Missing filePath');

    const res = await invoke('read_file_as_asset', { args: { filePath, maxDim } });
    const outPath = res?.filePath || res?.file_path || res?.path || filePath;
    return filePathToAssetUrl(outPath);
  };

  const readFileAsAssetInfo = async (filePathOrOpts, maybeOpts) => {
    let filePath = null;
    let maxDim = null;

    if (typeof filePathOrOpts === 'string') {
      filePath = filePathOrOpts;
    } else if (filePathOrOpts && typeof filePathOrOpts === 'object') {
      filePath = filePathOrOpts.filePath || null;
      maxDim = filePathOrOpts.maxDim ?? null;
    }

    if (maybeOpts && typeof maybeOpts === 'object') {
      maxDim = maxDim ?? maybeOpts.maxDim ?? null;
    }

    if (!filePath) throw new Error('Missing filePath');

    const res = await invoke('read_file_as_asset', { args: { filePath, maxDim } });
    const outPath = res?.filePath || res?.file_path || res?.path || filePath;
    return { filePath: outPath, assetUrl: filePathToAssetUrl(outPath) };
  };

  const applyBackgroundFx = async ({ bytes, blurPx = 0, brightness = 1 } = {}) => {
    if (!bytes || !bytes.length) throw new Error('Missing image bytes');
    const res = await invoke('image_apply_fx_bytes', { args: { bytes, blurPx, brightness } });
    const outPath = res?.filePath || res?.file_path || res?.path || null;
    if (!outPath) throw new Error('Missing output file path');
    return { filePath: outPath, assetUrl: filePathToAssetUrl(outPath) };
  };

  const writeClipboardImage = async (dataUrl) => {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
      throw new Error('Invalid dataUrl');
    }

    const dataUrlToBlob = (s) => {
      const str = String(s || '');
      const comma = str.indexOf(',');
      if (comma < 0) throw new Error('Invalid dataUrl');
      const meta = str.slice(0, comma);
      const payload = str.slice(comma + 1);
      const mimeMatch = meta.match(/^data:([^;]+)(;base64)?/i);
      const mime = (mimeMatch && mimeMatch[1]) ? mimeMatch[1] : 'application/octet-stream';

      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    };

    const isTauriContext = !!(window?.__TAURI_INTERNALS__ || window?.__TAURI__ || window?.tauriAPI);

    const tryLegacyCopyText = (text) => {
      try {
        const ta = document.createElement('textarea');
        ta.value = String(text || '');
        ta.setAttribute('readonly', 'true');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        ta.style.left = '-1000px';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = !!document.execCommand?.('copy');
        document.body.removeChild(ta);
        return ok;
      } catch {
        return false;
      }
    };

    try {
      await invoke('clipboard_write_image_data_url', { args: { dataUrl } });
      return { ok: true };
    } catch (e) {
      if (isTauriContext) {
        throw e;
      }
      // Fallback: try the browser clipboard API.
      const canWriteImage =
        !!navigator.clipboard?.write &&
        typeof ClipboardItem !== 'undefined' &&
        (typeof ClipboardItem?.supports !== 'function' || ClipboardItem.supports('image/png')) &&
        (typeof window === 'undefined' || window.isSecureContext !== false);

      if (canWriteImage) {
        const blob = dataUrlToBlob(dataUrl);
        await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'image/png']: blob })]);
        return { ok: true, mode: 'image' };
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(dataUrl);
        return { ok: true, mode: 'text' };
      }

      if (tryLegacyCopyText(dataUrl)) {
        return { ok: true, mode: 'text' };
      }

      throw e;
    }
  };

  window.tauriAPI = Object.freeze({
    onScreenshotCaptured: (cb) => {
      if (bufferedScreenshotCaptured) return bufferedScreenshotCaptured.subscribe(cb);
      return on('screenshot-captured', cb);
    },
    onScreenshotError: (cb) => on('screenshot-error', cb),
    onScreenshotMonitoringStarted: (cb) => on('screenshot-monitoring-started', cb),
    onOpenSettings: (cb) => on('open-settings', cb),

    filePathToAssetUrl,
    readFileAsDataUrl,
    readFileAsAssetUrl,
    readFileAsAssetInfo,
    applyBackgroundFx,
    writeClipboardImage,

    updateShortcuts: (payload) => invoke('preferences_update_shortcuts', { args: payload || {} }),

    saveCustomBackground: (payload) => invoke('backgrounds_save_custom', { args: payload || {} }),
    listCustomBackgrounds: () => invoke('backgrounds_list_custom'),
    deleteCustomBackground: (filePath) => invoke('backgrounds_delete_custom', { args: { filePath } }),

    listSystemWallpapers: (payload) => invoke('wallpapers_list_system', { args: payload || {} }),

    // Menu-bar UX: temporarily disable auto-hide when native dialogs steal focus.
    setAutoHideEnabled: async (enabled) => {
      try {
        return await invoke('app_set_auto_hide_enabled', { args: { enabled: !!enabled } });
      } catch {
        // Older builds may not have the command; ignore.
        return { ok: false, enabled: !!enabled };
      }
    },

    setKeepInTrayEnabled: async (enabled) => {
      try {
        return await invoke('app_set_keep_in_tray_enabled', { args: { enabled: !!enabled } });
      } catch {
        return { ok: false, enabled: !!enabled };
      }
    },

    setOpenAtLoginEnabled: async (enabled) => {
      try {
        return await invoke('app_set_open_at_login_enabled', { args: { enabled: !!enabled } });
      } catch {
        return { ok: false, enabled: !!enabled };
      }
    },

    setHideDockIconWhenHiddenEnabled: async (enabled) => {
      try {
        return await invoke('app_set_hide_dock_icon_when_hidden_enabled', { args: { enabled: !!enabled } });
      } catch {
        return { ok: false, enabled: !!enabled };
      }
    },

    pickDirectory: async ({ title } = {}) => {
      if (!open) return null;
      return await withAutoHideDisabled(async () => {
        const picked = await open({
          directory: true,
          multiple: false,
          title: title ? String(title) : undefined,
        });

        if (!picked) return null;
        if (Array.isArray(picked)) return picked[0] ? String(picked[0]) : null;
        return String(picked);
      });
    },

    openFeedbackWindow: async () => {
      return await invoke('app_open_feedback_window');
    },

    openSettingsWindow: async () => {
      return await invoke('app_open_settings_window');
    },

    openScreenshotWindowWithPayload: async (payload) => {
      return await invoke('app_open_screenshot_window_with_payload', { args: { payload: payload || null } });
    },

    openFeedbackExternal: async () => {
      return await invoke('app_open_feedback_external');
    },

    applyExportWatermark: (payload) => invoke('exports_apply_watermark', { args: payload || {} }),

    saveExportedImageToFolder: async ({ dataUrl, folderPath, fileName }) => {
      return invoke('exports_save_to_folder', { args: { dataUrl, folderPath, fileName } });
    },

    saveExportedImage: async ({ dataUrl, fileName }) => {
      if (save) {
        return await withAutoHideDisabled(async () => {
          const filePath = await save({
            defaultPath: fileName,
            filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
          });
          if (filePath) {
            const res = await invoke('exports_save_to_path', { args: { dataUrl, filePath } });
            if (res && res.ok === false) {
              return { ok: false, error: res.error || 'Failed to save file', filePath: res.filePath || null };
            }
            return { ok: true, filePath: (res && (res.filePath || res.file_path)) ? (res.filePath || res.file_path) : filePath };
          }
          return { ok: false, localCancel: true };
        });
      }

      return invoke('exports_save_to_downloads', { args: { dataUrl, fileName } });
    },

    captureScreenshotToFile: ({ mode } = {}) => invoke('screenshot_capture_to_file', { args: { mode } }),
    captureRegionUpload: ({ filePath, x, y, w, h, dpr, intent } = {}) => invoke('capture_region_upload', {
      args: { filePath, x, y, w, h, dpr, intent }
    }),
    captureRegionSubmitDataUrl: ({ dataUrl, intent } = {}) => invoke('capture_region_submit_data_url', {
      args: { dataUrl, intent }
    }),
    captureCancel: ({ filePath } = {}) => invoke('capture_cancel', { args: { filePath } }),
    openSystemSettings: ({ pane } = {}) => invoke('open_system_settings', { args: { pane: String(pane || '') } }),

    showMainWindowAndFocus: () => invoke('app_show_main_window'),
    hideMainWindow: () => invoke('app_hide_main_window'),
  });

  window.platform = Object.freeze({
    isMac: /Mac|iPhone|iPad|iPod/.test(navigator.platform),
    isWindows: /Win/.test(navigator.platform),
    isLinux: /Linux/.test(navigator.platform),
  });

  try {
    window.__SHOTSTYLE_TAURI__ = true;
  } catch {}

  // Crash/error reporting (local logs): forward console + capture unhandled errors.
  // No-ops in non-Tauri/web contexts.
  try {
    const { attachConsole, error: logError } = await import('@tauri-apps/plugin-log');
    try { await attachConsole(); } catch {}

    const safeStringify = (v) => {
      try {
        if (typeof v === 'string') return v;
        return JSON.stringify(v);
      } catch {
        try { return String(v); } catch { return '[unstringifiable]'; }
      }
    };

    window.addEventListener('error', (ev) => {
      try {
        const parts = [];
        const message = ev?.message;
        const errorMessage = ev?.error?.message;
        const stack = ev?.error?.stack;
        if (message) parts.push(String(message));
        if (errorMessage && errorMessage !== message) parts.push(String(errorMessage));
        if (ev?.filename) parts.push(`at ${String(ev.filename)}:${String(ev?.lineno || '')}:${String(ev?.colno || '')}`);
        if (stack) parts.push(String(stack));
        const msg = parts.filter(Boolean).join('\n') || 'Window error';
        logError(`[renderer:error]\n${msg}`);
      } catch {}
    });

    window.addEventListener('unhandledrejection', (ev) => {
      try {
        const reason = ev?.reason;
        const msg = reason?.stack || safeStringify(reason);
        logError(`[renderer:unhandledrejection] ${msg}`);
      } catch {}
    });
  } catch {}
}
