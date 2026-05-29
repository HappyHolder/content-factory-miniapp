/**
 * telegramEmoji.ts
 *
 * Builds Telegram MessageEntity[] for custom emoji entries in the BrandKit
 * emojiPack, so that published posts render the channel's branded emoji set
 * instead of the default Unicode glyphs.
 *
 * How Telegram custom emoji works:
 *   - The message text contains the normal Unicode glyph as a placeholder.
 *   - Each entity of type "custom_emoji" overrides the rendering of that
 *     specific character range with the custom emoji identified by its ID.
 *   - Offsets and lengths are in UTF-16 code units — which happens to match
 *     JavaScript's native string indexing (surrogate pairs are 2 units each).
 *
 * Backward compatibility:
 *   - allowedEmojis entries that are plain strings (legacy format) are silently
 *     ignored — they produce no entities and text is left unchanged.
 *   - Only entries that are objects with both `unicode` and `customEmojiId`
 *     produce entities.
 *   - If no matching entries exist, returns { text, entities: [] }.
 */

import type { TelegramMessageEntity } from './telegramBot';

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Scans `text` for occurrences of each emoji that has a `customEmojiId` in
 * the emojiPack and returns a Telegram entity array covering every match.
 *
 * Text is returned unchanged — entities annotate the existing glyphs;
 * the Telegram client renders the custom emoji in-place.
 *
 * Multiple occurrences of the same emoji each get their own entity.
 * Entities are sorted by offset (ascending) as the Bot API expects.
 */
export function buildCustomEmojiEntities(
  text: string,
  emojiPack: unknown,
): { text: string; entities: TelegramMessageEntity[] } {
  const noOp = { text, entities: [] as TelegramMessageEntity[] };

  if (!emojiPack || typeof emojiPack !== 'object') return noOp;
  const ep  = emojiPack as Record<string, unknown>;
  const raw = ep['allowedEmojis'];
  if (!Array.isArray(raw) || raw.length === 0) return noOp;

  const entities: TelegramMessageEntity[] = [];

  for (const entry of raw) {
    // Skip plain-string (legacy) entries — they have no customEmojiId
    if (!entry || typeof entry !== 'object') continue;

    const e             = entry as Record<string, unknown>;
    const unicode       = e['unicode'];
    const customEmojiId = e['customEmojiId'];

    if (
      typeof unicode       !== 'string' || unicode.length === 0 ||
      typeof customEmojiId !== 'string' || customEmojiId.length === 0
    ) continue;

    // length in UTF-16 code units — JS string.length is already UTF-16.
    // e.g. 🚀 (U+1F680) → "🚀".length === 2; ❤️ → "❤️".length === 2.
    const length = unicode.length;

    // Walk the text to find every occurrence
    let pos = 0;
    while (pos < text.length) {
      const offset = text.indexOf(unicode, pos);
      if (offset === -1) break;
      entities.push({ type: 'custom_emoji', offset, length, custom_emoji_id: customEmojiId });
      pos = offset + length;
    }
  }

  // Sort ascending by offset so the Bot API receives a well-ordered list
  entities.sort((a, b) => a.offset - b.offset);

  return { text, entities };
}
