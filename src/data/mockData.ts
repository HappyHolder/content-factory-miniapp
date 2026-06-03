import type {
  User, Channel, BrandKit, GeneratedPost, AppState
} from '@/types'

export const mockUser: User = {
  id: 'u1',
  name: 'Alex Founder',
  username: 'alexfounder',
  subscription: {
    planTier: 'creator',
    planName: 'Creator',
    billingPeriod: 'monthly',
    renewsAt: 'Jun 25',
    status: 'active',
    aiPostsLimit:   150,
    aiPostsUsed:    0,
    aiCreatesLimit: 60,
    aiCreatesUsed:  0,
  },
}

export const mockChannels: Channel[] = [
  {
    id: 'ch1',
    username: 'my_channel',
    title: 'My Channel',
    subscribersCount: 12400,
    isDefault: true,
    isConnected: true,
  },
  {
    id: 'ch2',
    username: 'tech_digest',
    title: 'Tech Digest',
    subscribersCount: 4200,
    isDefault: false,
    isConnected: true,
  },
]

export const mockBrandKits: BrandKit[] = [
  {
    channelId: 'ch1',
    channelAbout: {
      topic: 'Создание SaaS-продукта в открытую',
      targetAudience: 'Инди-фаундеры и стартап-билдеры',
      contentGoal: 'Делиться честным процессом, растить аудиторию и приводить заявки',
    },
    voiceProfile: {
      language: 'EN',
      addressStyle: 'ты',
      authorRole: 'founder',
      tone: 'founder',
      postLength: 'medium',
      examplePosts: [
        'We just hit 10k users. Here\'s what we learned building in public.',
        'The feature nobody asked for — but everyone needed.',
      ],
      favoriteWords: ['build', 'ship', 'launch', 'grow'],
      forbiddenWords: ['synergy', 'leverage', 'disrupt'],
    },
    linkKit: {
      links: [
        {
          id: 'l1',
          label: 'Product',
          url: 'https://example.com',
          anchorText: 'open the app',
          buttonLabel: 'Open Product',
          usage: 'button',
        },
        {
          id: 'l2',
          label: 'Telegram Channel',
          url: 'https://t.me/my_channel',
          anchorText: 'our channel',
          buttonLabel: 'Join Channel',
          usage: 'when_relevant',
        },
        {
          id: 'l3',
          label: 'Telegram Chat',
          url: 'https://t.me/my_channel_chat',
          anchorText: 'community chat',
          buttonLabel: 'Join Chat',
          usage: 'when_relevant',
        },
      ],
    },
    visualKit: {
      primaryColor: '#FF6A00',
      secondaryColor: '#1A0A00',
      backgroundStyle: 'dark',
      cardStyle: 'branded',
      watermark: true,
      bannerTemplate: 'dark_glass',
      logoUsage: 'when_relevant',
      aspectRatio: '16:9',
      textOnCover: true,
      references: [],
      avoidList: ['стоковые фото', 'перегруженные фоны'],
    },
    signature: {
      text: '— Alex, building in public',
      cta: 'Follow for more →',
      usage: 'always',
    },
    postRules: {
      defaultStructure: 'Хук → Контекст → Инсайт → CTA',
      neverCopySource: true,
      avoidClickbait: true,
      shortParagraphs: true,
      addCtaIfRelevant: true,
      useLinkKitWhenRelevant: true,
      paragraphStyle: 'short',
      listUsage: 'when_relevant',
      ctaUsage: 'when_relevant',
      thingsToAvoid: ['корпоративный жаргон', 'размытые метрики'],
    },
  },
  {
    channelId: 'ch2',
    channelAbout: {
      topic: 'Tech news and analysis',
      targetAudience: 'Tech professionals and enthusiasts',
      contentGoal: 'Deliver concise, accurate tech news coverage',
    },
    voiceProfile: {
      language: 'EN',
      addressStyle: 'вы',
      authorRole: 'media',
      tone: 'expert',
      postLength: 'short',
      examplePosts: [],
      favoriteWords: [],
      forbiddenWords: [],
    },
    linkKit: { links: [] },
    visualKit: {
      primaryColor: '#FF6A00',
      secondaryColor: '#0D1117',
      backgroundStyle: 'glass',
      cardStyle: 'minimal',
      watermark: false,
      bannerTemplate: 'minimal',
      logoUsage: 'always',
      aspectRatio: '16:9',
      textOnCover: true,
      references: [],
      avoidList: [],
    },
    signature: {
      text: 'Tech Digest',
      usage: 'when_relevant',
    },
    postRules: {
      defaultStructure: 'Headline → Key facts → Source',
      neverCopySource: true,
      avoidClickbait: false,
      shortParagraphs: true,
      addCtaIfRelevant: false,
      useLinkKitWhenRelevant: false,
      paragraphStyle: 'short',
      listUsage: 'when_relevant',
      ctaUsage: 'never',
      thingsToAvoid: [],
    },
  },
]

const now = new Date()
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600000)
const hoursFromNow = (h: number) => new Date(now.getTime() + h * 3600000)

export const mockPosts: GeneratedPost[] = [
  {
    id: 'p1',
    title: 'Telegram Stars — What Creators Need to Know',
    sourceType: 'bot',
    sourceSummary: 'Update about Telegram Stars monetization feature for channel owners',
    channelId: 'ch1',
    channelUsername: 'my_channel',
    variants: [
      {
        id: 'v1a',
        label: 'Expert',
        text: `Telegram Stars just became the most important monetization lever for channel owners.

Here's what actually changed and why it matters:

→ Stars can now be sent directly to channels, not just bots
→ The withdrawal threshold dropped from 1000 to 250 Stars
→ New analytics dashboard shows Stars per post

The real unlock: you can now gate premium content behind Stars without any third-party tool.

We've been testing this for 3 weeks. Engagement on paid posts: +340%.

If you run a channel over 5k subs — this week is the time to experiment.

— Alex, building in public`,
        isSelected: true,
      },
      {
        id: 'v1b',
        label: 'Short',
        text: `Telegram Stars update dropped and it's bigger than most people realize.

The key change: channels can now accept Stars directly, withdrawal threshold cut to 250.

One week to set this up before everyone else figures it out. ⚡

— Alex, building in public`,
        isSelected: false,
      },
      {
        id: 'v1c',
        label: 'Founder Take',
        text: `We've been waiting for this Telegram Stars update for months.

Monetizing a Telegram channel used to require bots, third-party services, or pure sponsor deals.

Now? Direct Stars. Lower threshold. Built-in analytics.

I'm not saying this replaces Patreon or Substack. I'm saying it gives us a native, frictionless option for the first time.

Building the next post series around this. Stay tuned.

— Alex, building in public`,
        isSelected: false,
      },
    ],
    selectedVariantId: 'v1a',
    banner: {
      id: 'b1',
      templateId: 'dark_glass',
      title: 'Telegram Stars Update',
      subtitle: 'What Creators Need to Know',
      accentColor: '#FF6A00',
      watermark: true,
    },
    linkButtons: [
      {
        id: 'l1',
        label: 'Product',
        url: 'https://example.com',
        anchorText: 'open the app',
        buttonLabel: 'Open Product',
        usage: 'button',
      },
    ],
    status: 'new',
    createdAt: hoursAgo(1),
  },
  {
    id: 'p2',
    title: 'How We Grew from 0 to 12k Subscribers',
    sourceType: 'prompt',
    sourceSummary: 'Founder journey: channel growth tactics that actually worked',
    channelId: 'ch1',
    channelUsername: 'my_channel',
    variants: [
      {
        id: 'v2a',
        label: 'Expert',
        text: `12,000 subscribers. Here's the honest breakdown.

Month 1–2: 0 → 400
Only tactic: posting every single day. No promotions. No ads. Consistency compounds.

Month 3–4: 400 → 2,100
Cross-posted to 3 related channels. One viral post about building in public hit 47 reposts.

Month 5–8: 2,100 → 8,000
Started the "weekly build log" format. Audience retention jumped. People came back every week.

Month 9–now: 8,000 → 12,400
Telegram Stars experiment. Premium posts started converting at 6%.

The meta-lesson: there's no growth hack. There's only a good product and showing up.

— Alex, building in public`,
        isSelected: false,
      },
      {
        id: 'v2b',
        label: 'Short',
        text: `0 to 12k subscribers. The real answer is boring: consistency + one format that resonates.

Weekly build logs. Posted every day for 9 months straight.

That's it.

— Alex, building in public`,
        isSelected: true,
      },
    ],
    selectedVariantId: 'v2b',
    banner: {
      id: 'b2',
      templateId: 'dark_glass',
      title: '0 → 12k Subscribers',
      subtitle: 'The Honest Breakdown',
      accentColor: '#FF6A00',
      watermark: true,
    },
    linkButtons: [],
    status: 'new',
    createdAt: hoursAgo(3),
  },
  {
    id: 'p3',
    title: 'AI Tools for Telegram Channel Owners in 2025',
    sourceType: 'link',
    sourceUrl: 'https://techcrunch.com/ai-tools-telegram-2025',
    sourceSummary: 'Article about emerging AI tools for Telegram content creators',
    channelId: 'ch1',
    channelUsername: 'my_channel',
    variants: [
      {
        id: 'v3a',
        label: 'News',
        text: `The AI tooling for Telegram creators just got a lot more serious.

TechCrunch covered the new wave: AI-native scheduling, auto-generated banners, brand voice models.

What's actually useful vs. hype:
✅ Voice-matched generation (saves 2h/week)
✅ Banner automation (no designer needed)
❌ Auto-publishing without review (dangerous)
❌ AI comments (feels fake, hurts trust)

The bar is rising. Channels that don't adapt will fall behind in the next 12 months.

— Alex, building in public`,
        isSelected: true,
      },
    ],
    selectedVariantId: 'v3a',
    banner: {
      id: 'b3',
      templateId: 'news',
      title: 'AI Tools for Telegram',
      subtitle: '2025 Overview',
      accentColor: '#FF6A00',
      watermark: true,
    },
    linkButtons: [],
    status: 'new',
    createdAt: hoursAgo(6),
  },
  {
    id: 'p4',
    title: 'Weekly Build Log #47 — Shipping the API',
    sourceType: 'text',
    sourceSummary: 'Weekly update about shipping the public API',
    channelId: 'ch1',
    channelUsername: 'my_channel',
    variants: [
      {
        id: 'v4a',
        label: 'Founder Take',
        text: `Build log #47. We shipped the public API this week.

6 months in the making. 3 false starts. One complete redesign.

What we got wrong: building for developers who don't exist yet instead of for the 12 people already using the private beta.

What finally worked: interviewing 5 actual users, stripping 70% of the planned endpoints, shipping in 48 hours.

The API is now live. 3 integrations built by the community in the first 72 hours.

Next week: documentation, authentication improvements, rate limiting.

— Alex, building in public`,
        isSelected: true,
      },
    ],
    selectedVariantId: 'v4a',
    banner: {
      id: 'b4',
      templateId: 'branded',
      title: 'Build Log #47',
      subtitle: 'API is Live',
      accentColor: '#FF6A00',
      watermark: true,
    },
    linkButtons: [
      {
        id: 'l1',
        label: 'Product',
        url: 'https://example.com',
        anchorText: 'open the app',
        buttonLabel: 'Open Product',
        usage: 'button',
      },
    ],
    status: 'scheduled',
    createdAt: hoursAgo(12),
    scheduledAt: hoursFromNow(6),
  },
  {
    id: 'p5',
    title: 'The Mistake That Almost Killed the Project',
    sourceType: 'prompt',
    sourceSummary: 'Story about an early mistake and what we learned',
    channelId: 'ch1',
    channelUsername: 'my_channel',
    variants: [
      {
        id: 'v5a',
        label: 'Expert',
        text: `18 months ago, I made a mistake that almost ended this project.

I hired a team of 6 before we had product-market fit.

The logic seemed sound: move faster, ship more, scale the vision.

What actually happened:
→ Burn rate hit $22k/month
→ We had 3 competing product directions
→ Nobody owned anything
→ I was managing people instead of building

We ran out of runway 4 months later.

What saved us: downsizing to 2 people, cutting scope to one feature, and focusing on 10 paying users instead of 10,000 free users.

The lesson: premature scaling kills more startups than lack of ideas.

— Alex, building in public`,
        isSelected: true,
      },
    ],
    selectedVariantId: 'v5a',
    banner: {
      id: 'b5',
      templateId: 'dark_glass',
      title: 'The Mistake',
      subtitle: 'What I Learned the Hard Way',
      accentColor: '#FF6A00',
      watermark: true,
    },
    linkButtons: [],
    status: 'scheduled',
    createdAt: hoursAgo(24),
    scheduledAt: hoursFromNow(18),
  },
  {
    id: 'p6',
    title: 'Why We Chose Telegram Over Twitter/X',
    sourceType: 'prompt',
    sourceSummary: 'Decision post: platform strategy for building in public',
    channelId: 'ch1',
    channelUsername: 'my_channel',
    variants: [
      {
        id: 'v6a',
        label: 'Founder Take',
        text: `Why Telegram instead of X for building in public?

Simple: ownership.

On X, the algorithm decides who sees your content. One update and your reach drops 80%.

On Telegram, every subscriber gets every post. The relationship is direct.

Secondary reason: the audience. Telegram users in the tech/crypto/product space are more engaged, more action-oriented, and actually click links.

18 months in: 12k subscribers, 34% average open rate.

X can be a discovery channel. Telegram is where the community lives.

— Alex, building in public`,
        isSelected: true,
      },
    ],
    selectedVariantId: 'v6a',
    banner: {
      id: 'b6',
      templateId: 'minimal',
      title: 'Telegram vs X',
      subtitle: 'Platform Strategy 2025',
      accentColor: '#FF6A00',
      watermark: false,
    },
    linkButtons: [],
    status: 'published',
    createdAt: hoursAgo(72),
    publishedAt: hoursAgo(70),
  },
  {
    id: 'p7',
    title: 'The 10 Minute Content System',
    sourceType: 'text',
    sourceSummary: 'Productivity system for creating channel content quickly',
    channelId: 'ch1',
    channelUsername: 'my_channel',
    variants: [
      {
        id: 'v7a',
        label: 'Short',
        text: `10 minutes. One post. Every morning.

The system: keep a notes app open during the day. When something interesting happens — a decision, a mistake, an insight — drop it in.

Next morning: pick one note, expand it to 200 words, post.

That's it. No planning sessions. No content calendar. No scheduling headaches.

12k subscribers built on 10 minutes a day.

— Alex, building in public`,
        isSelected: true,
      },
    ],
    selectedVariantId: 'v7a',
    banner: {
      id: 'b7',
      templateId: 'dark_glass',
      title: '10-Minute System',
      subtitle: 'Daily Content That Converts',
      accentColor: '#FF6A00',
      watermark: true,
    },
    linkButtons: [],
    status: 'published',
    createdAt: hoursAgo(120),
    publishedAt: hoursAgo(118),
  },
]

export const mockInitialState: AppState = {
  user: mockUser,
  channels: mockChannels,
  brandKits: mockBrandKits,
  posts: mockPosts,
  activeChannelId: 'ch1',
}
