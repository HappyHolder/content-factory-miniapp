export type PostStatus = 'new' | 'scheduled' | 'published'
export type SourceType = 'bot' | 'link' | 'prompt' | 'text' | 'forwarded_post'
export type Tone = 'expert' | 'calm' | 'founder' | 'crypto' | 'bold' | 'meme'
export type PostLength = 'short' | 'medium' | 'long'
export type AddressStyle = 'ты' | 'вы'
export type Language = 'RU' | 'EN'
export type LinkUsage = 'inline' | 'button' | 'signature' | 'when_relevant' | 'always'
export type BannerTemplate = 'dark_glass' | 'minimal' | 'branded' | 'news'

// New types for redesigned channel style profile
export type AuthorRole = 'founder' | 'expert' | 'media' | 'team' | 'personal'
export type ParagraphStyle = 'short' | 'medium' | 'long'
export type ListUsage = 'never' | 'when_relevant' | 'always'
export type CoverAspectRatio = '16:9' | '4:5' | '1:1' | '9:16'
export type LogoUsage = 'always' | 'when_relevant' | 'never'

export interface ChannelAbout {
  topic: string
  targetAudience: string
  contentGoal: string
}

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
  authorRole?: AuthorRole
  tone: Tone
  postLength: PostLength
  examplePosts: string[]
  favoriteWords: string[]
  forbiddenWords: string[]
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

export interface BrandColor {
  name:   string
  hex:    string
  usage?: string
}

export interface VisualKit {
  logoUrl?: string
  primaryColor: string
  backgroundStyle: 'dark' | 'glass' | 'gradient'
  cardStyle: 'minimal' | 'branded' | 'bold'
  watermark: boolean
  bannerTemplate: BannerTemplate
  // New cover fields
  secondaryColor?: string
  aspectRatio?: CoverAspectRatio
  textOnCover?: boolean
  logoUsage?: LogoUsage
  references?: string[]
  avoidList?: string[]
  // Named color tokens replacing primaryColor/secondaryColor swatch UI
  brandColors?: BrandColor[]
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
  // New format fields
  paragraphStyle?: ParagraphStyle
  listUsage?: ListUsage
  ctaUsage?: 'never' | 'when_relevant' | 'always'
  thingsToAvoid?: string[]
}

export interface BrandKit {
  channelId: string
  channelAbout?: ChannelAbout
  voiceProfile: VoiceProfile
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
  bannerUrl?: string | null
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

// Represents a bot-saved source input returned by POST /api/sources.
// type mirrors the DB SourceType enum values that the bot webhook creates.
export interface BotSource {
  id: string
  type: 'URL' | 'TEXT'
  content: string
  url: string | null      // extracted URL if type === 'URL', otherwise null
  channelId: string | null // from SourceInput.metadata.channelId
  createdAt: string        // ISO 8601 string from the API
}

export interface AppState {
  user: User
  channels: Channel[]
  brandKits: BrandKit[]
  posts: GeneratedPost[]
  activeChannelId: string
}
