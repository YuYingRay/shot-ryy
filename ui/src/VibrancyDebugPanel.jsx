import React from 'react'
import { useAppContext } from './AppContext'

export default function VibrancyDebugPanel() {
  const {
    vibrancyDebugOpen,
    setVibrancyDebugOpen,
    vibrancyForceOpaque,
    setVibrancyForceOpaque,
    vibrancyActive,
    setVibrancyActive,
    vibrancyDebug,
    setVibrancyDebug,
    vibrancyDebugError,
    setVibrancyDebugError,
    vibrancyComputed,
    isTauri,
  } = useAppContext()

  if (!vibrancyDebugOpen) return null

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 9999, pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          width: 420,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: 'calc(100vh - 32px)',
          overflowY: 'auto',
          pointerEvents: 'auto',
          borderRadius: 12,
          padding: 12,
          background: 'rgba(20, 20, 24, 0.88)',
          border: '1px solid rgba(255,255,255,0.12)',
          color: 'rgba(255,255,255,0.92)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Inter, Arial',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ fontWeight: 700, fontSize: 13 }}>Vibrancy Diagnostics</div>
          <button
            type="button"
            onClick={() => setVibrancyDebugOpen(false)}
            style={{ fontSize: 12, padding: '6px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.14)' }}
          >
            Close
          </button>
        </div>

        <div style={{ marginTop: 8, fontSize: 11, opacity: 0.7 }}>
          Toggle: Cmd/Ctrl+Shift+V
        </div>

        <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
            <input type="checkbox" checked={vibrancyForceOpaque} onChange={(e) => setVibrancyForceOpaque(!!e.target.checked)} />
            Force opaque
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
            <input type="checkbox" checked={vibrancyActive} readOnly />
            vibrancy-active
          </label>
        </div>

        {/* Runtime status */}
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>Runtime</div>
          <div style={{ fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
            <div>isTauri: {String(isTauri)}</div>
            {vibrancyDebugError && <div style={{ color: '#ffa0a0' }}>error: {vibrancyDebugError}</div>}
            {vibrancyDebug && <>
              <div>platform: {vibrancyDebug.platform} | supported: {String(vibrancyDebug.supported)}</div>
              <div>attempted: {String(vibrancyDebug.attempted)} | applied: {String(vibrancyDebug.applied)}</div>
              <div>effect: {String(vibrancyDebug.effect ?? '-')}</div>
              <div>blur: {String(vibrancyDebug.blur ?? '-')}</div>
              {vibrancyDebug.error && <div style={{ color: '#ffa0a0' }}>error: {vibrancyDebug.error}</div>}
            </>}
          </div>
        </div>

        {/* Computed CSS */}
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4 }}>Computed CSS</div>
          {vibrancyComputed ? (
            <div style={{ fontSize: 11, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
              <div>html: {vibrancyComputed.htmlBg}</div>
              <div>body: {vibrancyComputed.bodyBg}</div>
              <div>#root: {vibrancyComputed.rootBg}</div>
              <div>reduced-transparency: {String(vibrancyComputed.prefersReducedTransparency)}</div>
            </div>
          ) : <div style={{ fontSize: 11, opacity: 0.6 }}>Loading…</div>}
        </div>

        {/* Live material switcher */}
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Switch material (live)</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {['under_window_background', 'hud', 'fullscreen_ui', 'sidebar', 'window_background', 'titlebar', 'tooltip', 'content_background', 'sheet', 'menu'].map((mat) => (
              <button
                key={mat}
                type="button"
                onClick={async () => {
                  const invoke = window?.tauriAPI?.core?.invoke || window?.__TAURI__?.core?.invoke || window?.__TAURI_INTERNALS__?.core?.invoke
                  if (!invoke) return
                  try {
                    const info = await invoke('vibrancy_debug_apply', { args: { effect: mat, blur: 24 } })
                    setVibrancyDebug(info)
                    if (info?.applied) {
                      document.documentElement.classList.add('vibrancy-active')
                      setVibrancyActive(true)
                    }
                  } catch (err) { setVibrancyDebugError(String(err?.message || err)) }
                }}
                style={{
                  fontSize: 10,
                  padding: '3px 7px',
                  borderRadius: 6,
                  background: (vibrancyDebug?.effect || '').toLowerCase().replace(/[^a-z]/g, '').includes(mat.replace(/_/g, ''))
                    ? 'rgba(120,80,255,0.5)' : 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.12)',
                  cursor: 'pointer',
                }}
              >
                {mat}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
