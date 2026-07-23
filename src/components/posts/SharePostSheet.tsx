import { ChevronRight, Forward, Send } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { useApp } from '@/context/AppContext'
import { cn } from '@/lib/utils'

interface SharePostSheetProps {
  open: boolean
  onClose: () => void
  channelTitle?: string
  channelUsername?: string
  channelAvatarUrl?: string
  channelConnected: boolean
  publishing: boolean
  sharing: boolean
  onPublish: () => void
  onShare: () => void
}

export function SharePostSheet({
  open,
  onClose,
  channelTitle,
  channelUsername,
  channelAvatarUrl,
  channelConnected,
  publishing,
  sharing,
  onPublish,
  onShare,
}: SharePostSheetProps) {
  const { t } = useApp()
  const busy = publishing || sharing

  return (
    <Sheet open={open} onClose={() => { if (!busy) onClose() }} title={t('postDetails.sendSheetTitle')} height="auto">
      <div className="space-y-3 pt-1">
        <div className="overflow-hidden rounded-[16px] border border-white/[0.07] bg-white/[0.025] divide-y divide-white/[0.06]">
          <button
            type="button"
            onClick={onPublish}
            disabled={busy || !channelConnected}
            className={cn(
              'flex min-h-[76px] w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#FF6A00]',
              channelConnected ? 'hover:bg-white/[0.04]' : 'cursor-not-allowed opacity-40',
            )}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[12px] bg-[rgba(255,106,0,0.12)] text-[#FF6A00]">
              {publishing
                ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#FF6A00]/30 border-t-[#FF6A00]" />
                : channelAvatarUrl
                  ? <img src={channelAvatarUrl} alt="" className="h-full w-full object-cover" />
                  : <Send size={18} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-white">{t('postDetails.publishToChannel')}</span>
              <span className="mt-1 block truncate text-[11px] text-[#777780]">
                {channelConnected
                  ? `${channelTitle ?? ''}${channelUsername ? ` · @${channelUsername.replace(/^@/, '')}` : ''}`
                  : t('postDetails.channelUnavailable')}
              </span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-[#55555D]" />
          </button>

          <button
            type="button"
            onClick={onShare}
            disabled={busy}
            className="flex min-h-[76px] w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors duration-200 hover:bg-white/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#FF6A00] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-white/[0.05] text-[#A1A1AA]">
              {sharing
                ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-[#A1A1AA]" />
                : <Forward size={18} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold text-white">{t('postDetails.shareToTelegram')}</span>
              <span className="mt-1 block text-[11px] text-[#777780]">{t('postDetails.shareToTelegramHint')}</span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-[#55555D]" />
          </button>
        </div>

        <p className="px-1 text-[11px] leading-relaxed text-[#66666E]">{t('postDetails.telegramWillOpen')}</p>
      </div>
    </Sheet>
  )
}
