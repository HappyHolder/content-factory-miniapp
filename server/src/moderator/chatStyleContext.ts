import type { AiDecision } from './modelRouter';

type JsonRecord = Record<string, unknown>;

export type StandaloneChatStyleContext = {
  schema: 'standalone-chat-style-v1';
  chat: string;
  handle: string | null;
  topic: string;
  audience: string;
  goal: string;
  language: string;
  tone: string;
  communicationStyle: string;
  topicConfigured: boolean;
};

const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const text = (value: unknown, max = 1000): string => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';

export function buildStandaloneChatStyleContext(input: {
  name: string;
  handle?: string | null;
  channelAbout?: unknown;
  voiceProfile?: unknown;
}): StandaloneChatStyleContext {
  const about = record(input.channelAbout);
  const voice = record(input.voiceProfile);
  const topic = text(about['topic'], 1200);
  return {
    schema: 'standalone-chat-style-v1',
    chat: text(input.name, 200),
    handle: text(input.handle, 200) || null,
    topic,
    audience: text(about['targetAudience'], 800),
    goal: text(about['contentGoal'], 800),
    language: text(voice['language'], 50),
    tone: text(voice['tone'], 100),
    communicationStyle: text(voice['customNote'], 1000),
    topicConfigured: topic.length > 0,
  };
}

export function chatStyleRulesSnapshot(context: StandaloneChatStyleContext): JsonRecord {
  return { chatStyle: context };
}

export function readPublishedChatStyle(value: unknown): StandaloneChatStyleContext | null {
  const candidate = record(value)['chatStyle'];
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
  const context = candidate as JsonRecord;
  if (context['schema'] !== 'standalone-chat-style-v1') return null;
  return buildStandaloneChatStyleContext({
    name: text(context['chat'], 200),
    handle: text(context['handle'], 200),
    channelAbout: {
      topic: context['topic'],
      targetAudience: context['audience'],
      contentGoal: context['goal'],
    },
    voiceProfile: {
      language: context['language'],
      tone: context['tone'],
      customNote: context['communicationStyle'],
    },
  });
}

export function moderatorChannelContext(input: {
  kind: string;
  name: string;
  handle?: string | null;
  publishedRules?: unknown;
  liveBrandKit?: { channelAbout?: unknown; voiceProfile?: unknown } | null;
}): JsonRecord {
  if (input.kind !== 'CHAT') return { channel: input.name, handle: input.handle ?? null };
  const chatStyle = input.liveBrandKit
    ? buildStandaloneChatStyleContext({ name: input.name, handle: input.handle, ...input.liveBrandKit })
    : readPublishedChatStyle(input.publishedRules) ?? buildStandaloneChatStyleContext({ name: input.name, handle: input.handle });
  return { type: 'standalone_chat', ...chatStyle };
}

export function protectUnconfiguredStandaloneOffTopic(
  decision: AiDecision,
  channelKind: string,
  channelContext: JsonRecord,
): AiDecision {
  if (channelKind !== 'CHAT' || channelContext['topicConfigured'] === true || decision.category !== 'off_topic') return decision;
  return {
    ...decision,
    violation: false,
    category: 'none',
    directed: false,
    reason: 'Офтоп пропущен: тема standalone-чата не настроена или не опубликована.',
    suggestedRewrite: null,
  };
}
