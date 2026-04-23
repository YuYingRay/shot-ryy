import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../../../components/context/I18nContext'
import { installTauriApi } from '../../../utils/platform/tauriApi'
import { trimMacOsWindowScreenshotDataUrl } from '../../../utils/export/imageProcessor'
import { copyImage as copyImageUtil, compositeAnnotationsOnBlob, createExportableSnapshot, saveImageAdvanced, scaleAndEncodeBlob } from '../../../utils/export/imageProcessor'
import { readFileAsDataUrlWithRetry } from '../../../utils/export/readFileAsDataUrlWithRetry'
import { getJson, setJson } from '../../../utils/platform/safeStorage'
import { formatExportErrorMessage, getDesktopApi } from '../AppHelpers'

/**
 * Provides export functions and related state.
 */
export function useExportFunctions({
  blob,
  imageOptions,
  exportScale,
  exportFormat,
  exportQuality,
  exportRef,
  appWindow,
  generalSettings,
  pushToast,
  setBlob,
  setTransform,
  setAnnotationTool,
  rootFocusRef,
  annotationActionsRef,
}) {
  const { t } = useI18n()
  const [exportFolderPath, setExportFolderPath] = useState(() => {
    try {
      return getJson('uiExp.exportFolderPath', null)
    } catch {
      return null
    }
  })
  const [exportBusy, setExportBusy] = useState(false)
  const [exportDrawerOpen, setExportDrawerOpen] = useState(false)
  const exportDrawerRef = useRef(null)

  // Close export drawer on outside click
  useEffect(() => {
    if (!exportDrawerOpen) return
    const handler = (e) => {
      if (exportDrawerRef.current && !exportDrawerRef.current.contains(e.target)) {
        setExportDrawerOpen(false)
      }
    }
    document.addEventListener('pointerdown', handler, true)
    return () => document.removeEventListener('pointerdown', handler, true)
  }, [exportDrawerOpen])

  const pickExportFolder = useCallback(async () => {
    const api = window?.tauriAPI
    if (!api?.pickDirectory) return null
    let picked = null
    try {
      picked = await api.pickDirectory({ title: t('settingsSavingToFolder') })
    } catch (e) {
      pushToast(`${t('exportFolderPickFailed')}: ${e?.message || String(e)}`, { variant: 'error', durationMs: 3500 })
      return null
    }
    if (picked) {
      try { setJson('uiExp.exportFolderPath', picked) } catch {}
      setExportFolderPath(picked)
      pushToast(t('exportFolderSet'), { variant: 'success' })
      return picked
    }
    return null
  }, [pushToast])

  const buildDefaultExportFileName = useCallback(() => {
    const ts = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const stamp = `${ts.getFullYear()}-${pad(ts.getMonth() + 1)}-${pad(ts.getDate())}_${pad(ts.getHours())}-${pad(ts.getMinutes())}-${pad(ts.getSeconds())}`
    const ext = exportFormat === 'jpeg' ? 'jpg' : exportFormat
    return `shotstyle-${stamp}.${ext}`
  }, [exportFormat])

  const waitForAnimationFrames = useCallback(async (count = 2) => {
    const frames = Math.max(1, Math.floor(Number(count) || 1))
    for (let index = 0; index < frames; index += 1) {
      await new Promise((resolve) => {
        requestAnimationFrame(() => resolve())
      })
    }
  }, [])

  const getExportElement = useCallback(() => exportRef?.current || null, [exportRef])

  const runWithFrozenPreview = useCallback(async (work) => {
    if (exportBusy) return
    setExportBusy(true)
    try {
      await waitForAnimationFrames(2)
      await work()
    } finally {
      window.setTimeout(() => {
        setExportBusy(false)
      }, 120)
    }
  }, [exportBusy, waitForAnimationFrames])

  const saveToFolder = useCallback(async () => {
    await runWithFrozenPreview(async () => {
      try {
        if (!blob?.src) {
          pushToast(t('nothingToExport'), { variant: 'error' })
          return
        }

        const api = window?.tauriAPI
        const folder = exportFolderPath || (await pickExportFolder())
        if (!folder) return

        const exportEl = getExportElement()
        if (!exportEl) return

        const annotations = annotationActionsRef?.current?.getAnnotations?.()
        const hasAnnotations = !!(annotations?.strokes?.length || annotations?.texts?.length)

        const snapshotBlob = await createExportableSnapshot(exportEl, {
          editorOptions: imageOptions,
          hideAnnotations: hasAnnotations,
        })

        let composited = hasAnnotations
          ? await compositeAnnotationsOnBlob(snapshotBlob, annotations, { penColor: imageOptions?.pen?.color })
          : snapshotBlob

        let finalBlob = composited
        if (exportScale !== 1 || exportFormat !== 'png') {
          try {
            finalBlob = await scaleAndEncodeBlob(composited, { scale: exportScale, format: exportFormat, quality: exportQuality })
          } catch {}
        }

        const dataUrl = await new Promise((resolve, reject) => {
          try {
            const r = new FileReader()
            r.onerror = () => reject(new Error('Failed to read export blob'))
            r.onload = () => resolve(String(r.result || ''))
            r.readAsDataURL(finalBlob)
          } catch (e) {
            reject(e)
          }
        })

        const fileName = buildDefaultExportFileName()
        if (api?.saveExportedImageToFolder) {
          await api.saveExportedImageToFolder({ dataUrl, folderPath: folder, fileName })
          pushToast(`${t('settingsSavingImage')}: ${fileName}`, { variant: 'success' })
          if (generalSettings?.closeAfterSaveToFolder) {
            try { await (getDesktopApi()?.hideMainWindow?.() || appWindow?.hide?.()) } catch {}
          }
          return
        }

        if (api?.saveExportedImage) {
          await api.saveExportedImage({ dataUrl, fileName })
          pushToast(`${t('settingsSavingImage')}: ${fileName}`, { variant: 'success' })
          if (generalSettings?.closeAfterSaveToFolder) {
            try { await (getDesktopApi()?.hideMainWindow?.() || appWindow?.hide?.()) } catch {}
          }
          return
        }

        pushToast(t('saveNotAvailable'), { variant: 'error', durationMs: 3500 })
      } catch (e) {
        pushToast(formatExportErrorMessage('Save', e), { variant: 'error', durationMs: 4500 })
      }
    })
  }, [annotationActionsRef, appWindow, blob?.src, buildDefaultExportFileName, exportFolderPath, exportFormat, exportQuality, exportScale, generalSettings?.closeAfterSaveToFolder, imageOptions, pickExportFolder, pushToast, runWithFrozenPreview])

  const copyOutput = useCallback(async () => {
    await runWithFrozenPreview(async () => {
      try {
        if (!blob?.src) {
          pushToast(t('nothingToCopy'), { variant: 'error' })
          return
        }
        const exportEl = getExportElement()
        if (!exportEl) {
          pushToast(t('nothingToCopy'), { variant: 'error' })
          return
        }
        const annotations = annotationActionsRef?.current?.getAnnotations?.()
        await copyImageUtil({ current: exportEl }, blob, imageOptions, {
          annotations: annotations?.strokes?.length || annotations?.texts?.length ? annotations : null,
          penColor: imageOptions?.pen?.color,
        })
        pushToast(t('copiedToClipboard'), { variant: 'success' })
        if (generalSettings?.closeAfterCopy) {
          try { await (getDesktopApi()?.hideMainWindow?.() || appWindow?.hide?.()) } catch {}
        }
      } catch (e) {
        pushToast(formatExportErrorMessage('Copy', e), { variant: 'error', durationMs: 4500 })
      }
    })
  }, [annotationActionsRef, appWindow, blob, generalSettings?.closeAfterCopy, imageOptions, pushToast, runWithFrozenPreview])

  const saveOutput = useCallback(async () => {
    await runWithFrozenPreview(async () => {
      try {
        if (!blob?.src) {
          pushToast(t('nothingToSave'), { variant: 'error' })
          return
        }
        const exportEl = getExportElement()
        if (!exportEl) {
          pushToast(t('nothingToSave'), { variant: 'error' })
          return
        }
        const fileName = buildDefaultExportFileName()
        const annotations = annotationActionsRef?.current?.getAnnotations?.()
        await saveImageAdvanced({ current: exportEl }, blob, {
          fileName,
          scale: exportScale,
          format: exportFormat,
          quality: exportQuality,
        }, imageOptions, {
          annotations: annotations?.strokes?.length || annotations?.texts?.length ? annotations : null,
          penColor: imageOptions?.pen?.color,
        })
        pushToast(`${t('settingsSavingImage')}: ${fileName}`, { variant: 'success' })
        if (generalSettings?.closeAfterSave) {
          try { await (getDesktopApi()?.hideMainWindow?.() || appWindow?.hide?.()) } catch {}
        }
      } catch (e) {
        pushToast(formatExportErrorMessage('Save', e), { variant: 'error', durationMs: 4500 })
      }
    })
  }, [annotationActionsRef, appWindow, blob, buildDefaultExportFileName, exportFormat, exportQuality, exportScale, generalSettings?.closeAfterSave, imageOptions, pushToast, runWithFrozenPreview])

  const applyCapturedSource = useCallback(async (src, { shouldFocus = true } = {}) => {
    if (!src || typeof src !== 'string') return
    const cleaned = src.startsWith('data:image/')
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
  }, [rootFocusRef, setAnnotationTool, setBlob, setTransform])

  const takeScreenshot = useCallback(async () => {
    try {
      await installTauriApi()
      const api = window?.tauriAPI
      if (!api?.captureScreenshotToFile) {
        pushToast(t('screenshotDesktopOnly'), { variant: 'error', durationMs: 3600 })
        return
      }

      const result = await api.captureScreenshotToFile({ mode: 'region' })
      if (typeof result !== 'string' || !result) return
      if (result === 'overlay-opened') return

      if (result.startsWith('data:image/')) {
        await applyCapturedSource(result, { shouldFocus: true })
        return
      }

      if (typeof api.readFileAsDataUrl === 'function') {
        const dataUrl = await readFileAsDataUrlWithRetry(api.readFileAsDataUrl, result)
        if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
          await applyCapturedSource(dataUrl, { shouldFocus: true })
        }
      }
    } catch (e) {
      pushToast(`${t('screenshotFailed')}: ${e?.message || String(e)}`, { variant: 'error', durationMs: 4200 })
    }
  }, [applyCapturedSource, pushToast])

  return {
    exportFolderPath,
    exportBusy,
    exportDrawerOpen,
    setExportDrawerOpen,
    exportDrawerRef,
    pickExportFolder,
    buildDefaultExportFileName,
    waitForAnimationFrames,
    getExportElement,
    runWithFrozenPreview,
    saveToFolder,
    copyOutput,
    saveOutput,
    applyCapturedSource,
    takeScreenshot,
  }
}
