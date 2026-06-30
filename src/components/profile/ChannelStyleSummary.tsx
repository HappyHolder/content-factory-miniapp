import { useApp } from '@/context/AppContext'
import type { BrandKit, AuthorRole, Tone, PostLength, BannerTemplate } from '@/types'
import type { TranslationKey } from '@/i18n'

interface ChannelStyleSummaryProps {
  brandKit: BrandKit
}

// Maps exclude 'any' ("no preference") — that value is hidden from the summary.
const ROLE_KEY: Record<Exclude<AuthorRole, 'any'>, TranslationKey> = {
  founder:  'channelStyle.textVoice.roleFounder',
  expert:   'channelStyle.textVoice.roleExpert',
  media:    'channelStyle.textVoice.roleMedia',
  team:     'channelStyle.textVoice.roleTeam',
  personal: 'channelStyle.textVoice.rolePersonal',
}

const TONE_KEY: Record<Exclude<Tone, 'any'>, TranslationKey> = {
  founder: 'channelStyle.textVoice.toneFounder',
  expert:  'channelStyle.textVoice.toneExpert',
  calm:    'channelStyle.textVoice.toneCalm',
  bold:    'channelStyle.textVoice.toneBold',
  crypto:  'channelStyle.textVoice.toneCrypto',
  meme:    'channelStyle.textVoice.toneMeme',
}

const LENGTH_KEY: Record<Exclude<PostLength, 'any'>, TranslationKey> = {
  short:  'channelStyle.textVoice.lengthShort',
  medium: 'channelStyle.textVoice.lengthMedium',
  long:   'channelStyle.textVoice.lengthLong',
}

const COVER_STYLE_KEY: Record<BannerTemplate, TranslationKey> = {
  dark_glass: 'channelStyle.covers.styleDarkGlass',
  minimal:    'channelStyle.covers.styleMinimal',
  branded:    'channelStyle.covers.styleBranded',
  news:       'channelStyle.covers.styleNews',
}

export function ChannelStyleSummary({ brandKit }: ChannelStyleSummaryProps) {
  const { t, language } = useApp()
  const { channelAbout, voiceProfile, postRules, visualKit } = brandKit

  const hasTopic = !!channelAbout?.topic

  const roleStr   = voiceProfile.authorRole && voiceProfile.authorRole !== 'any' ? t(ROLE_KEY[voiceProfile.authorRole]) : null
  const toneStr   = voiceProfile.tone       !== 'any' ? t(TONE_KEY[voiceProfile.tone])       : null
  const lengthStr = voiceProfile.postLength !== 'any' ? t(LENGTH_KEY[voiceProfile.postLength]) : null

  // Deduplicate: role and tone can translate to the same word (e.g. 'Founder' / 'Основатель')
  const traits = [...new Set([
    roleStr,
    voiceProfile.language,
    toneStr,
    lengthStr,
  ].filter(Boolean) as string[])]

  const rubricModes = Array.from(new Set((visualKit.rubrics ?? []).map(r => r.mode).filter(Boolean)))
  const modeLabel = rubricModes.length === 1
    ? rubricModes[0] === 'ai_html' ? 'AI+HTML' : rubricModes[0]?.toUpperCase()
    : visualKit.coverMode === 'ai_html' ? 'AI+HTML' : visualKit.coverMode?.toUpperCase()
  const coverStyleStr = visualKit.rubrics?.length
    ? `${language === 'ru' ? 'Рубрики' : 'Rubrics'}: ${visualKit.rubrics.length}${modeLabel ? ` · ${modeLabel}` : ''}`
    : t(COVER_STYLE_KEY[visualKit.bannerTemplate])
  const coverHint = [
    coverStyleStr,
    visualKit.aspectRatio,
  ].filter(Boolean).join(' · ')

  const formatHint = postRules?.defaultStructure
    ? postRules.defaultStructure.split(' → ').slice(0, 2).join(' → ') + ' →…'
    : null

  return (
    <div className="px-4 mb-3">
      <div className="p-4 rounded-[16px] bg-[rgba(255,106,0,0.05)] border border-[rgba(255,106,0,0.14)]">
        <p className="text-[10px] font-semibold text-[#FF6A00] uppercase tracking-wider mb-2">
          {t('channelStyle.aiSummary')}
        </p>

        {hasTopic ? (
          <p className="text-[13px] font-medium text-white leading-snug mb-2.5">
            {channelAbout!.topic}
          </p>
        ) : (
          <p className="text-[12px] text-[#44444C] italic mb-2.5">
            {t('channelStyle.aiSummaryEmpty')}
          </p>
        )}

        <div className="flex flex-wrap gap-1.5">
          {traits.map((trait, i) => (
            <span
              key={i}
              className="text-[11px] text-[#A1A1AA] bg-white/[0.04] border border-white/[0.06] px-2 py-0.5 rounded-full"
            >
              {trait}
            </span>
          ))}
          {formatHint && (
            <span className="text-[11px] text-[#66666E] bg-white/[0.03] border border-white/[0.05] px-2 py-0.5 rounded-full font-mono">
              {formatHint}
            </span>
          )}
          {coverHint && (
            <span className="text-[11px] text-[#66666E] bg-white/[0.03] border border-white/[0.05] px-2 py-0.5 rounded-full">
              {coverHint}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
