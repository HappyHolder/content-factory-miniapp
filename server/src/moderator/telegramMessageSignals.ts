export type TelegramUserLike = {
  id: number;
  username?: string;
  is_bot?: boolean;
};

export type TelegramEntityLike = {
  type: string;
  offset: number;
  length: number;
  url?: string;
  user?: TelegramUserLike;
};

export type TelegramInlineButtonLike = {
  url?: string;
  login_url?: { url?: string };
  web_app?: { url?: string };
};

export type TelegramMessageLike = {
  text?: string;
  caption?: string;
  entities?: TelegramEntityLike[];
  caption_entities?: TelegramEntityLike[];
  via_bot?: TelegramUserLike;
  reply_markup?: { inline_keyboard?: TelegramInlineButtonLike[][] };
};

export type TelegramMessageSignals = {
  urls: string[];
  domains: string[];
  botUsernames: string[];
  viaBotUsername: string | null;
  viaBotId: number | null;
};

export type TelegramBotPolicyViolation = {
  reason: 'VIA_BOT_BLOCKED' | 'BOT_REFERENCE_BLOCKED';
  botUsername: string | null;
  viaBotId: number | null;
};

const HTTP_URL = /(?:https?:\/\/|www\.)[^\s<>()]+/gi;
const TG_URL = /tg:\/\/[^\s<>()]+/gi;
const BOT_MENTION = /@([a-z0-9_]{2,29}bot)\b/gi;

export function normalizeBotUsername(value: string): string | null {
  const username = value.trim().replace(/^@/, '').toLowerCase();
  return /^[a-z0-9_]{2,29}bot$/.test(username) ? username : null;
}

function telegramBotFromUrl(raw: string): string | null {
  try {
    const prepared = /^www\./i.test(raw) ? `https://${raw}` : raw;
    const parsed = new URL(prepared);
    if (parsed.protocol === 'tg:' && parsed.hostname.toLowerCase() === 'resolve') {
      return normalizeBotUsername(parsed.searchParams.get('domain') ?? '');
    }
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 't.me' && host !== 'telegram.me' && host !== 'telegram.dog') return null;
    return normalizeBotUsername(parsed.pathname.split('/').filter(Boolean)[0] ?? '');
  } catch {
    return null;
  }
}

function domainFromUrl(raw: string): string | null {
  try {
    const prepared = /^https?:\/\//i.test(raw) || /^tg:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(prepared);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function buttonUrls(message: TelegramMessageLike): string[] {
  return (message.reply_markup?.inline_keyboard ?? []).flatMap(row => row.flatMap(button => [
    button.url,
    button.login_url?.url,
    button.web_app?.url,
  ].filter((value): value is string => typeof value === 'string' && value.length > 0)));
}

export function telegramMessageSignals(message: TelegramMessageLike): TelegramMessageSignals {
  const text = message.text ?? message.caption ?? '';
  const entities = [...(message.entities ?? []), ...(message.caption_entities ?? [])];
  const urls = [
    ...[...text.matchAll(HTTP_URL)].map(match => match[0]),
    ...[...text.matchAll(TG_URL)].map(match => match[0]),
    ...entities.flatMap(entity => {
      if (entity.url) return [entity.url];
      if (entity.type === 'url') return [text.slice(entity.offset, entity.offset + entity.length)];
      return [];
    }),
    ...buttonUrls(message),
  ];
  const uniqueUrls = [...new Set(urls)];

  const botUsernames = new Set<string>();
  for (const match of text.matchAll(BOT_MENTION)) {
    const username = normalizeBotUsername(match[1] ?? '');
    if (username) botUsernames.add(username);
  }
  for (const entity of entities) {
    if (entity.type === 'mention') {
      const username = normalizeBotUsername(text.slice(entity.offset, entity.offset + entity.length));
      if (username) botUsernames.add(username);
    }
    if (entity.type === 'text_mention' && entity.user?.is_bot && entity.user.username) {
      const username = normalizeBotUsername(entity.user.username);
      if (username) botUsernames.add(username);
    }
  }
  for (const url of uniqueUrls) {
    const username = telegramBotFromUrl(url);
    if (username) botUsernames.add(username);
  }

  const viaBotUsername = message.via_bot?.username
    ? normalizeBotUsername(message.via_bot.username)
    : null;
  if (viaBotUsername) botUsernames.add(viaBotUsername);

  return {
    urls: uniqueUrls,
    domains: [...new Set(uniqueUrls.flatMap(url => {
      const domain = domainFromUrl(url);
      return domain ? [domain] : [];
    }))],
    botUsernames: [...botUsernames],
    viaBotUsername,
    viaBotId: message.via_bot?.id ?? null,
  };
}

export function telegramBotPolicyViolation(
  signals: TelegramMessageSignals,
  mode: 'allow' | 'block_all' | 'allowlist',
  allowedBotUsernames: string[],
): TelegramBotPolicyViolation | null {
  if (mode === 'allow') return null;
  const allowed = new Set(allowedBotUsernames.map(value => value.toLowerCase()));
  const blockedUsernames = mode === 'block_all'
    ? signals.botUsernames
    : signals.botUsernames.filter(username => !allowed.has(username));
  const viaBotBlocked = signals.viaBotId !== null && (
    mode === 'block_all'
    || signals.viaBotUsername === null
    || !allowed.has(signals.viaBotUsername)
  );
  if (viaBotBlocked) {
    return { reason: 'VIA_BOT_BLOCKED', botUsername: signals.viaBotUsername, viaBotId: signals.viaBotId };
  }
  if (blockedUsernames.length > 0) {
    return { reason: 'BOT_REFERENCE_BLOCKED', botUsername: blockedUsernames[0] ?? null, viaBotId: signals.viaBotId };
  }
  return null;
}
