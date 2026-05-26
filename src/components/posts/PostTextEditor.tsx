import { useState } from 'react'
import { motion } from 'framer-motion'
import { Copy, Scissors, Zap } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useApp } from '@/context/AppContext'

interface PostTextEditorProps {
  postId: string
  variantId: string
  text: string
}

export function PostTextEditor({ postId, variantId, text }: PostTextEditorProps) {
  const { updateVariantText, showToast, t } = useApp()
  const [value, setValue] = useState(text)
  const charCount = value.length

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value)
    updateVariantText(postId, variantId, e.target.value)
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(value).catch(() => {})
    showToast(t('common.copied'))
  }

  const handleShorter = () => {
    showToast(t('postDetails.makeShorter') + '…')
  }

  const handleSharper = () => {
    showToast(t('postDetails.makeSharper') + '…')
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
        <span className={`text-xs ${charCount > 4096 ? 'text-red-400' : 'text-[#66666E]'}`}>
          {charCount} {t('postDetails.chars')}
        </span>
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm" onClick={handleShorter}>
            <Scissors size={13} />
            {t('postDetails.makeShorter')}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleSharper}>
            <Zap size={13} />
            {t('postDetails.makeSharper')}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleCopy}>
            <Copy size={13} />
          </Button>
        </div>
      </div>
    </motion.div>
  )
}
