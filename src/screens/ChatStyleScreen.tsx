import { motion } from 'framer-motion'
import { PageHeader } from '@/components/layout/PageHeader'
import { GlassCard } from '@/components/ui/GlassCard'
import { ChatStyleForm } from '@/components/profile/ChatStyleForm'
import { useApp } from '@/context/AppContext'

export function ChatStyleScreen({ chatId, chatTitle, onBack }: { chatId: string; chatTitle: string; onBack: () => void }) {
  const { state, t } = useApp()
  const style = state.chatStyles.find(item => item.chatId === chatId)
  if (!style) return <div className="px-4 py-8 text-center text-[#A1A1AA]">Настройки чата не найдены</div>
  return <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.22 }}>
    <PageHeader title={t('chatStyle.title')} subtitle={chatTitle} onBack={onBack} />
    <div className="px-4 pt-2"><GlassCard><ChatStyleForm chatId={chatId} initialAbout={style.channelAbout} initialVoice={style.voiceProfile} /></GlassCard></div>
  </motion.div>
}
