import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ChevronDown, Check, Plus } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import { channelLabel } from '@/lib/utils'

export function ChannelSwitcherHeader() {
  const { state, activeChannel, setActiveChannel, showToast, t } = useApp()
  const [open, setOpen] = useState(false)

  if (!activeChannel) return null

  const handleSelect = (id: string) => {
    setActiveChannel(id)
    setOpen(false)
  }

  return (
    <>
      {/* ── Compact header bar ── */}
      <div className="flex items-center px-4 pt-3 pb-2">
        <motion.button
          whileTap={{ scale: 0.97 }}
          transition={{ duration: 0.1 }}
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 min-w-0 rounded-[12px] py-1 pr-2 -ml-1 pl-1 hover:bg-white/[0.04] transition-colors active:bg-white/[0.06]"
        >
          <div className="w-7 h-7 rounded-full bg-[rgba(255,106,0,0.14)] border border-[rgba(255,106,0,0.20)] flex items-center justify-center text-[11px] font-bold text-[#FF6A00] shrink-0">
            {activeChannel.title[0]}
          </div>
          <span className="text-[16px] font-semibold text-white tracking-tight leading-none">
            {channelLabel(activeChannel)}
          </span>
          <ChevronDown size={13} className="text-[#55555D] shrink-0 mt-px" />
        </motion.button>
      </div>

      {/* ── Channel switcher sheet ── */}
      <AnimatePresence>
        {open && (
          <div key="switcher-overlay" className="fixed inset-0 z-[200]">

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22 }}
              className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
              onClick={() => setOpen(false)}
            />

            <div className="absolute inset-x-0 bottom-0 flex justify-center pointer-events-none">
              <motion.div
                initial={{ y: 40, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 40, opacity: 0 }}
                transition={{ type: 'spring', damping: 32, stiffness: 320 }}
                className="pointer-events-auto w-full max-w-[430px] bg-[#0F0F11] border border-white/[0.07] border-b-0 rounded-t-[22px] overflow-hidden"
                style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
              >
                {/* Drag handle */}
                <div className="flex justify-center pt-3 pb-1">
                  <div className="w-8 h-[3px] rounded-full bg-white/[0.12]" />
                </div>

                {/* Title */}
                <div className="px-5 pt-3 pb-2">
                  <p className="text-[11px] font-semibold text-[#44444C] uppercase tracking-wider">
                    {t('channelSwitcher.title')}
                  </p>
                </div>

                {/* Channel rows */}
                <div className="px-3 pb-3">
                  {state.channels.filter(ch=>ch.kind!=='chat').map(ch => {
                    const isActive = ch.id === state.activeChannelId
                    return (
                      <motion.button
                        key={ch.id}
                        whileTap={{ scale: 0.99 }}
                        onClick={() => handleSelect(ch.id)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[14px] hover:bg-white/[0.04] active:bg-white/[0.06] transition-colors text-left"
                      >
                        {/* Avatar */}
                        <div className={`w-9 h-9 rounded-full flex items-center justify-center text-[13px] font-bold shrink-0 ${
                          isActive
                            ? 'bg-[rgba(255,106,0,0.14)] text-[#FF6A00] border border-[rgba(255,106,0,0.22)]'
                            : 'bg-white/[0.05] text-[#66666E] border border-white/[0.07]'
                        }`}>
                          {ch.title[0]}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <p className="text-[14px] font-semibold text-white truncate">
                            {channelLabel(ch)}
                          </p>
                          <p className="text-[11px] text-[#44444C]">
                            {ch.subscribersCount == null ? '—' : ch.subscribersCount.toLocaleString()} {t('channelSwitcher.subscribers')}
                          </p>
                        </div>

                        {/* Status + checkmark */}
                        <div className="flex items-center gap-2 shrink-0">
                          {ch.isConnected && (
                            <div className="flex items-center gap-1 px-1.5 py-px rounded-full bg-white/[0.04] border border-white/[0.06]">
                              <div className="w-1 h-1 rounded-full bg-[#FF6A00]" />
                              <span className="text-[10px] text-[#55555D]">{t('channelSwitcher.live')}</span>
                            </div>
                          )}
                          {isActive ? (
                            <div className="w-5 h-5 rounded-full bg-[#FF6A00] flex items-center justify-center shrink-0">
                              <Check size={11} className="text-white" strokeWidth={2.5} />
                            </div>
                          ) : (
                            <div className="w-5 h-5 rounded-full border border-white/[0.10] shrink-0" />
                          )}
                        </div>
                      </motion.button>
                    )
                  })}

                  {/* Divider */}
                  <div className="mx-3 my-1.5 h-px bg-white/[0.05]" />

                  {/* Add channel */}
                  <button
                    onClick={() => { showToast(t('channelSwitcher.addChannel') + ' — coming soon'); setOpen(false) }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-[14px] hover:bg-white/[0.03] transition-colors text-left"
                  >
                    <div className="w-9 h-9 rounded-full bg-white/[0.03] border border-white/[0.06] flex items-center justify-center shrink-0">
                      <Plus size={14} className="text-[#44444C]" />
                    </div>
                    <p className="text-[14px] font-medium text-[#44444C]">{t('channelSwitcher.addChannel')}</p>
                  </button>
                </div>
              </motion.div>
            </div>
          </div>
        )}
      </AnimatePresence>
    </>
  )
}
