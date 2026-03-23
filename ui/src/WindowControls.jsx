import React from 'react'
import { Minus, Square, X } from 'lucide-react'
import { useAppContext } from './AppContext'

export default function WindowControls() {
  const { isTauri, isWindows, appWindow } = useAppContext()

  if (!isTauri || !isWindows || !appWindow) return null

  return (
    <div
      className="absolute top-1.5 right-3 z-40 flex items-center gap-1 window-no-drag"
      aria-label="Window controls"
    >
      <button
        type="button"
        className="h-7 w-9 rounded-[8px] text-white/85 hover:bg-white/10 transition-colors grid place-items-center"
        aria-label="Minimize"
        title="Minimize"
        onClick={async () => {
          try { await appWindow.minimize?.() } catch {}
        }}
      >
        <Minus size={14} />
      </button>
      <button
        type="button"
        className="h-7 w-9 rounded-[8px] text-white/85 hover:bg-white/10 transition-colors grid place-items-center"
        aria-label="Maximize"
        title="Maximize"
        onClick={async () => {
          try { await appWindow.toggleMaximize?.() } catch {}
        }}
      >
        <Square size={12} />
      </button>
      <button
        type="button"
        className="h-7 w-9 rounded-[8px] text-white/85 hover:bg-[#E81123] transition-colors grid place-items-center"
        aria-label="Close"
        title="Close"
        onClick={async () => {
          try { await appWindow.close?.() } catch {}
        }}
      >
        <X size={14} />
      </button>
    </div>
  )
}
