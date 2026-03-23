use tauri::Manager;

fn js_injection_payload() -> String {
  // NOTE: We cannot modify UI Experimentation sources.
  // This injector wires existing DOM controls to Tauri backend commands.
  // It is intentionally defensive: if an element isn't found, it no-ops.
  r#"(() => {
  try {
    if (window.__shotstyleUiExperimentationWired) return;
    window.__shotstyleUiExperimentationWired = true;

    const tauri = window.__TAURI__ || null;
    const invoke = tauri?.core?.invoke ? tauri.core.invoke : null;

    const log = () => {};

    const findButtonByText = (text) => {
      const needles = String(text || '').trim();
      if (!needles) return null;
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.find((b) => (b?.textContent || '').trim() === needles) || null;
    };

    const ensureInvoke = () => {
      if (!invoke) {
        log('Tauri invoke not available (window.__TAURI__ missing).');
        return false;
      }
      return true;
    };

    const stopAll = (e) => {
      try { e.preventDefault(); } catch {}
      try { e.stopPropagation(); } catch {}
      try { e.stopImmediatePropagation(); } catch {}
    };




    // Animated switcher behavior for System/Gradient/Color/Auto.
    // We emulate the "Framer Motion pill" look using Web Animations API
    // (no dependency changes; UI sources remain untouched).
    const setupWallpaperSwitcher = () => {
      // Tailwind arbitrary value classnames contain [] which require escaping in selectors.
      // Use attribute substring matching instead.
      const wrap = document.querySelector(
        'div[class*="bg-[#141414]"][class*="rounded-[8px]"][class*="p-[2px]"][class*="gap-[2px]"]'
      );
      if (!wrap) return null;

      if (wrap.__shotstyleSwitcherWired) return wrap;
      wrap.__shotstyleSwitcherWired = true;

      try { wrap.style.position = 'relative'; } catch {}

      const pill = document.createElement('div');
      pill.setAttribute('data-shotstyle-switch-pill', '1');
      pill.style.position = 'absolute';
      pill.style.top = '2px';
      pill.style.bottom = '2px';
      pill.style.left = '2px';
      pill.style.width = '0px';
      pill.style.backgroundColor = '#2C2C2C';
      pill.style.borderRadius = '6px';
      pill.style.pointerEvents = 'none';
      pill.style.zIndex = '0';
      wrap.insertBefore(pill, wrap.firstChild);

      const getButtons = () => Array.from(wrap.querySelectorAll('button')).filter(Boolean);

      const applyButtonLayering = () => {
        for (const b of getButtons()) {
          try { b.style.position = 'relative'; } catch {}
          try { b.style.zIndex = '1'; } catch {}
          // Let the pill provide the active background.
          try { b.style.backgroundColor = 'transparent'; } catch {}
        }
      };

      const movePillTo = (btn, { animate = true } = {}) => {
        if (!btn) return;
        const rWrap = wrap.getBoundingClientRect();
        const rBtn = btn.getBoundingClientRect();
        const targetLeft = Math.round((rBtn.left - rWrap.left) + 0);
        const targetWidth = Math.round(rBtn.width);

        const fromLeft = parseFloat(pill.style.left || '0') || 0;
        const fromWidth = parseFloat(pill.style.width || '0') || 0;

        if (!animate) {
          pill.style.left = `${targetLeft}px`;
          pill.style.width = `${targetWidth}px`;
          return;
        }

        try {
          pill.animate(
            [
              { left: `${fromLeft}px`, width: `${fromWidth}px` },
              { left: `${targetLeft}px`, width: `${targetWidth}px` },
            ],
            {
              duration: 220,
              easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
              fill: 'forwards',
            },
          );
        } catch {}

        pill.style.left = `${targetLeft}px`;
        pill.style.width = `${targetWidth}px`;
      };

      const findActiveButton = () => {
        // Active button is the one with inline backgroundColor '#2C2C2C' in the React UI.
        for (const b of getButtons()) {
          const bg = (b.style && b.style.backgroundColor) ? String(b.style.backgroundColor) : '';
          if (bg && bg !== 'transparent') return b;
        }
        return getButtons()[0] || null;
      };

      const syncFromDom = (animate = false) => {
        applyButtonLayering();
        const active = findActiveButton();
        movePillTo(active, { animate });
      };

      // Initial placement.
      syncFromDom(false);

      // Keep in sync after React updates.
      const mo = new MutationObserver(() => syncFromDom(false));
      mo.observe(wrap, { attributes: true, subtree: true, childList: true, attributeFilter: ['style', 'class'] });

      // Press/hold hover effect + delay switch until release.
      const pressedBg = '#232323';
      const onDown = (e) => {
        const btn = e.currentTarget;
        if (!btn || btn.__shotstyleAllowClick) return;
        stopAll(e);
        try {
          btn.__shotstylePressed = true;
          btn.style.backgroundColor = pressedBg;
        } catch {}
      };
      const onUp = (e) => {
        const btn = e.currentTarget;
        if (!btn) return;
        stopAll(e);
        try {
          btn.__shotstylePressed = false;
          btn.style.backgroundColor = 'transparent';
        } catch {}
        // Trigger the actual React click on release.
        btn.__shotstyleAllowClick = true;
        try { btn.click(); } catch {}
        setTimeout(() => { try { btn.__shotstyleAllowClick = false; } catch {} }, 0);
        // Animate pill toward the released button immediately.
        movePillTo(btn, { animate: true });
      };
      const onCancel = (e) => {
        const btn = e.currentTarget;
        try {
          btn.__shotstylePressed = false;
          btn.style.backgroundColor = 'transparent';
        } catch {}
      };

      for (const b of getButtons()) {
        b.addEventListener('pointerdown', onDown, true);
        b.addEventListener('pointerup', onUp, true);
        b.addEventListener('pointercancel', onCancel, true);
        b.addEventListener('pointerleave', onCancel, true);
        // Let real clicks through when we explicitly allow them.
        b.addEventListener('click', (e) => {
          if (b.__shotstyleAllowClick) return;
          // Block direct click so switching only happens on release.
          stopAll(e);
        }, true);
      }

      // Reposition pill on resize.
      window.addEventListener('resize', () => syncFromDom(false));
      return wrap;
    };

    try { setupWallpaperSwitcher(); } catch {}

    // Keep the UI unchanged; we only attach behavior.
    // Upload custom wallpaper -> pick image file -> read as data URL -> backgrounds_save_custom
    const uploadBtn = findButtonByText('Upload custom wallpaper');
    if (uploadBtn) {
      uploadBtn.addEventListener('click', async (e) => {
        try {
          if (!ensureInvoke()) return;
          e.preventDefault();

          const input = document.createElement('input');
          input.type = 'file';
          input.accept = 'image/*';
          input.style.position = 'fixed';
          input.style.left = '-9999px';
          input.style.top = '-9999px';
          document.body.appendChild(input);

          const pick = new Promise((resolve) => {
            input.addEventListener('change', () => resolve(input.files && input.files[0] ? input.files[0] : null), { once: true });
          });
          input.click();
          const file = await pick;
          input.remove();
          if (!file) return;

          const dataUrl = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onerror = () => reject(new Error('Failed to read file'));
            r.onload = () => resolve(String(r.result || ''));
            r.readAsDataURL(file);
          });

          const fileName = String(file.name || 'background.png');
          const res = await invoke('backgrounds_save_custom', { args: { dataUrl, fileName } });
          log('Saved custom background:', res);
        } catch (err) {
          log('Upload custom wallpaper failed:', err);
        }
      }, { passive: false });
    }

    // Copy / Save / Save to folder operate on a freshly captured region screenshot.
    // This keeps the feature fully functional without adding any new UI surfaces.
    const captureRegionDataUrl = async () => {
      if (!ensureInvoke()) return null;
      // macOS implementation uses native screencapture and returns a PNG data URL.
      // On other platforms this may error; that's fine.
      return await invoke('screenshot_capture_to_file', { args: { mode: 'region' } });
    };

    const copyBtn = findButtonByText('Copy');
    if (copyBtn && !copyBtn.hasAttribute('data-shotstyle-react-wired')) {
      copyBtn.addEventListener('click', async (e) => {
        try {
          if (!ensureInvoke()) return;
          e.preventDefault();
          const dataUrl = await captureRegionDataUrl();
          if (!dataUrl) return;
          await invoke('clipboard_write_image_data_url', { args: { dataUrl } });
          log('Copied screenshot to clipboard');
        } catch (err) {
          log('Copy failed:', err);
        }
      }, { passive: false });
    }

    const saveBtn = findButtonByText('Save');
    if (saveBtn && !saveBtn.hasAttribute('data-shotstyle-react-wired')) {
      saveBtn.addEventListener('click', async (e) => {
        try {
          if (!ensureInvoke()) return;
          e.preventDefault();
          const dataUrl = await captureRegionDataUrl();
          if (!dataUrl) return;
          const res = await invoke('exports_save_to_downloads', { args: { dataUrl, fileName: 'shot.style.png' } });
          log('Saved screenshot to downloads:', res);
        } catch (err) {
          log('Save failed:', err);
        }
      }, { passive: false });
    }

    const saveToFolderBtn = findButtonByText('Save to folder');
    if (saveToFolderBtn && !saveToFolderBtn.hasAttribute('data-shotstyle-react-wired')) {
      saveToFolderBtn.addEventListener('click', async (e) => {
        try {
          if (!ensureInvoke()) return;
          e.preventDefault();
          const dataUrl = await captureRegionDataUrl();
          if (!dataUrl) return;

          // Try to use the Tauri dialog API if globally available.
          const dialogSave = tauri?.dialog?.save || tauri?.dialog?.saveFile || null;
          let filePath = null;
          if (typeof dialogSave === 'function') {
            try {
              filePath = await dialogSave({ defaultPath: 'shot.style.png' });
            } catch {}
          }

          if (filePath) {
            const res = await invoke('exports_save_to_path', { args: { dataUrl, filePath } });
            log('Saved screenshot to path:', res);
          } else {
            const res = await invoke('exports_save_to_downloads', { args: { dataUrl, fileName: 'shot.style.png' } });
            log('Save-to-folder fell back to downloads:', res);
          }
        } catch (err) {
          log('Save to folder failed:', err);
        }
      }, { passive: false });
    }

    // Settings button: open the in-app Settings window.
    const settingsBtn = findButtonByText('Settings');
    if (settingsBtn && !settingsBtn.hasAttribute('data-shotstyle-react-wired')) {
      settingsBtn.addEventListener('click', async (e) => {
        try {
          if (!ensureInvoke()) return;
          stopAll(e);
          await invoke('app_open_settings_window');
        } catch (err) {
          log('Open settings failed:', err);
        }
      }, { passive: false });
    }

    log('Wiring installed');
  } catch (err) {
    try { console.error('[ui-exp] injector crashed:', err); } catch {}
  }
})();"#
    .to_string()
    // Note: sidebar padding, macOS traffic lights, and the wallpaper switcher animation
    // are now implemented directly in the moved ui-exp React app.
}

pub fn install_ui_experimentation_wiring(app: &tauri::AppHandle) {
  // Evaluate the wiring script once the main window is ready.
  // We retry briefly because the webview may not be fully initialized during setup().
  let app = app.clone();
  std::thread::spawn(move || {
    for _ in 0..40 {
      if let Some(win) = app.get_webview_window("main") {
        if win.eval(&js_injection_payload()).is_ok() {
          return;
        }
      }
      std::thread::sleep(std::time::Duration::from_millis(150));
    }
  });
}
