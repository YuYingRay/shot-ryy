import { useEffect, useState } from 'react'

/**
 * Manages vibrancy state, activation, and debug panel.
 * @param {{ isTauri: boolean }} params
 */
export function useVibrancy({ isTauri }) {
  const [vibrancyActive, setVibrancyActive] = useState(() => {
    try {
      return !!document?.documentElement?.classList?.contains('vibrancy-active')
    } catch {
      return false
    }
  })
  const [vibrancyDebugOpen, setVibrancyDebugOpen] = useState(false)
  const [vibrancyForceOpaque, setVibrancyForceOpaque] = useState(false)
  const [vibrancyDebug, setVibrancyDebug] = useState(null)
  const [vibrancyDebugError, setVibrancyDebugError] = useState(null)
  const [vibrancyComputed, setVibrancyComputed] = useState(null)

  // Vibrancy activation: ask back-end whether vibrancy applied,
  // then flip html.vibrancy-active so CSS switches to transparent.
  useEffect(() => {
    if (!isTauri) return
    let cancelled = false
    const check = async () => {
      const invoke =
        window?.tauriAPI?.core?.invoke ||
        window?.__TAURI__?.core?.invoke ||
        window?.__TAURI_INTERNALS__?.core?.invoke
      if (!invoke) return
      try {
        const info = await invoke('vibrancy_debug_status')
        if (!cancelled && info?.applied) {
          document.documentElement.classList.add('vibrancy-active')
          setVibrancyActive(true)
        }
      } catch {}
    }
    // Small delay so the native layer has finished setup.
    const t = setTimeout(check, 20)
    return () => { cancelled = true; clearTimeout(t) }
  }, [isTauri])

  // Toggle vibrancy debug panel with Cmd/Ctrl+Shift+V
  useEffect(() => {
    const handleKeyDown = (e) => {
      const key = String(e.key || '').toLowerCase()
      const wantsToggle = (e.metaKey || e.ctrlKey) && e.shiftKey && key === 'v'
      if (!wantsToggle) return
      e.preventDefault()
      setVibrancyDebugOpen((prev) => !prev)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Apply force-opaque to html data attribute
  useEffect(() => {
    try {
      if (vibrancyForceOpaque) {
        document.documentElement.dataset.vibrancyForceOpaque = '1'
      } else {
        delete document.documentElement.dataset.vibrancyForceOpaque
      }
    } catch {}
  }, [vibrancyForceOpaque])

  // Poll vibrancy debug status while panel is open
  useEffect(() => {
    if (!vibrancyDebugOpen) return
    let cancelled = false

    const getInvoke = () => {
      return (
        window?.tauriAPI?.core?.invoke ||
        window?.__TAURI__?.core?.invoke ||
        window?.__TAURI_INTERNALS__?.core?.invoke
      )
    }

    const tick = async () => {
      try {
        const htmlBg = getComputedStyle(document.documentElement).backgroundColor
        const bodyBg = getComputedStyle(document.body).backgroundColor
        const rootEl = document.getElementById('root')
        const rootBg = rootEl ? getComputedStyle(rootEl).backgroundColor : '(missing #root)'
        const prefersReducedTransparency = (() => {
          try {
            return !!window.matchMedia('(prefers-reduced-transparency: reduce)')?.matches
          } catch {
            return null
          }
        })()

        if (!cancelled) {
          setVibrancyComputed({
            htmlBg,
            bodyBg,
            rootBg,
            prefersReducedTransparency,
            userAgent: navigator.userAgent,
            devicePixelRatio: window.devicePixelRatio,
          })
        }
      } catch {}

      const invoke = getInvoke()
      if (!invoke) {
        if (!cancelled) {
          setVibrancyDebug(null)
          setVibrancyDebugError('Tauri invoke() not available in this context')
        }
        return
      }

      try {
        const info = await invoke('vibrancy_debug_status')
        if (!cancelled) {
          setVibrancyDebug(info)
          setVibrancyDebugError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setVibrancyDebug(null)
          setVibrancyDebugError(String(err?.message || err))
        }
      }
    }

    tick()
    const id = window.setInterval(tick, 1000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [vibrancyDebugOpen])

  return {
    vibrancyActive,
    setVibrancyActive,
    vibrancyDebugOpen,
    setVibrancyDebugOpen,
    vibrancyForceOpaque,
    setVibrancyForceOpaque,
    vibrancyDebug,
    setVibrancyDebug,
    vibrancyDebugError,
    setVibrancyDebugError,
    vibrancyComputed,
  }
}
