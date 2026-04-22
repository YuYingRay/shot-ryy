import { useI18n } from '../../components/context/I18nContext'
import { useAppContext } from './AppContext'

export default function PresetSelectorTopRight() {
  const { t } = useI18n()
  const {
    isWindows,
    activePresetId, setActivePresetId,
    userPresets,
    presetDropdownRef,
    applyDefaultPreset, applyPresetSnapshot,
    setPresetNameDraft, setPresetNamePromptOpen,
  } = useAppContext()

  return (
    <div
      ref={presetDropdownRef}
      className="absolute top-4 window-no-drag z-40"
      style={{ right: isWindows ? 108 : 16 }}
    >
      <div className="relative">
        <button
          type="button"
          className="shotstyle-footer-btn bg-[#2C2C2C] text-[13px] font-inter font-light text-white gap-1.5 w-[124px] pointer-events-none"
          tabIndex={-1}
          aria-hidden="true"
        >
          <span className="truncate">
            {activePresetId === 'default' ? t('default') : activePresetId === 'current' ? t('current') : (userPresets.find((p) => p.id === activePresetId)?.name || t('default'))}
          </span>
          <span className="text-white/60 flex-shrink-0">▾</span>
        </button>

        <select
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer border-none outline-none"
          value={activePresetId}
          onChange={(e) => {
            const val = e.target.value
            if (val === '__save_new__') {
              setPresetNameDraft('')
              setPresetNamePromptOpen(true)
              return
            }
            setActivePresetId(val)
            if (val === 'default') applyDefaultPreset()
            else if (val !== 'current') {
              const preset = userPresets.find((p) => p.id === val)
              if (preset) applyPresetSnapshot(preset.snapshot)
            }
          }}
          aria-label={t('presets')}
        >
          <option value="default">{t('default')}</option>
          <option value="current">{t('current')}</option>
          {userPresets.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
          <option value="__save_new__">{t('saveCurrentSettingsAsPreset')}</option>
        </select>
      </div>
    </div>
  )
}
