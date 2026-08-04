import type { TelegramInlineKeyboard, TelegramReplyKeyboard } from './telegramBot';

export interface BotChannelSummary {
  id: string;
  name: string;
  handle: string | null;
}

const CHANNEL_CALLBACK_PREFIX = 'channel:';
const CHANNEL_BUTTON_PREFIX = 'Канал';

export function versionedMiniAppUrl(base:string|undefined,release:string):string|undefined{
  if(!base)return undefined;
  try{const url=new URL(base);url.searchParams.set('app_release',release);return url.toString()}catch{return base}
}

export function botChannelLabel(channel: BotChannelSummary): string {
  return channel.handle ? `@${channel.handle.replace(/^@/, '')}` : channel.name;
}

export function isChannelButtonText(text: string): boolean {
  const value = text.trim();
  return value === '/channel' || value === '/channels' || value === CHANNEL_BUTTON_PREFIX || value.startsWith(`${CHANNEL_BUTTON_PREFIX} · `);
}

export function isOpenAppButtonText(text: string): boolean {
  return text.trim() === 'Открыть Publium';
}

export function buildQuickActionsKeyboard(
  activeChannel: BotChannelSummary | null,
  miniAppUrl: string | undefined,
): TelegramReplyKeyboard {
  const channelText = activeChannel
    ? `${CHANNEL_BUTTON_PREFIX} · ${botChannelLabel(activeChannel)}`
    : CHANNEL_BUTTON_PREFIX;
  const row: TelegramReplyKeyboard['keyboard'][number] = [{ text: channelText }];
  // A reply-keyboard Web App is a Telegram SimpleWebView: its initData is empty
  // by design. Send plain text here; the webhook responds with an inline Web App
  // button, which launches the authenticated WebView flow.
  if (miniAppUrl) row.push({ text: 'Открыть Publium' });
  return {
    keyboard: [row],
    resize_keyboard: true,
    is_persistent: true,
    input_field_placeholder: 'Пришлите текст, ссылку или фото',
  };
}

export function buildChannelPickerKeyboard(
  channels: BotChannelSummary[],
  activeChannelId: string | null,
): TelegramInlineKeyboard {
  return {
    inline_keyboard: channels.map(channel => [{
      text: `${channel.id === activeChannelId ? '✓ ' : ''}${botChannelLabel(channel)}`,
      callback_data: `${CHANNEL_CALLBACK_PREFIX}${channel.id}`,
    }]),
  };
}

export function parseChannelCallback(data: string | undefined): string | null {
  if (!data?.startsWith(CHANNEL_CALLBACK_PREFIX)) return null;
  const channelId = data.slice(CHANNEL_CALLBACK_PREFIX.length).trim();
  return channelId || null;
}