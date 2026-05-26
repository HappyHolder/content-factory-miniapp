export type PostStatus = 'new' | 'scheduled' | 'published'
export type SourceType = 'bot' | 'link' | 'prompt' | 'text' | 'forwarded_post'
export type Tone = 'expert' | 'calm' | 'founder' | 'crypto' | 'bold' | 'meme'
export type PostLength = 'short' | 'medium' | 'long'
export type EmojiDensity = 'none' | 'light' | 'medium' | 'active'
export type AddressStyle = 'ты' | 'вы'
export type Language = 'RU' | 'EN'
export type LinkUsage = 'inline' | 'button' | 'signature' | 'when_relevant' | 'always'
export type BannerTemplate = 'dark_glass' | 'minimal' | 'branded' | 'news'

export type PlanTier = 'starter' | 'creator' | 'studio_pro'

export interface Subscription {
  planTier: PlanTier
  planName: string
  billingPeriod: 'monthly'
  renewsAt: string
  status: 'active'
}

export interface Plan {
  tier: PlanTier
  name: string
  price: string
  priceDetail: string
  features: string[]
}

export interface User {
  id: string
  name: string
  username: string
  avatarUrl?: string
  subscription: Subscription
}

export interface Channel {
  id: string
  username: string
  title: string
  avatarUrl?: string
  subscribersCount: number
  isDefault: boolean
  isConnected: boolean
}

export interface VoiceProfile {
  language: Language
  addressStyle: AddressStyle
  tone: Tone
  postLength: PostLength
  emojiDensity: EmojiDensity
  examplePosts: string[]
  favoriteWords: string[]
  forbiddenWords: string[]
}

export interface EmojiPackConfig {
  packLink: string
  strictMode: boolean
  allowedEmojis: string[]
  fallbackToStandard: boolean
}

export interface LinkItem {
  id: string
  label: string
  url: string
  anchorText: string
  buttonLabel: string
  usage: LinkUsage
}

export interface LinkKit {
  links: LinkItem[]
}

export interface VisualKit {
  logoUrl?: string
  primaryColor: string
  backgroundStyle: 'dark' | 'glass' | 'gradient'
  cardStyle: 'minimal' | 'branded' | 'bold'
  watermark: boolean
  bannerTemplate: BannerTemplate
}

export interface Signature {
  text: string
  cta?: string
  usage: 'always' | 'when_relevant' | 'never'
}

export interface PostRules {
  defaultStructure: string
  neverCopySource: boolean
  avoidClickbait: boolean
  shortParagraphs: boolean
  addCtaIfRelevant: boolean
  useLinkKitWhenRelevant: boolean
}

export interface BrandKit {
  channelId: string
  voiceProfile: VoiceProfile
  emojiPack: EmojiPackConfig
  linkKit: LinkKit
  visualKit: VisualKit
  signature: Signature
  postRules: PostRules
}

export interface PostVariant {
  id: string
  label: string
  text: string
  isSelected: boolean
}

export interface Banner {
  id: string
  templateId: BannerTemplate
  title: string
  subtitle?: string
  accentColor: string
  logoUrl?: string
  watermark: boolean
}

export interface GeneratedPost {
  id: string
  title: string
  sourceType: SourceType
  sourceUrl?: string
  sourceSummary?: string
  channelId: string
  channelUsername: string
  variants: PostVariant[]
  selectedVariantId?: string
  banner?: Banner
  linkButtons: LinkItem[]
  status: PostStatus
  createdAt: Date
  scheduledAt?: Date
  publishedAt?: Date
  textRegensUsed?: number
  imageRegensUsed?: number
}

export interface AppState {
  user: User
  channels: Channel[]
  brandKits: BrandKit[]
  posts: GeneratedPost[]
  activeChannelId: string
}
