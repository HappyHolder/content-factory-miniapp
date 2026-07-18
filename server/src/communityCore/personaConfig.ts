/**
 * Persona configuration — a believable human, not the Community Manager.
 * No polls/events/goals: a persona just talks. Fields distilled from the
 * references doc (Character Card V2 voice examples, canon lorebook, Kindroid
 * dynamism, Smallville presence rhythm).
 */

export type PersonaConfigData = {
  identity: { displayName: string; gender: 'male' | 'female' | 'unspecified'; age: string; city: string; occupation: string; about: string };
  voice: { messageExamples: string[]; speechStyle: string; slang: string; emojiUse: 'none' | 'rare' | 'normal' | 'heavy'; messageLength: 'short' | 'medium'; dynamism: number };
  canon: string[]; // stable biography facts the model must not invent around
  role: string;    // заводила | скептик | эксперт | шутник | новичок | ...
  interests: string[];
  behavior: { repliesToMentions: boolean; joinsDiscussions: boolean; reacts: boolean; expertTopics: string[]; forbiddenTopics: string[]; extraInstructions: string; forbiddenClaims: string[] };
  presence: { timezone: string; activeFromHour: number; activeToHour: number };
  limits: { maxMessagesPerHour: number; maxMessagesPerDay: number; maxReactionsPerHour: number; replyCooldownSeconds: number; reactionShare: number };
  // Web access so hobbies/expertise stay current. 'topics' = look things up only
  // when a fresh-data question lands in the persona's interests/expertise.
  research: { mode: 'off' | 'topics'; blockedDomains: string[]; dailyLimit: number };
  // Occasionally start a topic in a quiet chat (human-style, not a bot broadcast).
  proactive: { enabled: boolean; quietMinutes: number; maxPerDay: number; topics: string[] };
};

export const DEFAULT_PERSONA_CONFIG: PersonaConfigData = {
  identity: { displayName: 'Алекс', gender: 'unspecified', age: '28', city: 'Москва', occupation: 'разработчик', about: '' },
  voice: { messageExamples: [], speechStyle: 'разговорный, по делу', slang: '', emojiUse: 'rare', messageLength: 'short', dynamism: 1 },
  canon: [],
  role: 'Свой человек',
  interests: [],
  behavior: { repliesToMentions: true, joinsDiscussions: true, reacts: true, expertTopics: [], forbiddenTopics: [], extraInstructions: '', forbiddenClaims: ['не выдавать себя за официального представителя проекта', 'не обещать действия команды'] },
  presence: { timezone: 'Europe/Moscow', activeFromHour: 9, activeToHour: 23 },
  limits: { maxMessagesPerHour: 6, maxMessagesPerDay: 40, maxReactionsPerHour: 20, replyCooldownSeconds: 45, reactionShare: 0.15 },
  research: { mode: 'topics', blockedDomains: ['youtube.com', 'youtu.be', 'tiktok.com', 'instagram.com', 'vk.com'], dailyLimit: 15 },
  proactive: { enabled: false, quietMinutes: 120, maxPerDay: 3, topics: [] },
};

const str = (v: unknown, f: string, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : f);
const num = (v: unknown, f: number, min: number, max: number) => Math.max(min, Math.min(max, Number.isFinite(Number(v)) ? Number(v) : f));
const bool = (v: unknown, f: boolean) => (typeof v === 'boolean' ? v : f);
const list = (v: unknown, maxItems: number, maxLen: number) => (Array.isArray(v) ? [...new Set(v.filter(x => typeof x === 'string').map(x => String(x).trim().slice(0, maxLen)).filter(Boolean))].slice(0, maxItems) : []);
const listOr = (v: unknown, f: string[], maxItems: number, maxLen: number) => (Array.isArray(v) ? list(v, maxItems, maxLen) : f);
const oneOf = <T extends string>(v: unknown, options: readonly T[], f: T): T => (options.includes(v as T) ? (v as T) : f);

export function parsePersonaConfig(raw: unknown): PersonaConfigData {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const d = DEFAULT_PERSONA_CONFIG;
  const identity = r.identity ?? {}, voice = r.voice ?? {}, behavior = r.behavior ?? {}, presence = r.presence ?? {}, limits = r.limits ?? {};
  return {
    identity: {
      displayName: str(identity.displayName, d.identity.displayName, 64),
      gender: oneOf(identity.gender, ['male', 'female', 'unspecified'] as const, d.identity.gender),
      age: str(identity.age, d.identity.age, 12),
      city: str(identity.city, d.identity.city, 64),
      occupation: str(identity.occupation, d.identity.occupation, 300),
      about: str(identity.about, '', 20000),
    },
    voice: {
      messageExamples: list(voice.messageExamples, 60, 6000),
      speechStyle: str(voice.speechStyle, d.voice.speechStyle, 4000),
      slang: str(voice.slang, '', 600),
      emojiUse: oneOf(voice.emojiUse, ['none', 'rare', 'normal', 'heavy'] as const, d.voice.emojiUse),
      messageLength: oneOf(voice.messageLength, ['short', 'medium'] as const, d.voice.messageLength),
      dynamism: num(voice.dynamism, d.voice.dynamism, 0, 2),
    },
    canon: list(r.canon, 100, 6000),
    role: str(r.role, d.role, 200),
    interests: list(r.interests, 80, 400),
    behavior: {
      repliesToMentions: bool(behavior.repliesToMentions, d.behavior.repliesToMentions),
      joinsDiscussions: bool(behavior.joinsDiscussions, d.behavior.joinsDiscussions),
      reacts: bool(behavior.reacts, d.behavior.reacts),
      expertTopics: list(behavior.expertTopics, 30, 120),
      forbiddenTopics: list(behavior.forbiddenTopics, 30, 120),
      extraInstructions: str(behavior.extraInstructions, '', 6000),
      forbiddenClaims: listOr(behavior.forbiddenClaims, d.behavior.forbiddenClaims, 20, 200),
    },
    presence: {
      timezone: str(presence.timezone, d.presence.timezone, 80),
      activeFromHour: num(presence.activeFromHour, d.presence.activeFromHour, 0, 23),
      activeToHour: num(presence.activeToHour, d.presence.activeToHour, 0, 23),
    },
    limits: {
      maxMessagesPerHour: num(limits.maxMessagesPerHour, d.limits.maxMessagesPerHour, 1, 60),
      maxMessagesPerDay: num(limits.maxMessagesPerDay, d.limits.maxMessagesPerDay, 1, 400),
      maxReactionsPerHour: num(limits.maxReactionsPerHour, d.limits.maxReactionsPerHour, 0, 200),
      replyCooldownSeconds: num(limits.replyCooldownSeconds, d.limits.replyCooldownSeconds, 5, 3600),
      reactionShare: num(limits.reactionShare, d.limits.reactionShare, 0, 1),
    },
    research: {
      mode: oneOf((r.research ?? {}).mode, ['off', 'topics'] as const, d.research.mode),
      blockedDomains: listOr((r.research ?? {}).blockedDomains, d.research.blockedDomains, 40, 200),
      dailyLimit: num((r.research ?? {}).dailyLimit, d.research.dailyLimit, 0, 100),
    },
    proactive: {
      enabled: bool((r.proactive ?? {}).enabled, d.proactive.enabled),
      quietMinutes: num((r.proactive ?? {}).quietMinutes, d.proactive.quietMinutes, 15, 1440),
      maxPerDay: num((r.proactive ?? {}).maxPerDay, d.proactive.maxPerDay, 1, 20),
      topics: list((r.proactive ?? {}).topics, 30, 120),
    },
  };
}

export function isPersonaAwake(config: PersonaConfigData, date = new Date()): boolean {
  let hour = date.getUTCHours();
  try { hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: config.presence.timezone, hour: '2-digit', hourCycle: 'h23' }).format(date)); } catch { /* keep UTC */ }
  const { activeFromHour: a, activeToHour: b } = config.presence;
  if (a === b) return true;
  return a < b ? hour >= a && hour < b : hour >= a || hour < b;
}

export function buildPersonaSystemPrompt(config: PersonaConfigData, channelName: string): string {
  const { identity, voice, behavior } = config;
  const examples = voice.messageExamples.length ? '\nHow you text (imitate this voice, not the wording): ' + voice.messageExamples.map(x => '«' + x + '»').join(' ') : '';
  const canon = config.canon.length ? '\nFacts about you (never contradict, never invent beyond these): ' + config.canon.join('; ') : '';
  const emojiRule = { none: 'Never use emoji.', rare: 'Use an emoji only rarely.', normal: 'Use emoji naturally and sparingly.', heavy: 'Use emoji freely.' }[voice.emojiUse];
  const dyn = voice.dynamism >= 1.5 ? 'Be lively, unpredictable and playful.' : voice.dynamism <= 0.5 ? 'Be calm, even and measured.' : 'Keep a natural, moderate energy.';
  return [
    'You are ' + identity.displayName + ', a real member of the Telegram chat of ' + channelName + '. Age ' + identity.age + ', from ' + identity.city + ', ' + identity.occupation + '. Role in the group: ' + config.role + '.',
    config.interests.length ? 'Your interests: ' + config.interests.join(', ') + '.' : '',
    identity.about,
    canon,
    'Speak like a real person in a group chat, never like a bot, assistant, moderator or support agent. ' + voice.speechStyle + (voice.slang ? '. Speech habits: ' + voice.slang : '') + '. ' + emojiRule + ' ' + dyn,
    voice.messageLength === 'short' ? 'Keep it to one or two short messages, the way people actually text.' : 'Usually a few short sentences.',
    examples,
    'Only speak when you genuinely have something to add from your character and interests: a real opinion, a joke, a question, agreement or pushback. Silence is normal. Never force the channel topic. Never announce that you are AI unless directly and seriously asked. Do not repeat what others (including other members) already said.',
    behavior.expertTopics.length ? 'You are knowledgeable about: ' + behavior.expertTopics.join(', ') + '.' : '',
    behavior.forbiddenTopics.length ? 'Stay out of: ' + behavior.forbiddenTopics.join(', ') + '.' : '',
    behavior.extraInstructions,
    'Never do these: ' + behavior.forbiddenClaims.join('; ') + '.',
  ].filter(Boolean).join('\n');
}
