const isTauriRuntime = () => {
  try {
    return !!(window?.__TAURI_INTERNALS__ || window?.__TAURI__ || window?.tauriAPI)
  } catch {
    return false
  }
}

const getInvoke = () => {
  try {
    return (
      window?.tauriAPI?.core?.invoke ||
      window?.__TAURI__?.core?.invoke ||
      window?.__TAURI_INTERNALS__?.core?.invoke ||
      null
    )
  } catch {
    return null
  }
}

const applyCssVars = ({ alpha, blurPx, saturate }) => {
  const html = document.documentElement
  html.style.setProperty('--shotstyle-vibrancy-surface', `rgba(18,18,24,${alpha})`)
  html.style.setProperty('--shotstyle-vibrancy-blur', `${blurPx}px`)
  html.style.setProperty('--shotstyle-vibrancy-saturate', String(saturate))
}

export async function applyDevVibrancyTuning() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false
  if (!isTauriRuntime()) return false

  const html = document.documentElement
  html.classList.add('vibrancy-active')

  const prefersReducedTransparency = (() => {
    try {
      return !!window.matchMedia('(prefers-reduced-transparency: reduce)')?.matches
    } catch {
      return false
    }
  })()

  if (prefersReducedTransparency) {
    applyCssVars({ alpha: 0.78, blurPx: 0, saturate: 1 })
    html.dataset.vibrancyMode = 'reduced-transparency'
    return true
  }

  applyCssVars({ alpha: 0, blurPx: 30, saturate: 1.45 })
  html.dataset.vibrancyMode = 'fallback'

  const invoke = getInvoke()
  if (!invoke) return true

  try {
    const info = await invoke('vibrancy_debug_status')
    if (info?.applied) {
      html.dataset.vibrancyMode = 'native'
      applyCssVars({ alpha: 0, blurPx: 32, saturate: 1.5 })
    }
  } catch {
    // Keep fallback CSS-only glass behavior.
  }

  return true
}
