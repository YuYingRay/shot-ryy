import { useCallback, useEffect, useState } from 'react'
import { installTauriApi } from '../../../utils/platform/tauriApi'
import { trimMacOsWindowScreenshotDataUrl } from '../../../utils/export/imageProcessor'
import { defaultShortcuts } from '../../../utils/platform/preferences'
import { readFileAsDataUrlWithRetry } from '../../../utils/export/readFileAsDataUrlWithRetry'

/**
 * Manages the screenshot-captured event listener on the Tauri API.
 * @param {{ shortcuts: object, setIsTauri: Function, setBlob: Function, setTransform: Function, setAnnotationTool: Function, rootFocusRef: object, pushToast: Function }} params
 */
export function useScreenshotCapture({
  shortcuts,
  setIsTauri,
  setBlob,
  setTransform,
  setAnnotationTool,
  rootFocusRef,
  pushToast,
}) {
  useEffect(() => {
    let offCaptured = null
    let offError = null
    let cancelled = false

    const run = async () => {
      await installTauriApi()
      if (cancelled) return

      const api = window?.tauriAPI
      if (!api) return

      setIsTauri(true)

      // Ensure the default shortcuts are registered for this UI.
      try {
        await api.updateShortcuts?.({
          regionShortcut: shortcuts?.screenshotRegion || defaultShortcuts.screenshotRegion,
          instantShortcut: shortcuts?.screenshotRegionCopy || defaultShortcuts.screenshotRegionCopy,
          windowShortcut: '',
        })
      } catch {}

      const handleScreenshotCaptured = async (payload = {}) => {
        const dataUrl = payload?.dataUrl ?? payload?.data_url
        const filePath = payload?.filePath ?? payload?.file_path
        const intent = payload?.intent
        const shouldFocus = intent !== 'copyOutput'
        const shouldAutoCopy = intent === 'copyOutput'

        const applySrc = async (src) => {
          if (!src || typeof src !== 'string') return

          const cleaned = (src.startsWith('data:image/'))
            ? await trimMacOsWindowScreenshotDataUrl(src)
            : src

          setBlob({ src: cleaned, w: 0, h: 0 })
          setTransform({ x: 0, y: 0 })
          setAnnotationTool(null)

          try {
            const img = new Image()
            img.onload = () => {
              const w = Number(img.naturalWidth) || 0
              const h = Number(img.naturalHeight) || 0
              setBlob((prev) => (prev?.src === cleaned ? { ...prev, w, h } : prev))
            }
            img.src = cleaned
          } catch {}

          if (shouldFocus) {
            try { rootFocusRef.current?.focus?.({ preventScroll: true }) } catch {}
          }

          if (shouldAutoCopy && src.startsWith('data:image/') && typeof api?.writeClipboardImage === 'function') {
            try {
              await api.writeClipboardImage(src)
              pushToast('Copied screenshot to clipboard', { variant: 'success' })
            } catch (copyErr) {
              pushToast(`Copy failed: ${copyErr?.message || String(copyErr)}`, { variant: 'error', durationMs: 4200 })
            }
          }
        }

        if (filePath && typeof api.readFileAsDataUrl === 'function') {
          try {
            const url = await readFileAsDataUrlWithRetry(api.readFileAsDataUrl, filePath)
            await applySrc(url)
            return
          } catch (e) {
            try { console.warn('[ui-exp] readFileAsDataUrl failed; falling back', e) } catch {}
          }
        }

        if (typeof dataUrl === 'string' && dataUrl.length) {
          await applySrc(dataUrl)
          return
        }

        const fallback = (filePath && typeof api.filePathToAssetUrl === 'function')
          ? api.filePathToAssetUrl(filePath)
          : null
        await applySrc(fallback)
      }

      offCaptured = api.onScreenshotCaptured?.(handleScreenshotCaptured)

      const bootPayload = window?.__SHOTSTYLE_BOOT_PAYLOAD
      if (bootPayload && typeof bootPayload === 'object') {
        try { delete window.__SHOTSTYLE_BOOT_PAYLOAD } catch { window.__SHOTSTYLE_BOOT_PAYLOAD = null }
        await handleScreenshotCaptured(bootPayload)
      }

      offError = api.onScreenshotError?.((payload) => {
        try { console.error('Screenshot error:', payload) } catch {}
      })
    }

    run().catch(() => {})
    return () => {
      cancelled = true
      try { offCaptured && offCaptured() } catch {}
      try { offError && offError() } catch {}
    }
  }, [shortcuts?.screenshotRegion, shortcuts?.screenshotRegionCopy]) // eslint-disable-line react-hooks/exhaustive-deps
}
