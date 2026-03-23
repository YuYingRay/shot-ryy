import React from 'react'
import { motion } from 'framer-motion'
import ImageDisplay from '../../components/editor/ImageDisplay.jsx'
import { defaultShortcuts } from '../../utils/platform/preferences'
import { useAppContext } from './AppContext'

export default function CenterPreview() {
  const {
    fitViewportRef,
    fitScale,
    safeInsets,
    previewContentMargin,
    wrapperRef,
    exportRef,
    imageOptions,
    blob,
    annotationTool,
    shapeMode,
    setAnnotationTool,
    setLayoutMetrics,
    handleTransformChange,
    shortcuts,
    shortcutRecordingKey,
    setShortcutRecordingKey,
    formatShortcutLabel,
    takeScreenshot,
    annotationActionsRef,
  } = useAppContext()

  return (
    <div
      ref={fitViewportRef}
      className="absolute"
      style={{
        left: 16 + 270 + 32 + previewContentMargin,
        right: 16 + previewContentMargin,
        top: safeInsets.top,
        bottom: safeInsets.bottom,
        overflow: 'visible',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1,
      }}
    >
      <div
        style={{
          width: blob?.src ? 1000 : 'min(100%, 1240px)',
          maxWidth: '100%',
          position: 'relative',
        }}
      >
        {blob?.src ? (
          <div
            style={{
              transform: `translateZ(0) scale(${fitScale})`,
              transformOrigin: 'center center',
              willChange: 'transform',
            }}
          >
            <ImageDisplay
              key={blob.src}
              options={imageOptions}
              blob={blob}
              wrapperRef={wrapperRef}
              exportRef={exportRef}
              activeTool={annotationTool}
              shapeMode={shapeMode}
              onRequestDeselectTool={() => setAnnotationTool(null)}
              onLayoutMetrics={setLayoutMetrics}
              onTransformChange={handleTransformChange}
              annotationActionsRef={annotationActionsRef}
            />
          </div>
        ) : (
          <div
            ref={wrapperRef}
            className="mx-auto w-full max-w-[1240px] rounded-[28px] border border-white/10 bg-[#2C2C2C]/90 px-[26px] py-[24px] text-white shadow-[0_24px_64px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,255,255,0.06)]"
          >
            <div className="w-full max-w-[1120px] mx-auto text-white">
              <div className="space-y-5">
                {[
                  { key: 'screenshotRegion', label: 'Take screenshot with' },
                  { key: 'screenshotRegionCopy', label: 'Take screenshot and copy result with' },
                ].map((row) => {
                  const isRecording = shortcutRecordingKey === row.key
                  const combo = shortcuts?.[row.key] || defaultShortcuts?.[row.key] || ''
                  return (
                    <div key={row.key} className="flex items-center justify-between gap-4 rounded-[12px] px-1 py-0.5">
                      <div className="flex items-center gap-4 min-w-0">
                        <span className="text-[18px] leading-none font-inter font-light text-white/90 whitespace-nowrap">{row.label}</span>
                        <span className="inline-flex h-[34px] items-center rounded-[999px] bg-[#0F1116] border border-white/12 px-3 text-[18px] leading-none font-mono tracking-wide text-white/95 shadow-[0_6px_20px_rgba(0,0,0,0.26),inset_0_0_0_1px_rgba(255,255,255,0.03)]">
                          {formatShortcutLabel(combo)}
                        </span>
                      </div>
                      <button
                        type="button"
                        className={
                          'shotstyle-footer-btn font-inter font-light transition-colors border border-white/12 ' +
                          (isRecording
                            ? 'bg-[#7700FF] text-white'
                            : 'bg-[#232323] text-white/90 hover:bg-[#333333]')
                        }
                        onClick={() => setShortcutRecordingKey((prev) => (prev === row.key ? null : row.key))}
                      >
                        {isRecording ? 'Press keys…' : 'Change'}
                      </button>
                    </div>
                  )
                })}

                <div className="pt-1 flex items-center justify-center">
                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    type="button"
                    className="shotstyle-footer-btn bg-[#7700FF] font-inter font-light text-white shadow-[0_12px_28px_rgba(119,0,255,0.35)]"
                    onClick={takeScreenshot}
                  >
                    Take screenshot
                  </motion.button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
