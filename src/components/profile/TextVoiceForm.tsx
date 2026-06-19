import { useState, useRef } from 'react'
import { Upload, Loader2, X, FileText } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { OptionPills } from '@/components/ui/OptionPills'
import { useApp } from '@/context/AppContext'
import { cn } from '@/lib/utils'
import { getTelegramInitData } from '@/lib/telegram'
import { API_BASE } from '@/lib/api'
import type { VoiceProfile, Language, AddressStyle, AuthorRole, Tone, PostLength } from '@/types'

interface TextVoiceFormProps {
  channelId: string
  initialVoice: VoiceProfile
}

export function TextVoiceForm({ channelId, initialVoice }: TextVoiceFormProps) {
  const { updateBrandKit, showToast, language, t } = useApp()
  const [voice, setVoice] = useState<VoiceProfile>(initialVoice)
  const [isUploading, setIsUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const isRu = language === 'ru'

  const setV = <K extends keyof VoiceProfile>(key: K, val: VoiceProfile[K]) =>
    setVoice(prev => ({ ...prev, [key]: val }))

  const examples = voice.examplePosts ?? []
  const exampleCount = voice.exampleCount ?? 5

  const uploadPostsExport = async (file: File) => {
    const initData = getTelegramInitData()
    if (!initData) { showToast(isRu ? 'Ошибка авторизации' : 'Auth error', 'error'); return }
    setIsUploading(true)
    try {
      const form = new FormData()
      form.append('initData', initData)
      form.append('channelId', channelId)
      form.append('file', file)
      const res = await fetch(`${API_BASE}/api/brandkits/upload-posts-export`, { method: 'POST', body: form })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        showToast(err.error ?? (isRu ? 'Не удалось загрузить файл' : 'Upload failed'), 'error')
        return
      }
      const { posts } = await res.json() as { posts: string[] }
      setVoice(prev => ({ ...prev, examplePosts: posts, exampleCount: prev.exampleCount ?? 5 }))
      showToast(isRu ? `Загружено постов: ${posts.length}` : `Loaded ${posts.length} posts`)
    } catch {
      showToast(isRu ? 'Ошибка загрузки' : 'Upload failed', 'error')
    } finally {
      setIsUploading(false)
    }
  }

  const handleSave = () => {
    updateBrandKit(channelId, { voiceProfile: voice })
  }

  return (
    <div className="space-y-4">

      <OptionPills<Language>
        label={t('channelStyle.textVoice.language')}
        value={voice.language}
        onChange={v => setV('language', v)}
        options={[
          { value: 'RU', label: t('channelStyle.textVoice.langRU') },
          { value: 'EN', label: t('channelStyle.textVoice.langEN') },
          { value: 'BI', label: t('channelStyle.textVoice.langBI') },
        ]}
      />

      <OptionPills<AddressStyle>
        label={t('channelStyle.textVoice.addressStyle')}
        value={voice.addressStyle}
        onChange={v => setV('addressStyle', v)}
        options={[
          { value: 'ты', label: t('channelStyle.textVoice.addressTy') },
          { value: 'вы', label: t('channelStyle.textVoice.addressVy') },
          { value: 'any', label: t('channelStyle.textVoice.any') },
        ]}
      />

      <OptionPills<AuthorRole>
        label={t('channelStyle.textVoice.authorRole')}
        value={voice.authorRole ?? 'founder'}
        onChange={v => setV('authorRole', v)}
        options={[
          { value: 'founder', label: t('channelStyle.textVoice.roleFounder') },
          { value: 'expert',  label: t('channelStyle.textVoice.roleExpert')  },
          { value: 'media',   label: t('channelStyle.textVoice.roleMedia')   },
          { value: 'team',    label: t('channelStyle.textVoice.roleTeam')    },
          { value: 'personal',label: t('channelStyle.textVoice.rolePersonal')},
          { value: 'any',     label: t('channelStyle.textVoice.any')         },
        ]}
      />

      <OptionPills<Tone>
        label={t('channelStyle.textVoice.tone')}
        value={voice.tone}
        onChange={v => setV('tone', v)}
        options={[
          { value: 'founder', label: t('channelStyle.textVoice.toneFounder') },
          { value: 'expert',  label: t('channelStyle.textVoice.toneExpert')  },
          { value: 'calm',    label: t('channelStyle.textVoice.toneCalm')    },
          { value: 'bold',    label: t('channelStyle.textVoice.toneBold')    },
          { value: 'crypto',  label: t('channelStyle.textVoice.toneCrypto')  },
          { value: 'meme',    label: t('channelStyle.textVoice.toneMeme')    },
          { value: 'any',     label: t('channelStyle.textVoice.any')         },
        ]}
      />

      <OptionPills<PostLength>
        label={t('channelStyle.textVoice.postLength')}
        value={voice.postLength}
        onChange={v => setV('postLength', v)}
        options={[
          { value: 'short',  label: t('channelStyle.textVoice.lengthShort')  },
          { value: 'medium', label: t('channelStyle.textVoice.lengthMedium') },
          { value: 'long',   label: t('channelStyle.textVoice.lengthLong')   },
          { value: 'any',    label: t('channelStyle.textVoice.any')          },
        ]}
      />

      <div>
        <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-1.5">
          {t('channelStyle.textVoice.customNote')}
        </p>
        <textarea
          value={voice.customNote ?? ''}
          onChange={e => setV('customNote', e.target.value)}
          placeholder={t('channelStyle.textVoice.customNotePlaceholder')}
          rows={3}
          className="glass-input w-full px-3 py-2.5 text-sm resize-none"
        />
      </div>

      {/* ── Example posts (few-shot from channel export) ────────────────────── */}
      <div>
        <p className="text-xs font-medium text-[#66666E] uppercase tracking-wide mb-1">
          {isRu ? 'Примеры постов' : 'Example posts'}
        </p>
        <p className="text-[11px] text-[#55555D] mb-2">
          {isRu
            ? 'Загрузи экспорт канала (result.json) — модель будет писать в тоне твоих реальных постов'
            : 'Upload the channel export (result.json) — the model will write in your real posts’ voice'}
        </p>

        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={e => {
            const file = e.target.files?.[0]
            if (file) uploadPostsExport(file)
            e.target.value = ''
          }}
        />

        {examples.length > 0 && (
          <div className="flex items-center gap-2 p-2.5 rounded-[12px] bg-white/[0.03] border border-white/[0.06] mb-2">
            <FileText size={16} className="text-[#FF6A00] shrink-0" />
            <span className="flex-1 text-[12px] text-[#A1A1AA]">
              {isRu ? `Загружено постов: ${examples.length}` : `${examples.length} posts loaded`}
            </span>
            <button
              onClick={() => setVoice(prev => ({ ...prev, examplePosts: [] }))}
              className="text-[#55555D] hover:text-[#A1A1AA] transition-colors shrink-0"
            >
              <X size={14} />
            </button>
          </div>
        )}

        <Button
          variant="secondary"
          size="sm"
          onClick={() => fileRef.current?.click()}
          disabled={isUploading}
          fullWidth
        >
          {isUploading
            ? <><Loader2 size={13} className="animate-spin" />{isRu ? 'Загрузка…' : 'Uploading…'}</>
            : <><Upload size={13} />{examples.length > 0
                ? (isRu ? 'Заменить файл' : 'Replace file')
                : (isRu ? 'Загрузить result.json' : 'Upload result.json')}</>
          }
        </Button>

        {/* How many examples to feed the model */}
        {examples.length > 0 && (
          <div className="mt-3">
            <p className="text-[11px] text-[#55555D] mb-1.5">
              {isRu ? 'Использовать последние:' : 'Use the latest:'}
            </p>
            <div className="flex gap-1 p-1 rounded-[12px] bg-white/[0.04] border border-white/[0.06]">
              {[5, 10].map(n => (
                <button
                  key={n}
                  onClick={() => setV('exampleCount', n)}
                  className={cn(
                    'flex-1 py-1.5 rounded-[9px] text-[12px] font-semibold transition-all',
                    exampleCount === n
                      ? 'bg-[#FF6A00] text-white shadow-sm'
                      : 'text-[#55555D] hover:text-[#A1A1AA]'
                  )}
                >
                  {isRu ? `${n} постов` : `${n} posts`}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <Button variant="primary" size="md" onClick={handleSave} fullWidth>
        {t('channelStyle.save.textVoice')}
      </Button>
    </div>
  )
}
