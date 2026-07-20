import type { PlanTier, SubscriptionTierLimits } from '@/types'

export const PLAN_NAMES: Record<PlanTier, string> = {
  free: 'Free', starter: 'Starter', creator: 'Creator', studio_pro: 'Studio Pro',
}

export const SUBSCRIPTION_LIMITS: Record<PlanTier, SubscriptionTierLimits> = {
  free: {
    textGenerationsLimit: 30, visualGenerationsLimit: 0, channelLimit: 1, communityChatLimit: 1,
    assistantMessagesLimit: 100, contentManagerPostsLimit: 7, aiModeratorChecksLimit: 0,
    communityManagerActionsLimit: 0, communityCorePersonaLimit: 0, customBotChatLimit: 0,
    canSchedule: true, canUseAiAssistant: true, canUseContentManager: true, canUseAiVisuals: false,
    canUseHtmlCovers: false, canUseAiModerator: false, canUseCommunityManager: false, canUseCommunityCore: false,
  },
  starter: {
    textGenerationsLimit: 150, visualGenerationsLimit: 45, channelLimit: 2, communityChatLimit: 2,
    assistantMessagesLimit: 1000, contentManagerPostsLimit: 45, aiModeratorChecksLimit: 5000,
    communityManagerActionsLimit: 300, communityCorePersonaLimit: 2, customBotChatLimit: 1,
    canSchedule: true, canUseAiAssistant: true, canUseContentManager: true, canUseAiVisuals: true,
    canUseHtmlCovers: true, canUseAiModerator: true, canUseCommunityManager: true, canUseCommunityCore: true,
  },
  creator: {
    textGenerationsLimit: 600, visualGenerationsLimit: 200, channelLimit: 5, communityChatLimit: 5,
    assistantMessagesLimit: 3000, contentManagerPostsLimit: 200, aiModeratorChecksLimit: 25000,
    communityManagerActionsLimit: 1500, communityCorePersonaLimit: 5, customBotChatLimit: 2,
    canSchedule: true, canUseAiAssistant: true, canUseContentManager: true, canUseAiVisuals: true,
    canUseHtmlCovers: true, canUseAiModerator: true, canUseCommunityManager: true, canUseCommunityCore: true,
  },
  studio_pro: {
    textGenerationsLimit: 2000, visualGenerationsLimit: 700, channelLimit: 10, communityChatLimit: 10,
    assistantMessagesLimit: 10000, contentManagerPostsLimit: 700, aiModeratorChecksLimit: 100000,
    communityManagerActionsLimit: 5000, communityCorePersonaLimit: 20, customBotChatLimit: 10,
    canSchedule: true, canUseAiAssistant: true, canUseContentManager: true, canUseAiVisuals: true,
    canUseHtmlCovers: true, canUseAiModerator: true, canUseCommunityManager: true, canUseCommunityCore: true,
  },
}