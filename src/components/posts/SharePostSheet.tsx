import { Bookmark, ChevronRight, Image as ImageIcon, MessageCircle, Send, Share2, UsersRound } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { useApp } from '@/context/AppContext'
import { cn } from '@/lib/utils'

interface SharePostSheetProps {
  open: boolean
  onClose: () => void
  postTitle: string
  previewUrl?: string | null
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
  postTitle,
  previewUrl,
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
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-[14px] border border-white/[0.07] bg-white/[0.025] p-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-[11px] border border-white/[0.08] bg-[#17171A]">
            {previewUrl
              ? <img src={previewUrl} alt="" className="h-full w-full object-cover" />
              : <ImageIcon size={20} className="text-[#55555D]" />}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-[#66666E]">{t('postDetails.sendSheetPreview')}</p>
            <p className="mt-1 line-clamp-2 text-[13px] font-semibold leading-snug text-white">{postTitle}</p>
            <span className="mt-1.5 inline-flex rounded-full border border-[#FF6A00]/20 bg-[#FF6A00]/10 px-2 py-0.5 text-[9px] font-semibold text-[#FF7A1A]">Rich Message</span>
          </div>
        </div>

        <div>
          <p className="text-[12px] font-semibold text-white">{t('postDetails.sendSheetChoose')}</p>
          <p className="mt-1 text-[10px] leading-relaxed text-[#71717A]">{t('postDetails.sendSheetChooseHint')}</p>
        </div>

        <div className="space-y-2">
          <button
            type="button"
            onClick={onPublish}
            disabled={busy || !channelConnected}
            className={cn(
              'relative flex min-h-[82px] w-full cursor-pointer items-center gap-3 overflow-hidden rounded-[14px] border p-3 text-left transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6A00]',
              channelConnected
                ? 'border-[#FF6A00]/25 bg-[#FF6A00]/[0.065] hover:border-[#FF6A00]/45 hover:bg-[#FF6A00]/[0.09]'
                : 'cursor-not-allowed border-white/[0.06] bg-white/[0.02] opacity-55',
            )}
          >
            <span className="absolute inset-y-0 left-0 w-1 bg-[#FF6A00]" />
            <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-[12px] border border-[#FF6A00]/20 bg-[#FF6A00]/10 text-[#FF6A00]">
              {publishing
                ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#FF6A00]/30 border-t-[#FF6A00]" />
                : channelAvatarUrl
                  ? <img src={channelAvatarUrl} alt="" className="h-full w-full object-cover" />
                  : <Send size={18} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-semibold text-white">{t('postDetails.publishToChannel')}</span>
              <span className="mt-1 block truncate text-[10px] text-[#8B8B94]">
                {channelConnected
                  ? `${channelTitle ?? ''}${channelUsername ? ` · @${channelUsername.replace(/^@/, '')}` : ''}`
                  : t('postDetails.channelUnavailable')}
              </span>
              <span className="mt-0.5 block text-[9px] text-[#66666E]">{t('postDetails.publishToChannelHint')}</span>
            </span>
            <ChevronRight size={17} className="shrink-0 text-[#71717A]" />
          </button>

          <button
            type="button"
            onClick={onShare}
            disabled={busy}
            className="relative flex min-h-[98px] w-full cursor-pointer items-center gap-3 overflow-hidden rounded-[14px] border border-[#2AABEE]/25 bg-[#2AABEE]/[0.06] p-3 text-left transition-colors duration-200 hover:border-[#2AABEE]/45 hover:bg-[#2AABEE]/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2AABEE] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="absolute inset-y-0 left-0 w-1 bg-[#2AABEE]" />
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] border border-[#2AABEE]/20 bg-[#2AABEE]/10 text-[#54BDF2]">
              {sharing
                ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-[#54BDF2]/30 border-t-[#54BDF2]" />
                : <Share2 size={18} />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-semibold text-white">{t('postDetails.shareToTelegram')}</span>
              <span className="mt-1 block text-[10px] leading-snug text-[#8B8B94]">{t('postDetails.shareToTelegramHint')}</span>
              <span className="mt-2 flex flex-wrap gap-1.5 text-[9px] text-[#73737C]">
                <span className="inline-flex items-center gap-1"><MessageCircle size={10} />{t('postDetails.shareContact')}</span>
                <span className="inline-flex items-center gap-1"><Bookmark size={10} />{t('postDetails.shareSaved')}</span>
                <span className="inline-flex items-center gap-1"><UsersRound size={10} />{t('postDetails.shareGroupChannel')}</span>
              </span>
            </span>
            <ChevronRight size={17} className="shrink-0 text-[#71717A]" />
          </button>
        </div>

        <p className="px-2 text-center text-[10px] leading-relaxed text-[#66666E]">{t('postDetails.telegramWillOpen')}</p>
      </div>
    </Sheet>
  )
}
