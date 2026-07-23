import { useState } from 'react'
import { motion } from 'framer-motion'
import { Copy } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useApp } from '@/context/AppContext'
import { getTelegramInitData } from '@/lib/telegram'
import { API_BASE } from '@/lib/api'

interface PostTextEditorProps {
  postId: string
  variantId: string
  text: string
}

export function PostTextEditor({ postId, variantId, text }: PostTextEditorProps) {
  const { updateVariantText, showToast, t, authStatus } = useApp()
  const [value, setValue] = useState(text)
  const [isSaving, setIsSaving] = useState(false)
  const charCount = value.length

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value)
    updateVariantText(postId, variantId, e.target.value)
  }

  const handleSave = async () => {
    if (isSaving) return

    if (authStatus !== 'authenticated') {
      // Dev / mock mode — local state already updated on every keystroke
      showToast(t('postDetails.textSaved'))
      return
    }

    setIsSaving(true)
    try {
      const initData = getTelegramInitData()!
      const res = await fetch(`${API_BASE}/api/posts/update-variant`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ initData, postId, variantId, text: value }),
      })
      if (!res.ok) {
        const errData = await res.json() as { error?: string }
        showToast(errData.error ?? t('postDetails.scheduleFailed'), 'error')
        return
      }
      showToast(t('postDetails.textSaved'))
    } catch {
      showToast(t('postDetails.scheduleFailed'), 'error')
    } finally {
      setIsSaving(false)
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(value).catch(() => {})
    showToast(t('common.copied'))
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className="space-y-2"
    >
      <textarea
        value={value}
        onChange={handleChange}
        rows={10}
        className="glass-input w-full px-4 py-3 text-sm text-white leading-relaxed"
        placeholder={t('postDetails.postText')}
      />
      <div className="flex items-center justify-between">
        <span className="text-xs text-[#66666E]">
          {charCount} {t('postDetails.chars')}
        </span>
        <Button variant="ghost" size="sm" onClick={handleCopy}>
          <Copy size={13} />
        </Button>
      </div>
      <Button
        variant="secondary"
        size="sm"
        onClick={handleSave}
        disabled={isSaving}
        fullWidth
      >
        {isSaving ? t('common.loading') : t('postDetails.save')}
      </Button>
    </motion.div>
  )
}
