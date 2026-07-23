export interface TemplateSlotFallbackBrand {
  handle?: string | null;
  name?: string | null;
  about?: string;
  voice?: string;
  rubricName?: string;
}

export interface TemplateSlotFallbackPost {
  title: string;
  content: string;
  coverLanguage?: 'ru' | 'en';
}

function cleanText(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[*_~`>#=[\]()|]/g, ' ')
    .replace(/^[\s•\-–—]+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function clampWords(value: string, maxWords: number, maxChars: number): string {
  const words = cleanText(value).split(' ').filter(Boolean);
  let result = '';
  for (const word of words.slice(0, maxWords)) {
    const next = result ? `${result} ${word}` : word;
    if (next.length > maxChars) break;
    result = next;
  }
  return result || cleanText(value).slice(0, maxChars).trim();
}

function splitHeadline(title: string): { white: string; accent: string } {
  const words = clampWords(title, 5, 72).split(' ').filter(Boolean);
  if (words.length <= 1) return { white: words[0] ?? '', accent: '' };
  const accentWords = words.length >= 4 ? 2 : 1;
  return {
    white: words.slice(0, -accentWords).join(' '),
    accent: words.slice(-accentWords).join(' '),
  };
}

function contentPoints(content: string, title: string): string[] {
  const source = content
    .replace(/\r/g, '')
    .split(/\n+|(?<=[.!?])\s+/)
    .map(cleanText)
    .filter(value => value.length >= 4 && value.toLocaleLowerCase() !== cleanText(title).toLocaleLowerCase());
  return [...new Set(source)].slice(0, 3).map(value => clampWords(value, 9, 72));
}

function exactMetric(value: string): string {
  return cleanText(value).match(/(?:\bv?\d+(?:\.\d+){1,3}\b|\d[\d\s,]*%?)/i)?.[0]?.trim() ?? '';
}

/** Conservative fact-only values for the common slot naming conventions. */
export function buildTemplateSlotFallback(
  slots: string[],
  post: TemplateSlotFallbackPost,
  brand?: TemplateSlotFallbackBrand,
): Record<string, string> {
  const title = clampWords(post.title, 5, 72);
  const { white, accent } = splitHeadline(title);
  const points = contentPoints(post.content, post.title);
  const summary = points[0] ?? clampWords(post.content, 12, 110);
  const projectName = cleanText(brand?.name ?? '') || cleanText(brand?.handle ?? '').replace(/^@/, '');
  const rubric = cleanText(brand?.rubricName ?? '').slice(0, 24);
  const metric = exactMetric(`${post.title} ${post.content}`);
  const cta = post.coverLanguage === 'en' ? 'Learn more' : 'Подробнее';
  const values: Record<string, string> = {};

  for (const slot of slots) {
    const key = slot.toUpperCase();
    let value = '';
    if (/^(BRAND|AUTHOR|BYLINE|SIGNATURE|HANDLE)$/.test(key)) value = projectName;
    else if (/^(RUBRIC|SECTION|CATEGORY)$/.test(key)) value = rubric;
    else if (/^(TITLE|HEADLINE|QUESTION|QUOTE)$/.test(key)) value = title;
    else if (/^(TITLE|HEADLINE|QUESTION|QUOTE)_WHITE$/.test(key)) value = white;
    else if (/^(TITLE|HEADLINE|QUESTION|QUOTE)_ACCENT$/.test(key)) value = accent;
    else if (/^(SUBTITLE|SUBHEADLINE|LEAD|DESC|DESCRIPTION|HINT|COMMENT)$/.test(key)) value = summary;
    else if (/^(CTA|BUTTON|ACTION)$/.test(key)) value = cta;
    else if (/^(VERSION|VALUE|STAT|METRIC)$/.test(key)) value = metric;
    else {
      const pointMatch = key.match(/^(?:CH|POINT|ITEM|OPT)([1-3])$/);
      if (pointMatch) value = points[Number(pointMatch[1]) - 1] ?? '';
    }
    values[slot] = value;
  }
  return values;
}
