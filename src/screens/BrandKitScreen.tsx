import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, Smile, Palette, Link, PenLine, FileCheck, ChevronRight } from 'lucide-react'
import { useApp } from '@/context/AppContext'
import type { TranslationKey } from '@/i18n'
import { PageHeader } from '@/components/layout/PageHeader'
import { GlassCard } from '@/components/ui/GlassCard'
import { brandKitService } from '@/services/brandKitService'
import { VoiceProfileForm } from '@/components/profile/VoiceProfileForm'
import { EmojiPackForm } from '@/components/profile/EmojiPackForm'
import { LinkKitForm } from '@/components/profile/LinkKitForm'
import { VisualKitForm } from '@/components/profile/VisualKitForm'
import { SignatureForm } from '@/components/profile/SignatureForm'
import { PostRulesForm } from '@/components/profile/PostRulesForm'

type SectionId = 'voice' | 'emoji' | 'visual' | 'links' | 'signature' | 'rules'

interface SectionConfig {
  id: SectionId
  icon: React.ElementType
}

const SECTIONS: SectionConfig[] = [
  { id: 'voice',     icon: Mic       },
  { id: 'emoji',     icon: Smile     },
  { id: 'visual',    icon: Palette   },
  { id: 'links',     icon: Link      },
  { id: 'signature', icon: PenLine   },
  { id: 'rules',     icon: FileCheck },
]

interface BrandKitScreenProps {
  channelId: string
  channelUsername: string
  onBack: () => void
}

export function BrandKitScreen({ channelId, channelUsername, onBack }: BrandKitScreenProps) {
  const { state, t } = useApp()
  const [activeSection, setActiveSection] = useState<SectionId | null>(null)

  const brandKit = brandKitService.getByChannelId(channelId)
    || state.brandKits.find(k => k.channelId === channelId)

  if (!brandKit) {
    return (
      <div className="px-4 py-8 text-center">
        <p className="text-[#A1A1AA]">{t('channelStyle.notFound')}</p>
      </div>
    )
  }

  const renderForm = () => {
    if (!activeSection) return null
    switch (activeSection) {
      case 'voice':     return <VoiceProfileForm channelId={channelId} initialData={brandKit.voiceProfile} />
      case 'emoji':     return <EmojiPackForm    channelId={channelId} initialData={brandKit.emojiPack}    />
      case 'visual':    return <VisualKitForm    channelId={channelId} initialData={brandKit.visualKit}    />
      case 'links':     return <LinkKitForm      channelId={channelId} initialLinks={brandKit.linkKit.links} />
      case 'signature': return <SignatureForm    channelId={channelId} initialData={brandKit.signature}    />
      case 'rules':     return <PostRulesForm    channelId={channelId} initialData={brandKit.postRules}    />
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -10 }}
      transition={{ duration: 0.22 }}
    >
      <PageHeader
        title={t('channelStyle.title')}
        subtitle={`@${channelUsername}`}
        onBack={onBack}
      />

      <div className="px-4 mt-1.5 space-y-1.5">
        {SECTIONS.map((section, i) => {
          const Icon = section.icon
          const isOpen = activeSection === section.id
          const titleKey = `channelStyle.sections.${section.id}` as TranslationKey
          const descKey  = `channelStyle.sections.${section.id}Desc` as TranslationKey
          return (
            <motion.div
              key={section.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05, duration: 0.2 }}
            >
              <GlassCard padding="none" className="overflow-hidden">
                <button
                  onClick={() => setActiveSection(isOpen ? null : section.id)}
                  className="w-full flex items-center gap-3 px-4 py-3"
                >
                  <div className={`w-8 h-8 rounded-[9px] flex items-center justify-center transition-colors ${
                    isOpen ? 'bg-[rgba(255,106,0,0.12)] text-[#FF6A00]' : 'bg-white/[0.05] text-[#66666E]'
                  }`}>
                    <Icon size={15} />
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <p className={`text-[13px] font-semibold ${isOpen ? 'text-[#FF6A00]' : 'text-white'}`}>
                      {t(titleKey)}
                    </p>
                    <p className="text-[11px] text-[#55555D]">{t(descKey)}</p>
                  </div>
                  <ChevronRight
                    size={13}
                    className={`text-[#44444C] transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`}
                  />
                </button>

                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 pt-1 border-t border-white/[0.06]">
                        {renderForm()}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </GlassCard>
            </motion.div>
          )
        })}
      </div>
    </motion.div>
  )
}
