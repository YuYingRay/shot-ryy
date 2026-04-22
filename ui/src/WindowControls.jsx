import React from 'react'
import { Minus, Square, X } from 'lucide-react'
import { useI18n } from '../../components/context/I18nContext'
import { useAppContext } from './AppContext'

export default function WindowControls() {
  const { isTauri, isWindows, appWindow } = useAppContext()
  const { t } = useI18n()

  if (!isTauri || !isWindows || !appWindow) return null

  return (
    <div
      className="absolute top-1.5 right-3 z-40 flex items-center gap-1 window-no-drag"
      aria-label={t('windowControls')}
    >
      <button
        type="button"
        className="h-7 w-9 rounded-[8px] text-white/85 hover:bg-white/10 transition-colors grid place-items-center"
        aria-label={t('windowMinimize')}
        title={t('windowMinimize')}
        onClick={async () => {
          try { await appWindow.minimize?.() } catch {}
        }}
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        className="h-7 w-9 rounded-[8px] text-white/85 hover:bg-white/10 transition-colors grid place-items-center"
        aria-label={t('windowMaximize')}
        title={t('windowMaximize')}
        onClick={async () => {
          try { await appWindow.toggleMaximize?.() } catch {}
        }}
      >
        <Square size={12} />
      </button>
      <button
        type="button"
        className="h-7 w-9 rounded-[8px] text-white/85 hover:bg-[#E81123] transition-colors grid place-items-center"
        aria-label={t('close')}
        title={t('close')}
        onClick={async () => {
          try { await appWindow.close?.() } catch {}
        }}
      >
        <X size={14} />
      </button>
    </div>
  )
}
