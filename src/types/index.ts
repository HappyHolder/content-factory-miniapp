export type PostStatus = 'new' | 'scheduled' | 'published'
export type SourceType = 'bot' | 'link' | 'prompt' | 'text' | 'photo' | 'forwarded_post'
// 'any' = "no preference" — the form shows a "Не важно" pill and the AI is left
// free on that dimension (the server skips 'any' when building the style prompt).
export type Tone = 'expert' | 'calm' | 'founder' | 'crypto' | 'bold' | 'meme' | 'any'
export type PostLength = 'short' | 'medium' | 'long' | 'any'
export type AddressStyle = 'ты' | 'вы' | 'any'
export type Language = 'RU' | 'EN'
export type LinkUsage = 'inline' | 'button' | 'signature' | 'when_relevant' | 'always'
export type BannerTemplate = 'dark_glass' | 'minimal' | 'branded' | 'news'

// New types for redesigned channel style profile
export type AuthorRole = 'founder' | 'expert' | 'media' | 'team' | 'personal' | 'any'
export type ParagraphStyle = 'short' | 'medium' | 'long'
export type ListUsage = 'never' | 'when_relevant' | 'always'
export type CoverAspectRatio = '16:9' | '4:5' | '1:1' | '9:16'
export type LogoUsage = 'always' | 'when_relevant' | 'never'

export interface ChannelAbout {
  topic: string
  targetAudience: string
  contentGoal: string
}

export type PlanTier = 'free' | 'starter' | 'creator' | 'studio_pro'

export interface Subscription {
  planTier: PlanTier
  planName: string
  billingPeriod: 'monthly'
  renewsAt: string
  status: 'active'
  // Quota counters from backend
  aiPostsLimit: number
  aiPostsUsed: number
  aiCreatesLimit: number | null  // null = unlimited
  aiCreatesUsed: number
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
  isAdmin?: boolean
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
  // Free-text style guidance written by the channel owner. Injected verbatim
  // into the AI prompt as a hard rule. Optional / may be empty.
  customNote?: string
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

export interface ReferenceItem {
  url: string
  description?: string
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
  references?: ReferenceItem[]
  avoidList?: string[]
  // Named color tokens replacing primaryColor/secondaryColor swatch UI
  brandColors?: BrandColor[]
  // Visual font guidance for image generation (not app UI)
  visualFontPreset?: 'default' | 'serif' | 'sans' | 'mono' | 'display' | 'handwritten'
  visualFontRules?: string
  // Master visual style for all covers — used as base of every image prompt
  visualCoverStyle?: string
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
  // Free-text formatting guidance written by the channel owner. Injected verbatim
  // into the AI prompt as a hard rule. Optional / may be empty.
  customNote?: string
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
