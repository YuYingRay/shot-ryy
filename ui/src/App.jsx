import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import { AnimatePresence, motion } from 'framer-motion'
import { TooltipProvider } from "@/components/ui/tooltip"
import { ThemeProvider } from '../../components/context/ThemeContext.jsx'
import SettingsModal from '../../components/dialogs/SettingsModal.jsx'
import { normalizeShortcuts } from '../../utils/platform/shortcuts'
import { getJson, setJson } from '../../utils/platform/safeStorage'
import { isProbablyHexColor, normalizeHexColorInput } from '../../utils/color/colorInput.js'

import {
  formatExportErrorMessage,
  getDesktopApi,
  getNativeInvoke,
  makeRandomDefaultBackgroundSelection,
  DEFAULT_GENERAL_SETTINGS,
  sanitizeCustomShadowState,
} from './AppHelpers'
import { AppContext } from './AppContext'
import Sidebar from './Sidebar'
import AnnotationBar from './AnnotationBar'
import ExportFooter from './ExportFooter'
import PresetSelectorTopRight from './PresetSelectorTopRight'
import PresetSaveDialog from './PresetSaveDialog'
import VibrancyDebugPanel from './VibrancyDebugPanel'
import CenterPreview from './CenterPreview'

import { useGradients } from './hooks/useGradients'
import { useSystemWallpapers } from './hooks/useSystemWallpapers'
import { useVibrancy } from './hooks/useVibrancy'
import { useLayoutEffects } from './hooks/useLayoutEffects'
import { usePresets } from './hooks/usePresets'
import { useExportFunctions } from './hooks/useExportFunctions'
import { useScreenshotCapture } from './hooks/useScreenshotCapture'
import { useShortcuts } from './hooks/useShortcuts'

import osMac1Thumb from '../os-mockup-mac-1-thumb.png'
import osMac2Thumb from '../os-mockup-mac-2-thumb.png'
import osWin1Thumb from '../os-mockup-win-1-thumb.png'
import osWin2Thumb from '../os-mockup-win-2-thumb.png'
import osSafari1Thumb from '../os-mockup-safari-1-thumb.png'

const App = () => {
  // Platform detection
  const [isTauri, setIsTauri] = useState(false)
  const [isWindows, setIsWindows] = useState(false)
  const [isMac, setIsMac] = useState(false)
  const [appWindow, setAppWindow] = useState(null)
  const launchHideAppliedRef = useRef(false)
  const rootFocusRef = useRef(null)

  useEffect(() => {
    const el = rootFocusRef.current
    if (!el) return
    const raf = requestAnimationFrame(() => {
      try { el.focus({ preventScroll: true }) } catch (_) { try { el.focus() } catch (_2) {} }
    })
    return () => cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    try {
      setIsTauri(!!(window?.__TAURI_INTERNALS__ || window?.__TAURI__ || window?.tauriAPI))
      setIsWindows(!!(window?.platform?.isWindows ?? /Win/i.test(navigator.platform || '')))
      setIsMac(!!(window?.platform?.isMac ?? /Mac|iPhone|iPad|iPod/i.test(navigator.platform || '')))
      const root = document?.documentElement
      if (root) {
        const mac = !!(window?.platform?.isMac ?? /Mac|iPhone|iPad|iPod/i.test(navigator.platform || ''))
        root.classList.toggle('platform-mac', mac)
        root.classList.toggle('platform-windows', !!(window?.platform?.isWindows ?? /Win/i.test(navigator.platform || '')))
        root.classList.toggle('platform-linux', !!(window?.platform?.isLinux ?? /Linux/i.test(navigator.platform || '')))
      }
    } catch (_) {
      setIsTauri(false); setIsWindows(false); setIsMac(false)
    }
  }, [])

  useEffect(() => {
    if (!isTauri) { setAppWindow(null); return }
    let cancelled = false
    ;(async () => {
      try {
        const mod = await import('@tauri-apps/api/window')
        const current = mod?.getCurrentWindow?.()
        if (!cancelled && current) setAppWindow(current)
      } catch (_) { if (!cancelled) setAppWindow(null) }
    })()
    return () => { cancelled = true }
  }, [isTauri])

  // Toast notifications
  const [toasts, setToasts] = useState([])
  const pushToast = useCallback((message, { variant = 'success', durationMs = 2200 } = {}) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    setToasts((prev) => [...prev, { id, message: String(message || ''), variant }])
    window.setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      Math.max(800, Number(durationMs) || 2200)
    )
  }, [])

  // Vibrancy
  const vibrancy = useVibrancy({ isTauri })
  const {
    vibrancyActive, setVibrancyActive,
    vibrancyDebugOpen, setVibrancyDebugOpen,
    vibrancyForceOpaque, setVibrancyForceOpaque,
    vibrancyDebug, setVibrancyDebug,
    vibrancyDebugError, setVibrancyDebugError,
    vibrancyComputed,
  } = vibrancy

  // Settings
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [generalSettings, setGeneralSettings] = useState(() => {
    try {
      const raw = getJson('settings.general', {})
      return { ...DEFAULT_GENERAL_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) }
    } catch (_) { return { ...DEFAULT_GENERAL_SETTINGS } }
  })
  const [autoHideEnabled, setAutoHideEnabled] = useState(() => {
    try {
      const g = getJson('settings.general', null)
      if (g && typeof g === 'object' && typeof g.hideAppWhenUnfocused === 'boolean') return !!g.hideAppWhenUnfocused
      return !!getJson('settings.autoHideEnabled', true)
    } catch (_) { return true }
  })
  const autoHideSuspendedForFileDialogRef = useRef(false)

  useEffect(() => {
    if (!isTauri) return
    let unlisten
    ;(async () => {
      try {
        const listen = window?.__TAURI__?.event?.listen || window?.__TAURI_INTERNALS__?.event?.listen
        if (listen) unlisten = await listen('open-settings', () => setSettingsOpen(true))
      } catch (_) {}
    })()
    return () => { if (unlisten) unlisten() }
  }, [isTauri])

  useEffect(() => {
    setGeneralSettings((prev) => {
      if (prev.hideAppWhenUnfocused === !!autoHideEnabled) return prev
      const next = { ...prev, hideAppWhenUnfocused: !!autoHideEnabled }
      try { setJson('settings.general', next) } catch (_) {}
      return next
    })
  }, [autoHideEnabled])

  useEffect(() => {
    try { setJson('settings.autoHideEnabled', !!autoHideEnabled) } catch (_) {}
    try { setJson('settings.general', { ...generalSettings, hideAppWhenUnfocused: !!autoHideEnabled }) } catch (_) {}
    if (autoHideSuspendedForFileDialogRef.current) return
    const api = getDesktopApi()
    if (api?.setAutoHideEnabled) { try { api.setAutoHideEnabled(!!autoHideEnabled) } catch (_) {}; return }
    const invoke = getNativeInvoke()
    if (invoke) try { invoke('app_set_auto_hide_enabled', { args: { enabled: !!autoHideEnabled } }) } catch (_) {}
  }, [autoHideEnabled, generalSettings])

  useEffect(() => {
    if (!isTauri) return
    const run = async () => {
      const keepInTray = !!generalSettings?.keepAppInTray
      const openAtLogin = !!generalSettings?.openAtLogin
      const hideDock = !!generalSettings?.hideDockIconWhenHidden
      const api = getDesktopApi()
      if (api) {
        try { await api?.setKeepInTrayEnabled?.(keepInTray) } catch (_) {}
        try { await api?.setOpenAtLoginEnabled?.(openAtLogin) } catch (_) {}
        try { await api?.setHideDockIconWhenHiddenEnabled?.(hideDock) } catch (_) {}
        return
      }
      const invoke = getNativeInvoke()
      if (!invoke) return
      try { await invoke('app_set_keep_in_tray_enabled', { args: { enabled: keepInTray } }) } catch (_) {}
      try { await invoke('app_set_open_at_login_enabled', { args: { enabled: openAtLogin } }) } catch (_) {}
      try { await invoke('app_set_hide_dock_icon_when_hidden_enabled', { args: { enabled: hideDock } }) } catch (_) {}
    }
    let cancelled = false; let attempts = 0
    const loop = async () => {
      if (cancelled) return
      await run()
      if (!getDesktopApi() && attempts < 10 && !cancelled) { attempts++; setTimeout(loop, 120) }
    }
    loop().catch(() => {})
    return () => { cancelled = true }
  }, [isTauri, generalSettings?.keepAppInTray, generalSettings?.openAtLogin, generalSettings?.hideDockIconWhenHidden])

  useEffect(() => {
    if (!isTauri || launchHideAppliedRef.current) return
    launchHideAppliedRef.current = true
    if (!generalSettings?.hideWindowOnLaunch) return
    const hide = async () => {
      const api = getDesktopApi()
      if (api?.hideMainWindow) { try { await api.hideMainWindow(); return } catch (_) {} }
      try { await appWindow?.hide?.() } catch (_) {}
    }
    const t = setTimeout(() => hide().catch(() => {}), 180)
    return () => clearTimeout(t)
  }, [isTauri, generalSettings?.hideWindowOnLaunch, appWindow])

  // Blob / transform
  const [blob, setBlob] = useState(null)
  const blobRef = useRef(null)
  useEffect(() => { blobRef.current = blob }, [blob])
  const [transform, setTransform] = useState({ x: 0, y: 0 })

  // Background / wallpaper
  const [wallpaperType, setWallpaperType] = useState(() => {
    try {
      const t = String(getJson('uiExp.backgroundState', null)?.wallpaperType || '')
      if (['system','gradients','colors','image'].includes(t)) return t
    } catch (_) {}
    return 'gradients'
  })
  const [pressedWallpaperTab, setPressedWallpaperTab] = useState(null)
  const [backgroundSelection, setBackgroundSelection] = useState(() => {
    try {
      const sel = getJson('uiExp.backgroundState', null)?.backgroundSelection
      if (sel && typeof sel === 'object') return sel
    } catch (_) {}
    return makeRandomDefaultBackgroundSelection()
  })
  const [customGradient, setCustomGradient] = useState(() => {
    const g = backgroundSelection?.gradient
    return (g && typeof g === 'object')
      ? { colorStart: String(g.colorStart || '#7C3AED'), colorEnd: String(g.colorEnd || '#EC4899'), angleDeg: Number(g.angleDeg || 135) }
      : { colorStart: '#7C3AED', colorEnd: '#EC4899', angleDeg: 135 }
  })
  const defaultBackgroundSelection = useMemo(() => makeRandomDefaultBackgroundSelection(), [])

  useEffect(() => {
    try { setJson('uiExp.backgroundState', { wallpaperType, backgroundSelection }) } catch (_) {}
  }, [wallpaperType, backgroundSelection])

  // Ratio
  const [ratioChoice, setRatioChoice] = useState(() => {
    const s = getJson('ui-exp:ratio', null)
    return s && typeof s === 'object' ? String(s.value || 'auto') : 'auto'
  })
  const [customRatio, setCustomRatio] = useState(() => {
    const s = getJson('ui-exp:ratio', null)
    const w = Number(s?.custom?.w); const h = Number(s?.custom?.h)
    return { w: (Number.isFinite(w) && w > 0) ? Math.round(w) : 16, h: (Number.isFinite(h) && h > 0) ? Math.round(h) : 9 }
  })
  useEffect(() => { setJson('ui-exp:ratio', { value: ratioChoice, custom: customRatio }) }, [ratioChoice, customRatio])

  // Image adjustments
  const [padding, setPadding] = useState(32)
  const [inset, setInset] = useState(0)
  const [curve, setCurve] = useState(30)
  const [border, setBorder] = useState(0)
  const [borderColor, setBorderColor] = useState('#ffffff')
  const [tiltX, setTiltX] = useState(0)
  const [tiltY, setTiltY] = useState(0)
  const [rotation, setRotation] = useState(0)
  const [draggingPadding, setDraggingPadding] = useState(false)
  const [draggingInset, setDraggingInset] = useState(false)
  const [draggingCurve, setDraggingCurve] = useState(false)
  const [draggingBorder, setDraggingBorder] = useState(false)
  const [draggingUiScale, setDraggingUiScale] = useState(false)
  const [draggingTiltX, setDraggingTiltX] = useState(false)
  const [draggingTiltY, setDraggingTiltY] = useState(false)
  const [draggingRotation, setDraggingRotation] = useState(false)
  const [annotationTool, setAnnotationTool] = useState(null)
  const [annotationColor, setAnnotationColor] = useState('#7c3aed')
  const [shapeMode, setShapeMode] = useState('rect')
  const annotationActionsRef = useRef(null)

  // OS Mockups
  const [osMockups] = useState([
    { id: 'mac-1', src: osMac1Thumb, label: 'Mac Light' },
    { id: 'mac-2', src: osMac2Thumb, label: 'Mac Dark' },
    { id: 'win-2', src: osWin2Thumb, label: 'Windows L' },
    { id: 'win-1', src: osWin1Thumb, label: 'Windows D' },
    { id: 'safari-1', src: osSafari1Thumb, label: 'Safari' },
  ])
  const [selectedOsMockup, setSelectedOsMockup] = useState('none')
  const [safariMockupText, setSafariMockupText] = useState(() => {
    try { return String(getJson('uiExp.safariMockupText', '') || '').trim() } catch (_) { return '' }
  })
  useEffect(() => { try { setJson('uiExp.safariMockupText', safariMockupText) } catch (_) {} }, [safariMockupText])

  const browserBarForOsMockup = useMemo(() => {
    switch (selectedOsMockup) {
      case 'mac-1': return 'mac-light'
      case 'mac-2': return 'mac-dark'
      case 'win-2': return 'windows-light'
      case 'win-1': return 'windows-dark'
      case 'safari-1': return 'safari-dark'
      default: return 'hidden'
    }
  }, [selectedOsMockup])

  // Shadow
  const [selectedShadowStyle, setSelectedShadowStyle] = useState('Hug')
  const [customShadow, setCustomShadow] = useState(() => {
    try {
      const s = getJson('uiExp.customShadow', null)
      if (s && typeof s === 'object') return sanitizeCustomShadowState(s)
    } catch (_) {}
    return sanitizeCustomShadowState(null)
  })
  useEffect(() => { try { setJson('uiExp.customShadow', customShadow) } catch (_) {} }, [customShadow])

  // Misc UI
  const [autoCropEnabled, setAutoCropEnabled] = useState(true)
  const [uiScale, setUiScale] = useState(1)
  const [isAdvancedOpen, setIsAdvancedOpen] = useState(true)

  // Watermark
  const [watermarkEnabled, setWatermarkEnabled] = useState(false)
  const [watermarkText, setWatermarkText] = useState('Made with shot.style')
  const [watermarkPosition, setWatermarkPosition] = useState('inside')
  const [watermarkPrefix, setWatermarkPrefix] = useState('none')
  const [watermarkOffsetX, setWatermarkOffsetX] = useState(0)
  const [watermarkOffsetY, setWatermarkOffsetY] = useState(0)
  const [watermarkShowTwitter, setWatermarkShowTwitter] = useState(false)
  const [watermarkShowVerified, setWatermarkShowVerified] = useState(false)

  // Export settings
  const [exportScale, setExportScale] = useState(() => {
    const s = getJson('ui-exp:export-scale', null)
    return typeof s === 'number' && s > 0 ? s : 1
  })
  const [exportFormat, setExportFormat] = useState(() => {
    const s = getJson('ui-exp:export-format', null)
    return ['png','jpeg','webp'].includes(s) ? s : 'png'
  })
  const [exportQuality, setExportQuality] = useState(() => {
    const s = getJson('ui-exp:export-quality', null)
    return typeof s === 'number' && s > 0 && s <= 1 ? s : 0.95
  })
  useEffect(() => { setJson('ui-exp:export-scale', exportScale) }, [exportScale])
  useEffect(() => { setJson('ui-exp:export-format', exportFormat) }, [exportFormat])
  useEffect(() => { setJson('ui-exp:export-quality', exportQuality) }, [exportQuality])

  // Presets UI state
  const [activePresetId, setActivePresetId] = useState('current')
  const [userPresets, setUserPresets] = useState(() => {
    try { const s = getJson('uiExp.userPresets', null); if (Array.isArray(s)) return s } catch (_) {}
    return []
  })
  const [presetDropdownOpen, setPresetDropdownOpen] = useState(false)
  const [presetNamePromptOpen, setPresetNamePromptOpen] = useState(false)
  const [presetNameDraft, setPresetNameDraft] = useState('')
  const presetDropdownRef = useRef(null)
  useEffect(() => { try { setJson('uiExp.userPresets', userPresets) } catch (_) {} }, [userPresets])
  useEffect(() => {
    if (!presetDropdownOpen) return
    const h = (e) => { if (presetDropdownRef.current && !presetDropdownRef.current.contains(e.target)) setPresetDropdownOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [presetDropdownOpen])

  // Refs
  const uploadWallpaperInputRef = useRef(null)
  const sidebarScrollRef = useRef(null)
  const [sidebarIsScrolling, setSidebarIsScrolling] = useState(false)
  const fitViewportRef = useRef(null)
  const wrapperRef = useRef(null)
  const exportRef = useRef(null)

  // === Hooks ===

  const {
    algorithmGradients, setAlgorithmGradients, algorithmGradientsVersion,
    autoGradients, setAutoGradients, autoGradientsVersion,
  } = useGradients({ blobSrc: blob?.src })

  const {
    systemWallpapers, setSystemWallpapers, systemWallpapersStatus,
    selectedSystemWallpaper, setSelectedSystemWallpaper, systemWallpaperLoadFailures,
  } = useSystemWallpapers({ isTauri })

  const {
    annotationBarRef, footerBarRef, annotationBarLeft, footerBarLeft,
    fitScale, wrapperSize, layoutMetrics, setLayoutMetrics,
    safeInsets, handleTransformChange, previewContentMargin,
  } = useLayoutEffects({
    fitViewportRef, wrapperRef, exportRef, blobSrc: blob?.src,
    ratioChoice, customRatioW: customRatio?.w, customRatioH: customRatio?.h, isTauri, setTransform,
    setDraggingPadding, setDraggingInset, setDraggingCurve, setDraggingBorder,
    setDraggingTiltX, setDraggingTiltY, setDraggingRotation,
  })

  // imageOptions — kept here as it references too many state vars to extract
  const imageOptions = useMemo(() => {
    const aspectAuto = blob?.w && blob?.h ? { w: blob.w, h: blob.h } : { w: null, h: null }
    const safeCustom = {
      w: Math.max(1, Math.min(4000, Math.round(Number(customRatio?.w) || 1))),
      h: Math.max(1, Math.min(4000, Math.round(Number(customRatio?.h) || 1))),
    }
    const aspectMode = ratioChoice === 'auto' ? 'auto' : (ratioChoice === 'custom' ? 'custom' : 'preset')
    const aspectRatio = aspectMode === 'preset' ? String(ratioChoice || 'aspect-video') : 'aspect-video'

    const bg = (() => {
      if (backgroundSelection?.type === 'wallpaper' && backgroundSelection?.wallpaper?.filePath) {
        const fp = backgroundSelection.wallpaper.filePath
        return { backgroundType: 'wallpaper', wallpaper: fp, wallpaperSource: backgroundSelection.wallpaper.source || 'system', wallpaperPath: fp }
      }
      if (backgroundSelection?.type === 'color' && backgroundSelection?.color?.hex) {
        return { backgroundType: 'gradient', customTheme: { colorStart: backgroundSelection.color.hex, colorEnd: backgroundSelection.color.hex, angleDeg: 135 }, wallpaper: null, wallpaperSource: null, wallpaperPath: null }
      }
      if (backgroundSelection?.type === 'blobGradient' && backgroundSelection?.blobGradient) {
        return { backgroundType: 'blobGradient', blobGradient: { ...(backgroundSelection.blobGradient || {}) }, wallpaper: null, wallpaperSource: null, wallpaperPath: null }
      }
      if (backgroundSelection?.type === 'gradient' && backgroundSelection?.gradient) {
        const g = backgroundSelection.gradient
        return { backgroundType: 'gradient', customTheme: { colorStart: g.colorStart, colorEnd: g.colorEnd, angleDeg: Number.isFinite(Number(g.angleDeg)) ? Number(g.angleDeg) : 135 }, wallpaper: null, wallpaperSource: null, wallpaperPath: null }
      }
      if (selectedSystemWallpaper?.filePath) {
        return { backgroundType: 'wallpaper', wallpaper: selectedSystemWallpaper.filePath, wallpaperSource: 'system', wallpaperPath: selectedSystemWallpaper.filePath }
      }
      return { backgroundType: 'gradient', customTheme: { colorStart: '#7700FF', colorEnd: '#2C2C2C', angleDeg: 135 } }
    })()

    const isCustomShadow = selectedShadowStyle === 'Custom'
    return {
      aspectMode, aspectRatio, aspectAuto, aspectCustom: safeCustom,
      paddingSize: padding, inset: { padding: inset }, cornerRadius: curve,
      borderWidth: border, borderColor,
      browserBar: browserBarForOsMockup, browserUrl: safariMockupText, browserFrame: { scale: uiScale },
      ...bg, fx: { blur: 0, brightness: 1, noise: false },
      shadow: isCustomShadow ? 'None' : selectedShadowStyle,
      advancedShadow: isCustomShadow ? { enabled: true, ...customShadow } : { enabled: false },
      balance: { enabled: autoCropEnabled },
      tilt: { x: tiltX, y: tiltY },
      position: { x: transform.x, y: transform.y, rotate: rotation },
      watermark: {
        enabled: watermarkEnabled, text: watermarkText, prefix: watermarkPrefix,
        offsetX: watermarkOffsetX, offsetY: watermarkOffsetY,
        showTwitter: watermarkPrefix === 'twitter' ? true : watermarkShowTwitter,
        showVerified: watermarkShowVerified, position: watermarkPosition,
      },
      pen: { color: annotationColor },
    }
  }, [annotationColor, autoCropEnabled, backgroundSelection, blob?.h, blob?.w, border, borderColor, browserBarForOsMockup, curve, customRatio?.h, customRatio?.w, customShadow, inset, padding, ratioChoice, rotation, safariMockupText, selectedShadowStyle, selectedSystemWallpaper?.filePath, tiltX, tiltY, transform.x, transform.y, uiScale, watermarkEnabled, watermarkOffsetX, watermarkOffsetY, watermarkPosition, watermarkPrefix, watermarkShowTwitter, watermarkShowVerified, watermarkText])

  const {
    exportFolderPath, exportBusy, exportDrawerOpen, setExportDrawerOpen, exportDrawerRef,
    pickExportFolder, saveToFolder, copyOutput, saveOutput, applyCapturedSource, takeScreenshot,
  } = useExportFunctions({
    blob, imageOptions, exportScale, exportFormat, exportQuality, exportRef,
    appWindow, generalSettings, pushToast, setBlob, setTransform, setAnnotationTool, rootFocusRef,
  })

  const { shortcuts, setShortcuts, shortcutRecordingKey, setShortcutRecordingKey, formatShortcutLabel } =
    useShortcuts({ copyOutput, saveOutput, saveToFolder, pushToast })

  useScreenshotCapture({ shortcuts, setIsTauri, setBlob, setTransform, setAnnotationTool, rootFocusRef, pushToast })

  const { capturePresetSnapshot, applyPresetSnapshot, applyDefaultPreset } = usePresets({
    ratioChoice, customRatio, padding, inset, curve, border, borderColor,
    tiltX, tiltY, rotation, transform, uiScale, selectedOsMockup, safariMockupText,
    wallpaperType, backgroundSelection, autoCropEnabled, selectedShadowStyle, customShadow,
    annotationColor, watermarkEnabled, watermarkText, watermarkPosition, watermarkPrefix,
    watermarkOffsetX, watermarkOffsetY, watermarkShowTwitter, watermarkShowVerified,
    exportScale, exportFormat, exportQuality,
    setRatioChoice, setCustomRatio, setPadding, setInset, setCurve, setBorder, setBorderColor,
    setTiltX, setTiltY, setRotation, setTransform, setUiScale, setSelectedOsMockup, setSafariMockupText,
    setWallpaperType, setBackgroundSelection, setAutoCropEnabled, setSelectedShadowStyle, setCustomShadow,
    setAnnotationColor, setWatermarkEnabled, setWatermarkText, setWatermarkPosition, setWatermarkPrefix,
    setWatermarkOffsetX, setWatermarkOffsetY, setWatermarkShowTwitter, setWatermarkShowVerified,
    setExportScale, setExportFormat, setExportQuality,
    osMockups, pushToast, systemWallpapers, setSelectedSystemWallpaper, defaultBackgroundSelection,
  })

  // Sidebar scroll tracking
  useEffect(() => {
    const el = sidebarScrollRef.current
    if (!el) return
    let timeout = 0
    const onScroll = () => {
      setSidebarIsScrolling(true)
      window.clearTimeout(timeout)
      timeout = window.setTimeout(() => setSidebarIsScrolling(false), 650)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => { el.removeEventListener('scroll', onScroll); window.clearTimeout(timeout) }
  }, [])

  // Custom wallpaper helpers
  const triggerUploadCustomWallpaper = useCallback(() => {
    try {
      const api = window?.tauriAPI
      if (autoHideEnabled && typeof api?.setAutoHideEnabled === 'function') {
        autoHideSuspendedForFileDialogRef.current = true
        try { api.setAutoHideEnabled(false) } catch (_) {}
        const onFocusRestore = () => {
          window.removeEventListener('focus', onFocusRestore)
          window.setTimeout(() => {
            if (!autoHideSuspendedForFileDialogRef.current) return
            autoHideSuspendedForFileDialogRef.current = false
            try { api.setAutoHideEnabled(!!autoHideEnabled) } catch (_) {}
          }, 80)
        }
        window.addEventListener('focus', onFocusRestore)
      }
      const el = uploadWallpaperInputRef.current
      if (el) el.click()
    } catch (_) {}
  }, [autoHideEnabled])

  const onCustomWallpaperPicked = useCallback(async (e) => {
    const file = e?.target?.files?.[0]
    try { e.target.value = '' } catch (_) {}
    if (!file) return
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onerror = () => reject(new Error('Failed to read file'))
        r.onload = () => resolve(String(r.result || ''))
        r.readAsDataURL(file)
      })
      setBackgroundSelection({
        type: 'wallpaper',
        wallpaper: { filePath: dataUrl, assetUrl: dataUrl, thumbUrl: dataUrl, source: 'custom', name: file.name || 'Custom' },
        gradient: null, blobGradient: null, color: null,
      })
      pushToast('Custom wallpaper loaded', { variant: 'success' })
    } catch (err) {
      pushToast(`Wallpaper upload failed: ${err?.message || String(err)}`, { variant: 'error', durationMs: 3500 })
    } finally {
      const api = window?.tauriAPI
      if (autoHideSuspendedForFileDialogRef.current && typeof api?.setAutoHideEnabled === 'function') {
        autoHideSuspendedForFileDialogRef.current = false
        try { api.setAutoHideEnabled(!!autoHideEnabled) } catch (_) {}
      }
    }
  }, [autoHideEnabled, pushToast])

  // Misc helpers
  const openSettings = useCallback(() => setSettingsOpen(true), [])

  const resetCanvas = useCallback(() => {
    setBlob(null); setTransform({ x: 0, y: 0 }); setAnnotationTool(null)
    setPresetDropdownOpen(false); setActivePresetId('current')
  }, [])

  // Wallpaper tab config
  const activeWallpaperColor = '#7700FF'
  const wallpaperTabs = [
    { id: 'system', label: 'System' },
    { id: 'gradients', label: 'Gradient' },
    { id: 'colors', label: 'Color' },
    { id: 'image', label: 'Auto' },
  ]
  const wallpaperGroupTitles = { system: 'System Wallpapers', gradients: 'Gradients', colors: 'Colors', image: 'Auto' }
  const currentWallpaperGroup = { title: wallpaperGroupTitles[wallpaperType] || 'Wallpapers' }
  const currentWallpaperTileCount = (() => {
    if (wallpaperType === 'system') return Math.max(0, systemWallpapers.length)
    if (wallpaperType === 'gradients') return Math.max(56, algorithmGradients.length)
    if (wallpaperType === 'image') return Math.max(14, autoGradients.length)
    if (wallpaperType === 'colors') return 14
    return 0
  })()
  const setWallpaperTypeOnRelease = (id) => { setPressedWallpaperTab(null); requestAnimationFrame(() => setWallpaperType(id)) }
  const setWallpaperTypeOnClick = (id) => { setPressedWallpaperTab(null); setWallpaperType(id) }
  const dragRegionHeightPx = 56
  const sidebarLeftPx = 16
  const sidebarWidthPx = 270
  const sidebarRightPx = sidebarLeftPx + sidebarWidthPx
  const annotationLeftPx = Math.max(sidebarRightPx, Math.round(Number(annotationBarLeft) || 0))
  const annotationWidthPx = Math.max(0, Math.round(Number(annotationBarRef?.current?.offsetWidth) || 0))
  const annotationRightPx = annotationLeftPx + annotationWidthPx
  const dragMidWidthPx = Math.max(0, annotationLeftPx - sidebarRightPx)
  const useCssBackdropBlur = isTauri && !isWindows && !vibrancyForceOpaque && !vibrancyActive

  // Context value
  const contextValue = {
    isTauri, isMac, isWindows, appWindow,
    sidebarScrollRef, sidebarIsScrolling, uploadWallpaperInputRef, onCustomWallpaperPicked,
    blob, backgroundSelection, setBackgroundSelection, defaultBackgroundSelection,
    wallpaperType, wallpaperTabs, pressedWallpaperTab, setPressedWallpaperTab,
    systemWallpapers, systemWallpapersStatus, systemWallpaperLoadFailures,
    osMockups, selectedOsMockup, setSelectedOsMockup, activeWallpaperColor,
    customGradient, setCustomGradient, algorithmGradients, autoGradients,
    selectedShadowStyle, setSelectedShadowStyle, customShadow, setCustomShadow,
    ratioChoice, setRatioChoice, customRatio, setCustomRatio,
    inset, setInset, padding, setPadding, curve, setCurve, border, setBorder, borderColor, setBorderColor,
    uiScale, setUiScale, rotation, setRotation, tiltX, setTiltX, tiltY, setTiltY,
    autoCropEnabled, setAutoCropEnabled, isAdvancedOpen, setIsAdvancedOpen,
    draggingInset, setDraggingInset, draggingPadding, setDraggingPadding,
    draggingRotation, setDraggingRotation, draggingTiltX, setDraggingTiltX,
    draggingTiltY, setDraggingTiltY, draggingBorder, setDraggingBorder,
    draggingCurve, setDraggingCurve, draggingUiScale, setDraggingUiScale,
    watermarkEnabled, setWatermarkEnabled, watermarkText, setWatermarkText,
    watermarkPrefix, setWatermarkPrefix, watermarkPosition, setWatermarkPosition,
    watermarkOffsetX, setWatermarkOffsetX, watermarkOffsetY, setWatermarkOffsetY,
    watermarkShowVerified, setWatermarkShowVerified, watermarkShowTwitter, setWatermarkShowTwitter,
    safariMockupText, setSafariMockupText,
    handleTransformChange, triggerUploadCustomWallpaper,
    setWallpaperTypeOnClick, setWallpaperTypeOnRelease, setSelectedSystemWallpaper,
    currentWallpaperGroup, currentWallpaperTileCount,
    annotationBarRef, annotationBarLeft, annotationTool, setAnnotationTool,
    shapeMode, setShapeMode, annotationColor, setAnnotationColor,
    annotationActionsRef,
    clearAnnotations: () => { annotationActionsRef.current?.clearAllAnnotations?.(); },
    activePresetId, setActivePresetId, userPresets, setUserPresets,
    presetDropdownRef, presetDropdownOpen, setPresetDropdownOpen,
    applyDefaultPreset, applyPresetSnapshot, resetCanvas,
    setPresetNameDraft, setPresetNamePromptOpen,
    footerBarRef, footerBarLeft, exportBusy, exportDrawerOpen, setExportDrawerOpen, exportDrawerRef,
    exportScale, setExportScale, exportFormat, setExportFormat,
    exportQuality, setExportQuality, exportFolderPath,
    copyOutput, saveOutput, saveToFolder, pickExportFolder, openSettings,
    presetNamePromptOpen, presetNameDraft, capturePresetSnapshot,
    pushToast, transform, setTransform,
    fitViewportRef, fitScale, safeInsets, previewContentMargin,
    wrapperRef, exportRef, imageOptions, setLayoutMetrics, layoutMetrics, wrapperSize,
    shortcuts, shortcutRecordingKey, setShortcutRecordingKey,
    formatShortcutLabel, takeScreenshot, applyCapturedSource,
    vibrancyActive, setVibrancyActive,
    vibrancyDebugOpen, setVibrancyDebugOpen,
    vibrancyForceOpaque, setVibrancyForceOpaque,
    vibrancyDebug, setVibrancyDebug,
    vibrancyDebugError, setVibrancyDebugError,
    vibrancyComputed,
  }

  return (
    <ThemeProvider>
      <AppContext.Provider value={contextValue}>
        <TooltipProvider>
          <div
            ref={rootFocusRef}
            tabIndex={-1}
            className="relative min-h-screen overflow-hidden shotstyle-app-root"
            style={{
              outline: 'none',
              width: '100%',
              height: '100%',
              backgroundColor: isTauri
                ? vibrancyForceOpaque
                    ? 'rgba(18,18,24,0.84)'
                    : isWindows ? 'rgba(14,14,18,0.97)' : 'transparent'
                : 'rgba(0,0,0,0.58)',
              backdropFilter: useCssBackdropBlur
                ? 'blur(var(--shotstyle-vibrancy-blur, 30px)) saturate(var(--shotstyle-vibrancy-saturate, 1.45))'
                : undefined,
              WebkitBackdropFilter: useCssBackdropBlur
                ? 'blur(var(--shotstyle-vibrancy-blur, 30px)) saturate(var(--shotstyle-vibrancy-saturate, 1.45))'
                : undefined,
              borderRadius: (isTauri && isMac) ? 'var(--window-corner-radius, 12px)' : 0,
              overflow: 'hidden',
            }}
          >
            <VibrancyDebugPanel />

            {isTauri && !settingsOpen && (
              <>
                <div
                  data-tauri-drag-region
                  className="window-drag-region absolute top-0"
                  style={{
                    left: 0,
                    width: sidebarLeftPx,
                    height: dragRegionHeightPx,
                    background: 'transparent',
                  }}
                />
                <div
                  data-tauri-drag-region
                  className="window-drag-region absolute top-0"
                  style={{
                    left: sidebarRightPx,
                    width: dragMidWidthPx,
                    height: dragRegionHeightPx,
                    background: 'transparent',
                  }}
                />
                <div
                  data-tauri-drag-region
                  className="window-drag-region absolute top-0 right-0"
                  style={{
                    left: annotationRightPx,
                    height: dragRegionHeightPx,
                    background: 'transparent',
                  }}
                />
              </>
            )}

            <PresetSelectorTopRight />

            <CenterPreview />

            <Sidebar />

            <AnnotationBar />

            <ExportFooter />

            <input
              ref={uploadWallpaperInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={onCustomWallpaperPicked}
            />

            <div className="shotstyle-toast-stack" aria-live="polite" aria-relevant="additions removals">
              <AnimatePresence>
                {toasts.map((t) => (
                  <motion.div
                    key={t.id}
                    initial={{ opacity: 0, y: 16, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, x: 60, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                    className="shotstyle-toast"
                    data-variant={t.variant || 'success'}
                    role="status"
                    onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                    title="Dismiss"
                  >
                    {t.message}
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            <PresetSaveDialog />

            <SettingsModal
              isOpen={settingsOpen}
              shortcuts={shortcuts}
              autoHideEnabled={autoHideEnabled}
              onSetAutoHideEnabled={setAutoHideEnabled}
              onSaveShortcuts={(next) => {
                const normalized = normalizeShortcuts(next)
                setShortcuts(normalized)
                try { setJson('settings.shortcuts', normalized) } catch (_) {}
              }}
              onChangeGeneralSettings={(next) => {
                const merged = { ...DEFAULT_GENERAL_SETTINGS, ...(next && typeof next === 'object' ? next : {}) }
                setGeneralSettings(merged)
                try { setJson('settings.general', merged) } catch (_) {}
              }}
              onClose={() => setSettingsOpen(false)}
            />
          </div>
        </TooltipProvider>
      </AppContext.Provider>
    </ThemeProvider>
  )
}

export default App
