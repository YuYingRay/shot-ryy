import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import './App.css'
import '../../styles/globals.css'

import { installTauriApi } from '../../utils/platform/tauriApi'
import SettingsWindow from './settings/SettingsWindow.jsx'

function installBootDiagnostics({ label }) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const ensureOverlay = (id, html) => {
    let el = document.getElementById(id);
    if (el) return el;
    el = document.createElement('div');
    el.id = id;
    el.innerHTML = html;
    document.body.appendChild(el);
    return el;
  };

  // Intentionally do not show a boot badge; keep the fatal overlay only.
  const bootId = '__shotstyle_boot';

  const showFatal = (title, err) => {
    const msg = (() => {
      try {
        if (err == null) return '';
        if (typeof err === 'string') return err;
        if (err instanceof Error) return `${err.name}: ${err.message}\n${err.stack || ''}`;
        return JSON.stringify(err);
      } catch {
        return String(err);
      }
    })();

    ensureOverlay(
      '__shotstyle_fatal',
      `<div style="position:fixed;inset:0;z-index:2147483646;background:rgba(10,10,10,0.85);color:#fff;padding:16px;font:13px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,Inter,system-ui,sans-serif;overflow:auto;">
        <div style="max-width:980px;margin:0 auto;">
          <h1 style="font-size:16px;margin:0 0 8px 0;">${title}</h1>
          <pre style="white-space:pre-wrap;word-break:break-word;background:rgba(0,0,0,0.4);padding:12px;border-radius:12px;">${msg.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</pre>
        </div>
      </div>`
    );
  };

  window.addEventListener('error', (e) => {
    try { showFatal('Renderer error', e?.error || e?.message || e); } catch {}
  });
  window.addEventListener('unhandledrejection', (e) => {
    try { showFatal('Unhandled promise rejection', e?.reason || e); } catch {}
  });

  const start = Date.now();
  const tick = () => {
    const root = document.getElementById('root');
    const fallback = document.getElementById('boot-fallback');
    if (root && root.children && root.children.length > 0) {
      try { fallback && fallback.remove(); } catch {}
      return;
    }
    if (Date.now() - start > 15000) return;
    setTimeout(tick, 250);
  };
  setTimeout(tick, 250);
}

if (typeof window !== 'undefined') {
  installBootDiagnostics({ label: 'settings' });
  installTauriApi().catch(() => {})
}

try {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <SettingsWindow />
    </React.StrictMode>
  )
} catch (err) {
  try {
    window.dispatchEvent(new ErrorEvent('error', { error: err, message: 'React mount failed' }));
  } catch {}
}
