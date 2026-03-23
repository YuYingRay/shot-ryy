import { useEffect, useRef, useState } from 'react'
import { installTauriApi } from '../../../utils/platform/tauriApi'
import { getJson } from '../../../utils/platform/safeStorage'

/**
 * Manages loading and state for system wallpapers.
 * @param {{ isTauri: boolean }} params
 */
export function useSystemWallpapers({ isTauri }) {
  const [systemWallpapers, setSystemWallpapers] = useState([])
  const [systemWallpapersStatus, setSystemWallpapersStatus] = useState({ loading: false, error: null })
  const [selectedSystemWallpaper, setSelectedSystemWallpaper] = useState(() => {
    try {
      const saved = getJson('uiExp.backgroundState', null)
      const sel = saved?.backgroundSelection
      if (sel?.type === 'wallpaper' && sel?.wallpaper?.filePath) {
        return { name: 'Wallpaper', filePath: String(sel.wallpaper.filePath) }
      }
    } catch {}
    return null
  })
  const [systemWallpaperLoadFailures, setSystemWallpaperLoadFailures] = useState(() => new Set())
  const systemWallpapersLoadedRef = useRef(false)

  useEffect(() => {
    if (!isTauri) {
      setSystemWallpapers([])
      setSystemWallpapersStatus({ loading: false, error: null })
      systemWallpapersLoadedRef.current = false
      return
    }

    // React StrictMode in dev can run effects twice; guard so we don't do duplicate filesystem scans.
    if (systemWallpapersLoadedRef.current) return
    systemWallpapersLoadedRef.current = true

    let cancelled = false
    const run = async () => {
      try {
        await installTauriApi()
      } catch {}

      const api = window?.tauriAPI
      if (!api?.listSystemWallpapers) {
        try {
          console.warn('[ui-exp] listSystemWallpapers unavailable (tauriAPI missing or command not registered)')
        } catch {}
        setSystemWallpapers([])
        setSystemWallpapersStatus({ loading: false, error: 'System wallpaper API unavailable in this build.' })
        systemWallpapersLoadedRef.current = false
        return
      }

      try {
        setSystemWallpapersStatus({ loading: true, error: null })
        const res = await api.listSystemWallpapers({ maxItems: 500 })
        const items = Array.isArray(res) ? res : []

        const needsTranscodeForImgTag = (filePath) => {
          const s = String(filePath || '').toLowerCase()
          return s.endsWith('.heic') || s.endsWith('.heif') || s.endsWith('.avif')
        }

        const baseMapped = items.map((it) => {
          const filePath = it?.filePath || it?.file_path || it?.path || null
          if (!filePath) return null
          const name = it?.name || String(filePath).split('/').pop() || 'Wallpaper'
          const assetUrl = (typeof api?.filePathToAssetUrl === 'function')
            ? api.filePathToAssetUrl(filePath)
            : null
          return { name, filePath, assetUrl, thumbUrl: null }
        }).filter(Boolean)

        if (cancelled) return
        setSystemWallpapers(baseMapped)
        setSystemWallpapersStatus({ loading: false, error: null })

        const generateThumb = async (filePath) => {
          if (typeof api?.readFileAsAssetUrl === 'function') {
            return await api.readFileAsAssetUrl({ filePath, maxDim: 256 })
          }
          return null
        }

        const batchSize = 6
        for (let i = 0; i < baseMapped.length; i += batchSize) {
          if (cancelled) return
          const batch = baseMapped.slice(i, i + batchSize)
          const results = await Promise.all(batch.map(async (item) => {
            const fp = item?.filePath
            if (!fp) return { fp: null, thumbUrl: null }
            try {
              const url = await generateThumb(fp)
              if (url) return { fp, thumbUrl: String(url) }
            } catch {}

            if (!needsTranscodeForImgTag(fp) && item?.assetUrl) {
              return { fp, thumbUrl: String(item.assetUrl) }
            }

            return { fp, thumbUrl: null }
          }))

          if (cancelled) return
          setSystemWallpapers((prev) => {
            const list = Array.isArray(prev) ? prev : []
            if (!list.length) return prev
            const byFp = new Map(results.filter((r) => r?.fp).map((r) => [r.fp, r.thumbUrl]))
            return list.map((x) => {
              const nextThumb = x?.filePath ? byFp.get(x.filePath) : null
              return nextThumb ? { ...x, thumbUrl: nextThumb } : x
            })
          })

          await new Promise((r) => setTimeout(r, 0))
        }
        try { setSystemWallpaperLoadFailures(new Set()) } catch {}

        setSelectedSystemWallpaper((prev) => {
          if (!prev?.filePath) return prev
          const stillPresent = baseMapped.some((x) => x?.filePath === prev.filePath)
          return stillPresent ? prev : null
        })
      } catch (e) {
        if (!cancelled) {
          const msg = String(e?.message || e || 'Failed to load system wallpapers')
          try {
            console.error('[ui-exp] failed to load system wallpapers', msg)
          } catch {}
          setSystemWallpapers([])
          setSystemWallpapersStatus({ loading: false, error: msg })
          systemWallpapersLoadedRef.current = false
        }
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [isTauri])

  return {
    systemWallpapers,
    setSystemWallpapers,
    systemWallpapersStatus,
    selectedSystemWallpaper,
    setSelectedSystemWallpaper,
    systemWallpaperLoadFailures,
    setSystemWallpaperLoadFailures,
  }
}
