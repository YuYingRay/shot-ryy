import React, { useEffect, useMemo, useState } from 'react'

import SettingsModal from '../../../components/dialogs/SettingsModal.jsx'
import { ThemeProvider } from '../../../components/context/ThemeContext.jsx'

import { defaultShortcuts } from '../../../utils/platform/preferences'
import { getJson, setJson } from '../../../utils/platform/safeStorage'

const readBool = (key, fallback) => {
  try {
    const v = getJson(key, fallback)
    return !!v
  } catch {
    return !!fallback
  }
}

export default function SettingsWindow() {
  const [shortcuts, setShortcuts] = useState(() => getJson('settings.shortcuts', defaultShortcuts))
  const [autoHideEnabled, setAutoHideEnabled] = useState(() => readBool('settings.autoHideEnabled', true))

  const [options, setOptions] = useState(() => {
    const v = getJson('settings.options', null)
    if (v && typeof v === 'object') return v
    return { balance: { enabled: true } }
  })

  useEffect(() => {
    try {
      setJson('settings.autoHideEnabled', !!autoHideEnabled)
    } catch {}
  }, [autoHideEnabled])

  useEffect(() => {
    try {
      setJson('settings.options', options)
    } catch {}
  }, [options])

  const onSaveShortcuts = (next) => {
    try {
      setShortcuts(next)
      setJson('settings.shortcuts', next)
    } catch {}
  }

  const onClose = () => {
    try {
      window.close()
      return
    } catch {}

    try {
      window.location.href = '/'
    } catch {}
  }

  const modalOptions = useMemo(() => {
    const v = options && typeof options === 'object' ? options : {}
    if (typeof v.balance === 'object' && v.balance) return v
    return { ...v, balance: { enabled: !!v.balance } }
  }, [options])

  return (
    <ThemeProvider>
      <SettingsModal
          isOpen
          shortcuts={shortcuts}
          options={modalOptions}
          setOptions={setOptions}
          autoHideEnabled={autoHideEnabled}
          onSetAutoHideEnabled={setAutoHideEnabled}
          onSaveShortcuts={onSaveShortcuts}
          onClose={onClose}
        />
    </ThemeProvider>
  )
}
