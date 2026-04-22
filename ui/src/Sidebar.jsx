import React from 'react'
import { AnimatePresence, LayoutGroup, motion } from 'framer-motion'
import { ChevronDown, RotateCcw } from 'lucide-react'
import { RangeWithTooltip } from '@/components/RangeWithTooltip'
import { useI18n } from '../../components/context/I18nContext'
import { useAppContext } from './AppContext'
import { AspectRatioDropdown } from './AppHelpers'
import WallpaperGrid from './WallpaperGrid'
import { isProbablyHexColor, normalizeHexColorInput } from '../../utils/color/colorInput.js'
import hugShadowThumb from '../Hugshadowthumb.png'
import heavyShadowThumb from '../Heavyshadowthumb.png'
import ambientShadowThumb from '../Ambientshadowthumb.png'
import customShadowThumb from '../customshadowthumb.png'

const SLIDER_W = 'w-[128px]'

export default function LeftSidebar() {
  const {
    sidebarScrollRef,
    sidebarIsScrolling,
    uploadWallpaperInputRef,
    onCustomWallpaperPicked,
    isTauri,
    isMac,
    isWindows,
    appWindow,
    triggerUploadCustomWallpaper,
    wallpaperType,
    wallpaperTabs,
    pressedWallpaperTab,
    setPressedWallpaperTab,
    setWallpaperTypeOnClick,
    setWallpaperTypeOnRelease,
    activeWallpaperColor,
    currentWallpaperGroup,
    currentWallpaperTileCount,
    systemWallpapers,
    systemWallpapersStatus,
    systemWallpaperLoadFailures,
    algorithmGradients,
    autoGradients,
    backgroundSelection,
    setBackgroundSelection,
    defaultBackgroundSelection,
    setSelectedSystemWallpaper,
    customGradient,
    setCustomGradient,
    ratioChoice,
    setRatioChoice,
    customRatio,
    setCustomRatio,
    padding,
    setPadding,
    draggingPadding,
    setDraggingPadding,
    inset,
    setInset,
    draggingInset,
    setDraggingInset,
    autoCropEnabled,
    setAutoCropEnabled,
    selectedShadowStyle,
    setSelectedShadowStyle,
    customShadow,
    setCustomShadow,
    curve,
    setCurve,
    draggingCurve,
    setDraggingCurve,
    border,
    setBorder,
    draggingBorder,
    setDraggingBorder,
    borderColor,
    setBorderColor,
    osMockups,
    selectedOsMockup,
    setSelectedOsMockup,
    safariMockupText,
    setSafariMockupText,
    uiScale,
    setUiScale,
    draggingUiScale,
    setDraggingUiScale,
    watermarkEnabled,
    setWatermarkEnabled,
    watermarkText,
    setWatermarkText,
    watermarkPrefix,
    setWatermarkPrefix,
    watermarkPosition,
    setWatermarkPosition,
    watermarkOffsetX,
    setWatermarkOffsetX,
    watermarkOffsetY,
    setWatermarkOffsetY,
    watermarkShowVerified,
    setWatermarkShowVerified,
    watermarkShowTwitter,
    setWatermarkShowTwitter,
    isAdvancedOpen,
    setIsAdvancedOpen,
    tiltX,
    setTiltX,
    draggingTiltX,
    setDraggingTiltX,
    tiltY,
    setTiltY,
    draggingTiltY,
    setDraggingTiltY,
    rotation,
    setRotation,
    draggingRotation,
    setDraggingRotation,
    transform,
    handleTransformChange,
  } = useAppContext()

  const { t } = useI18n()

  const topPaddingPx = isTauri && isMac ? 52 : 16

  return (
    <motion.div
      initial={{ x: -20, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ duration: 0.25, ease: [0.25, 0.46, 0.45, 0.94] }}
      ref={sidebarScrollRef}
      data-shotstyle-scroll="sidebar"
      data-scrolling={sidebarIsScrolling ? '1' : '0'}
      className={`absolute left-4 top-4 w-[270px] max-h-[calc(100vh-32px)] rounded-[16px] pb-[24px] px-[20px] text-white flex flex-col shadow-[inset_0_0_0_1px_#1b1f23,0_4px_4px_rgba(0,0,0,0.25)] overflow-y-auto overflow-x-visible select-none window-no-drag shotstyle-chrome-panel shotstyle-sidebar-scroll shotstyle-sidebar ${sidebarIsScrolling ? 'is-scrolling' : ''}`}
      style={{ paddingTop: topPaddingPx }}
    >
      <input
        ref={uploadWallpaperInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={onCustomWallpaperPicked}
      />
      <button
        type="button"
        className="w-full bg-[#2C2C2C] rounded-[5px] text-xs font-inter font-light text-white cursor-pointer self-center py-[7px]"
        onClick={triggerUploadCustomWallpaper}
      >
        {t('uploadCustomWallpaper')}
      </button>
      <LayoutGroup>
        <div className="mt-3 w-full rounded-[8px] bg-[#141414] p-[2px] flex gap-[2px]">
          {wallpaperTabs.map((t) => {
            const isActive = wallpaperType === t.id;
            const isPressed = pressedWallpaperTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onPointerDown={() => setPressedWallpaperTab(t.id)}
                onPointerUp={() => setWallpaperTypeOnRelease(t.id)}
                onPointerCancel={() => setPressedWallpaperTab(null)}
                onPointerLeave={() => setPressedWallpaperTab(null)}
                onClick={() => setWallpaperTypeOnClick(t.id)}
                className={
                  "relative flex-1 rounded-[6px] px-2 py-[6px] text-[11px] font-inter font-light transition-colors " +
                  (isActive
                    ? 'text-white'
                    : 'text-[#bdbdbd]') +
                  (isPressed && !isActive ? ' bg-[#232323]' : '')
                }
                style={isActive ? { backgroundColor: 'transparent' } : undefined}
              >
                {isActive && (
                  <motion.div
                    layoutId="wallpaper-switch-pill"
                    className="absolute inset-0 rounded-[6px]"
                    style={{ backgroundColor: activeWallpaperColor }}
                    transition={{ type: 'spring', stiffness: 520, damping: 38, mass: 0.8 }}
                  />
                )}
                <span className="relative z-10">{t.label}</span>
              </button>
            );
          })}
        </div>
      </LayoutGroup>
      <div className="text-xs font-inter font-light text-white mt-3">
        {currentWallpaperGroup.title}
      </div>
      {wallpaperType === 'system' && (systemWallpapersStatus.error || systemWallpapers.length === 0) && (
        <div className="text-[10px] font-inter font-light text-white/60 mt-1">
          {systemWallpapersStatus.error
            ? t('systemWallpapersFailed', { error: systemWallpapersStatus.error })
            : t('noSystemWallpapers')}
        </div>
      )}
      {wallpaperType === 'system' && systemWallpaperLoadFailures.size > 0 && (
        <div className="text-[10px] font-inter font-light text-white/60 mt-1">
          {t('thumbnailsFailedToLoad', { count: systemWallpaperLoadFailures.size })}
        </div>
      )}
      <WallpaperGrid />

      {wallpaperType === 'gradients' && (
        <div className="mt-4">
          <div className="text-xs font-inter font-light text-white mb-2">{t('background')}</div>
          <div className="flex flex-col gap-2">
            {([
              { key: 'colorStart', label: t('gradientStart') },
              { key: 'colorEnd', label: t('gradientEnd') },
            ]).map((row) => {
              const current = String(customGradient?.[row.key] || '');
              const normalized = isProbablyHexColor(current) ? normalizeHexColorInput(current) : null;
              const safe = normalized || '#000000';

              return (
                <div key={row.key} className="flex items-center gap-[7px]">
                  <div className="w-[34px] text-[10px] font-inter font-light text-white/70 shrink-0">{row.label}</div>
                  <div className="relative shrink-0">
                    <div
                      className="shotstyle-preview-tile w-[25px] h-[25px] rounded-[7px] border border-white/10"
                      style={{ backgroundColor: safe }}
                      title={`${row.label} color`}
                    />
                    <input
                      type="color"
                      aria-label={`${row.label} color picker`}
                      className="absolute inset-0 opacity-0 cursor-pointer"
                      value={safe}
                      onChange={(e) => {
                        const next = normalizeHexColorInput(e.target.value);
                        const nextCustom = { ...(customGradient || {}), [row.key]: next };
                        setCustomGradient(nextCustom);
                        setSelectedSystemWallpaper(null);
                        setBackgroundSelection({ type: 'gradient', gradient: nextCustom, gradientPresetId: null, blobGradient: null, wallpaper: null, color: null });
                      }}
                    />
                  </div>
                  <input
                    type="text"
                    spellCheck={false}
                    aria-label={`${row.label} color hex`}
                    className="h-[25px] flex-1 min-w-0 bg-[#2C2C2C] rounded-[7px] text-[11px] font-inter font-light text-white px-2 border border-white/10"
                    value={current}
                    onChange={(e) => {
                      const raw = e.target.value;
                      const nextCustom = { ...(customGradient || {}), [row.key]: raw };
                      setCustomGradient(nextCustom);
                      setSelectedSystemWallpaper(null);
                      setBackgroundSelection({ type: 'gradient', gradient: nextCustom, gradientPresetId: null, blobGradient: null, wallpaper: null, color: null });
                    }}
                    onBlur={() => {
                      const raw = String(customGradient?.[row.key] || '');
                      if (!isProbablyHexColor(raw)) return;
                      const next = normalizeHexColorInput(raw);
                      const nextCustom = { ...(customGradient || {}), [row.key]: next };
                      setCustomGradient(nextCustom);
                      setSelectedSystemWallpaper(null);
                      setBackgroundSelection({ type: 'gradient', gradient: nextCustom, gradientPresetId: null, blobGradient: null, wallpaper: null, color: null });
                    }}
                  />
                </div>
              );
            })}

            <div className="flex items-center gap-[7px]">
              <div className="w-[34px] text-[10px] font-inter font-light text-white/70 shrink-0">{t('gradientAngle')}</div>
              <input
                type="range"
                min={0}
                max={360}
                step={1}
                value={customGradient?.angleDeg ?? 135}
                onChange={(e) => {
                  const nextCustom = { ...(customGradient || {}), angleDeg: Number(e.target.value) };
                  setCustomGradient(nextCustom);
                  setSelectedSystemWallpaper(null);
                  setBackgroundSelection({ type: 'gradient', gradient: nextCustom, gradientPresetId: null, blobGradient: null, wallpaper: null, color: null });
                }}
                className="flex-1 min-w-0 h-[3px] accent-[#7700FF] cursor-pointer"
                aria-label={t('gradientAngleAria')}
              />
              <input
                type="number"
                min={0}
                max={360}
                value={customGradient?.angleDeg ?? 135}
                onChange={(e) => {
                  const v = Math.max(0, Math.min(360, Number(e.target.value) || 0));
                  const nextCustom = { ...(customGradient || {}), angleDeg: v };
                  setCustomGradient(nextCustom);
                  setSelectedSystemWallpaper(null);
                  setBackgroundSelection({ type: 'gradient', gradient: nextCustom, gradientPresetId: null, blobGradient: null, wallpaper: null, color: null });
                }}
                className="w-[48px] h-[25px] bg-[#2C2C2C] rounded-[7px] text-[11px] font-inter font-light text-white text-center border border-white/10 shrink-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                aria-label={t('gradientAngleDegreesAria')}
              />
              <span className="text-[10px] font-inter font-light text-white/50 shrink-0">°</span>
            </div>
          </div>
        </div>
      )}

      <AspectRatioDropdown ratioChoice={ratioChoice} setRatioChoice={setRatioChoice} />

      <AnimatePresence>
        {ratioChoice === 'custom' && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="flex justify-between items-center mt-2">
            <div className="text-xs font-inter font-light text-[#757575]">{t('custom')}</div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={4000}
                value={customRatio.w}
                onChange={(e) => {
                  const w = Math.max(1, Math.min(4000, Math.round(Number(e.target.value) || 1)));
                  setCustomRatio((prev) => ({ ...prev, w }));
                }}
                className="bg-[#2C2C2C] rounded-[4.5px] text-xs font-inter font-light text-white px-2 py-1 w-[62px]"
                aria-label={t('customRatioWidthAria')}
              />
              <span className="text-xs font-inter font-light text-white/70">:</span>
              <input
                type="number"
                min={1}
                max={4000}
                value={customRatio.h}
                onChange={(e) => {
                  const h = Math.max(1, Math.min(4000, Math.round(Number(e.target.value) || 1)));
                  setCustomRatio((prev) => ({ ...prev, h }));
                }}
                className="bg-[#2C2C2C] rounded-[4.5px] text-xs font-inter font-light text-white px-2 py-1 w-[62px]"
                aria-label={t('customRatioHeightAria')}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="flex justify-between items-center mt-3">
        <div className="text-xs font-inter font-light text-white">{t('padding')}</div>
        <RangeWithTooltip
          className={SLIDER_W}
          value={padding}
          onValueChange={setPadding}
          dragging={draggingPadding}
          setDragging={setDraggingPadding}
          formatValue={(v) => `${v}px`}
        />
      </div>
      <div className="flex justify-between items-center mt-3">
        <div className="text-xs font-inter font-light text-white">{t('inset')}</div>
        <RangeWithTooltip
          className={SLIDER_W}
          value={inset}
          onValueChange={setInset}
          dragging={draggingInset}
          setDragging={setDraggingInset}
          formatValue={(v) => `${v}px`}
        />
      </div>
      <div className="flex items-center mt-3">
        <input
          type="checkbox"
          id="autocrop"
          className="mr-2"
          checked={autoCropEnabled}
          onChange={(e) => setAutoCropEnabled(!!e.target.checked)}
        />
        <label htmlFor="autocrop" className="text-xs font-inter font-light text-white cursor-pointer">{t('autoCrop')}</label>
      </div>
      <div className="text-xs font-inter font-light text-[#757575] pl-5 mt-0.5">
        {t('autoCropHelp')}
      </div>
      <div className="text-xs font-inter font-light text-white mt-3">
        {t('shadow')}
      </div>
      <div className="grid grid-cols-4 gap-[8px] mt-[6px] justify-items-start items-start w-full">
        {([
          { id: 'Hug', label: t('shadowStyleHug'), styleLabel: t('shadowStyle1'), thumb: hugShadowThumb },
          { id: 'Heavy', label: t('shadowStyleHeavy'), styleLabel: t('shadowStyle2'), thumb: heavyShadowThumb },
          { id: 'Ambient', label: t('shadowStyleAmbient'), styleLabel: t('shadowStyle3'), thumb: ambientShadowThumb },
          { id: 'Custom', label: t('shadowStyleCustom'), styleLabel: t('shadowStyle4'), thumb: customShadowThumb },
        ]).map((s) => {
          const isActive = selectedShadowStyle === s.id;
          return (
            <div key={s.id} className="flex flex-col items-center w-full min-w-0">
              <button
                type="button"
                onClick={() => setSelectedShadowStyle(s.id)}
                className={(isActive ? 'bg-[#2A2A2A] shadow-[inset_0_0_0_1px_#4A4A4A]' : 'bg-transparent hover:bg-[#232323]') + ' rounded-[10px]'}
                style={{ width: 56, height: 56, padding: 4, boxSizing: 'border-box' }}
                aria-pressed={isActive}
                aria-label={`${s.styleLabel} ${s.label}`}
              >
                <div className="w-full h-full rounded-[6px] overflow-hidden">
                  <img src={s.thumb} alt={s.label} className="block w-full h-full object-cover" />
                </div>
              </button>
              <div className="mt-[4px] text-[9px] font-inter font-light text-[#757575]">{s.label}</div>
            </div>
          );
        })}
      </div>
      {selectedShadowStyle === 'Custom' && (
        <div className="mt-2 p-3 rounded-[8px] bg-[#1c1c1c] shadow-[inset_0_0_0_1px_#313131]">
          <div className="flex justify-between items-center mb-2">
            <div className="text-[11px] font-inter font-light text-white">{t('shadowCustom')}</div>
            <input
              type="color"
              value={customShadow.color}
              onChange={(e) => setCustomShadow((prev) => ({ ...prev, color: String(e.target.value || '#000000') }))}
              className="h-[20px] w-[20px] rounded-full border-0 cursor-pointer"
              aria-label={t('customShadowColorAria')}
            />
          </div>
          <div className="flex justify-between items-center mt-2">
            <div className="text-xs font-inter font-light text-white">{t('axisX')} <span className="text-white/60">{Math.round(customShadow.offsetX)}px</span></div>
            <RangeWithTooltip
              className={SLIDER_W}
              min={-80}
              max={80}
              origin={0}
              value={customShadow.offsetX}
              onValueChange={(v) => setCustomShadow((prev) => ({ ...prev, offsetX: v }))}
              formatValue={(v) => `${v}px`}
            />
          </div>
          <div className="flex justify-between items-center mt-2">
            <div className="text-xs font-inter font-light text-white">{t('axisY')} <span className="text-white/60">{Math.round(customShadow.offsetY)}px</span></div>
            <RangeWithTooltip
              className={SLIDER_W}
              min={-80}
              max={120}
              origin={0}
              value={customShadow.offsetY}
              onValueChange={(v) => setCustomShadow((prev) => ({ ...prev, offsetY: v }))}
              formatValue={(v) => `${v}px`}
            />
          </div>
          <div className="flex justify-between items-center mt-2">
            <div className="text-xs font-inter font-light text-white">{t('shadowBlur')} <span className="text-white/60">{Math.round(customShadow.blur)}px</span></div>
            <RangeWithTooltip
              className={SLIDER_W}
              min={0}
              max={160}
              value={customShadow.blur}
              onValueChange={(v) => setCustomShadow((prev) => ({ ...prev, blur: v }))}
              formatValue={(v) => `${v}px`}
            />
          </div>
          <div className="flex justify-between items-center mt-2">
            <div className="text-xs font-inter font-light text-white">{t('shadowSpread')} <span className="text-white/60">{Math.round(customShadow.spread)}px</span></div>
            <RangeWithTooltip
              className={SLIDER_W}
              min={-80}
              max={80}
              origin={0}
              value={customShadow.spread}
              onValueChange={(v) => setCustomShadow((prev) => ({ ...prev, spread: v }))}
              formatValue={(v) => `${v}px`}
            />
          </div>
          <div className="flex justify-between items-center mt-2">
            <div className="text-xs font-inter font-light text-white">{t('shadowOpacity')} <span className="text-white/60">{Math.round(customShadow.opacity * 100)}%</span></div>
            <RangeWithTooltip
              className={SLIDER_W}
              min={0}
              max={1}
              step={0.01}
              value={customShadow.opacity}
              onValueChange={(v) => setCustomShadow((prev) => ({ ...prev, opacity: v }))}
              formatValue={(v) => `${Math.round(v * 100)}%`}
            />
          </div>
        </div>
      )}
      <div className="flex justify-between items-center mt-3">
        <div className="text-xs font-inter font-light text-white">{t('cornerRadius')}</div>
        <RangeWithTooltip
          className={SLIDER_W}
          value={curve}
          onValueChange={setCurve}
          dragging={draggingCurve}
          setDragging={setDraggingCurve}
          formatValue={(v) => `${v}px`}
        />
      </div>
      <div className="flex justify-between items-center mt-3">
        <div className="text-xs font-inter font-light text-white">{t('borderWidth')}</div>
        <RangeWithTooltip
          className={SLIDER_W}
          value={border}
          onValueChange={setBorder}
          dragging={draggingBorder}
          setDragging={setDraggingBorder}
          formatValue={(v) => `${v}px`}
        />
      </div>
      <div className="flex justify-between items-center mt-2">
        <div className="text-xs font-inter font-light text-white">{t('borderColorLabel')}</div>
        <input
          type="color"
          value={borderColor}
          onChange={(e) => setBorderColor(normalizeHexColorInput(e.target.value || '#ffffff'))}
          className="h-[20px] w-[20px] rounded-full border-0 cursor-pointer"
          aria-label={t('borderColorAria')}
        />
      </div>
      <div className="flex items-center justify-between mt-3">
        <div className="text-xs font-inter font-light text-white">{t('browserMockup')}</div>
        <button
          type="button"
          className="flex items-center gap-1 text-xs font-inter font-light text-[#757575] hover:text-white/70"
          onClick={() => setSelectedOsMockup('none')}
          title={t('reset')}
          aria-label={t('reset')}
        >
          <RotateCcw size={12} />
          <span>{t('reset')}</span>
        </button>
      </div>
      <div className="grid grid-cols-5 gap-[6px] mt-[6px] justify-items-start items-start w-full">
        {osMockups.map((m) => {
          const isActive = selectedOsMockup === m.id;
          return (
            <div key={m.id} className="flex flex-col items-center w-full min-w-0">
              <button
                type="button"
                onClick={() => setSelectedOsMockup((prev) => (prev === m.id ? 'none' : m.id))}
                className={(isActive ? 'bg-[#2A2A2A] shadow-[inset_0_0_0_1px_#4A4A4A]' : 'bg-transparent hover:bg-[#232323]') + ' rounded-[10px]'}
                style={{ width: 48, height: 48, padding: 4, boxSizing: 'border-box' }}
                aria-pressed={isActive}
              >
                <div className="w-full h-full rounded-[6px] overflow-hidden">
                  {m.thumb || m.src ? (
                    <img src={m.thumb || m.src} alt={m.label} className="block w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full rounded-[6px] border border-dashed border-white/20 bg-[#1F1F1F]" aria-hidden="true" />
                  )}
                </div>
              </button>
            </div>
          );
        })}
      </div>
      {selectedOsMockup === 'safari-1' && (
        <input
          type="text"
          value={safariMockupText}
          onChange={(e) => setSafariMockupText(e.target.value)}
          className="w-full mt-3 bg-[#2C2C2C] rounded-[4.5px] text-xs font-inter font-light text-white px-2 py-1"
          placeholder={t('safariTextPlaceholder')}
          aria-label={t('safariMockupTextAria')}
        />
      )}

      <div className="flex justify-between items-center mt-3">
        <div className="text-xs font-inter font-light text-white">{t('uiScale')}</div>
        <RangeWithTooltip
          className={SLIDER_W}
          value={uiScale}
          onValueChange={setUiScale}
          min={0.5}
          max={2}
          step={0.1}
          dragging={draggingUiScale}
          setDragging={setDraggingUiScale}
          formatValue={(v) => `${Number(v || 1).toFixed(1)}x`}
        />
      </div>
      <div className="flex items-center mt-3">
        <input
          type="checkbox"
          id="show-watermark"
          className="mr-2"
          checked={watermarkEnabled}
          onChange={(e) => setWatermarkEnabled(!!e.target.checked)}
        />
        <label htmlFor="show-watermark" className="text-xs font-inter font-light text-white cursor-pointer">{t('showWatermark')}</label>
      </div>
      <div className="flex justify-between items-center mt-3">
        <div className="text-xs font-inter font-light text-white">{t('positionLabel')}:</div>
        <div className="relative">
          <select className="bg-[#2C2C2C] rounded-[4.5px] text-xs font-inter font-light text-white pl-2 pr-8 py-1 appearance-none" value={watermarkPosition} onChange={(e) => setWatermarkPosition(e.target.value)}>
            <option value="inside">{t('watermarkPosInside')}</option>
            <option value="center-bottom">{t('watermarkPosBottomRight')}</option>
            <option value="top-left">{t('watermarkPosTopLeft')}</option>
            <option value="top-right">{t('watermarkPosTopRight')}</option>
            <option value="center-top">{t('watermarkPosCenterTop')}</option>
            <option value="bottom-left">{t('watermarkPosBottomLeft')}</option>
            <option value="bottom-right">{t('watermarkPosBottomRight')}</option>
            <option value="center-bottom">{t('watermarkPosBottomRight')}</option>
          </select>
          <div className="pointer-events-none absolute inset-y-0 right-2 flex items-center">
            <ChevronDown size={20} className="text-white" />
          </div>
        </div>
      </div>
      <input
        type="text"
        value={watermarkText}
        onChange={(e) => setWatermarkText(e.target.value)}
        className="w-full mt-3 bg-[#2C2C2C] rounded-[4.5px] text-xs font-inter font-light text-white px-2 py-1"
        placeholder={t('watermarkPlaceholder')}
      />
      <div className="mt-3 grid grid-cols-2 gap-2 py-2">
        <div className="flex items-center">
          <input
            type="checkbox"
            id="twitter-logo"
            className="mr-2"
            checked={watermarkPrefix === 'twitter'}
            onChange={(e) => {
              const on = !!e.target.checked;
              const next = on ? 'twitter' : 'none';
              setWatermarkPrefix(next);
              setWatermarkShowTwitter(next === 'twitter');
            }}
          />
          <label htmlFor="twitter-logo" className="text-xs font-inter font-light text-white cursor-pointer">{t('twitterLogo')}</label>
        </div>
        <div className="flex items-center justify-end">
          <input
            type="checkbox"
            id="email-logo"
            className="mr-2"
            checked={watermarkPrefix === 'mail'}
            onChange={(e) => {
              const on = !!e.target.checked;
              const next = on ? 'mail' : 'none';
              setWatermarkPrefix(next);
              setWatermarkShowTwitter(next === 'twitter');
            }}
          />
          <label htmlFor="email-logo" className="text-xs font-inter font-light text-white cursor-pointer">{t('emailLogo')}</label>
        </div>
        <div className="flex items-center">
          <input
            type="checkbox"
            id="youtube-logo"
            className="mr-2"
            checked={watermarkPrefix === 'youtube'}
            onChange={(e) => {
              const on = !!e.target.checked;
              const next = on ? 'youtube' : 'none';
              setWatermarkPrefix(next);
              setWatermarkShowTwitter(next === 'twitter');
            }}
          />
          <label htmlFor="youtube-logo" className="text-xs font-inter font-light text-white cursor-pointer">{t('youtubeLogo')}</label>
        </div>
        <div className="flex items-center justify-end">
          <input
            type="checkbox"
            id="checkmark"
            className="mr-2"
            checked={watermarkShowVerified}
            onChange={(e) => setWatermarkShowVerified(!!e.target.checked)}
          />
          <label htmlFor="checkmark" className="text-xs font-inter font-light text-white cursor-pointer">{t('checkmark')}</label>
        </div>
      </div>
      <div className="mt-4 rounded-[10px] border border-white/10 bg-[#232323]/70 px-3 py-2">
        <button
          type="button"
          className="w-full flex justify-between items-center"
          onClick={() => setIsAdvancedOpen((prev) => !prev)}
        >
          <div className="text-xs font-inter font-light text-white">{t('morePositionSettings')}</div>
          <motion.div
            className="text-xs font-inter font-light text-white"
            animate={{ rotate: isAdvancedOpen ? 0 : -90 }}
            transition={{ duration: 0.15 }}
          >▾</motion.div>
        </button>
      </div>
      <AnimatePresence>
        {isAdvancedOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16 }}
            className="mt-3 rounded-[10px] border border-white/10 bg-[#1f1f1f]/85 p-3"
          >
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs font-inter font-light text-white mb-1">{t('watermarkOffsetX')}</div>
                <input
                  type="number"
                  className="w-full bg-[#2C2C2C] rounded-[4.5px] text-xs font-inter font-light text-white px-2 py-1"
                  value={watermarkOffsetX}
                  onChange={(e) => setWatermarkOffsetX(Number(e.target.value) || 0)}
                />
              </div>
              <div>
                <div className="text-xs font-inter font-light text-white mb-1">{t('watermarkOffsetY')}</div>
                <input
                  type="number"
                  className="w-full bg-[#2C2C2C] rounded-[4.5px] text-xs font-inter font-light text-white px-2 py-1"
                  value={watermarkOffsetY}
                  onChange={(e) => setWatermarkOffsetY(Number(e.target.value) || 0)}
                />
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <div className="flex justify-between items-center mb-2">
                <div className="text-xs font-inter font-light text-white">{t('tiltX')}</div>
                <RangeWithTooltip
                  className={SLIDER_W}
                  min={-50}
                  max={50}
                  origin={0}
                  value={tiltX}
                  onValueChange={setTiltX}
                  dragging={draggingTiltX}
                  setDragging={setDraggingTiltX}
                  formatValue={(v) => `${v}°`}
                />
              </div>
              <div className="flex justify-between items-center mb-2">
                <div className="text-xs font-inter font-light text-white">{t('tiltY')}</div>
                <RangeWithTooltip
                  className={SLIDER_W}
                  min={-50}
                  max={50}
                  origin={0}
                  value={tiltY}
                  onValueChange={setTiltY}
                  dragging={draggingTiltY}
                  setDragging={setDraggingTiltY}
                  formatValue={(v) => `${v}°`}
                />
              </div>
              <div className="flex justify-between items-center mb-2">
                <div className="text-xs font-inter font-light text-white">{t('rotation')}</div>
                <RangeWithTooltip
                  className={SLIDER_W}
                  min={-50}
                  max={50}
                  origin={0}
                  value={rotation}
                  onValueChange={setRotation}
                  dragging={draggingRotation}
                  setDragging={setDraggingRotation}
                  formatValue={(v) => `${v}°`}
                />
              </div>
            </div>
            <div className="flex gap-4 mt-4 pt-1">
              <div className="flex items-center">
                <span className="text-xs font-inter font-light text-white mr-2">X:</span>
                <input
                  type="number"
                  className="bg-[#2C2C2C] rounded-[4.5px] text-xs font-inter font-light text-white px-2 py-1 w-16 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  value={Math.round(Number(transform?.x) || 0)}
                  onChange={(e) => {
                    const nextX = Number(e.target.value);
                    handleTransformChange({ x: Number.isFinite(nextX) ? nextX : 0, y: Number(transform?.y) || 0 });
                  }}
                />
              </div>
              <div className="flex items-center">
                <span className="text-xs font-inter font-light text-white mr-2">Y:</span>
                <input
                  type="number"
                  className="bg-[#2C2C2C] rounded-[4.5px] text-xs font-inter font-light text-white px-2 py-1 w-16 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  value={Math.round(Number(transform?.y) || 0)}
                  onChange={(e) => {
                    const nextY = Number(e.target.value);
                    handleTransformChange({ x: Number(transform?.x) || 0, y: Number.isFinite(nextY) ? nextY : 0 });
                  }}
                />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
