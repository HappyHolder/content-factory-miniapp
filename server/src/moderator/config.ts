export type WelcomeBlock = {
  id: string;
  type: 'welcome';
  enabled: boolean;
  text: string;
  buttonText?: string;
};

export type ModeratorBlock = WelcomeBlock;

export const DEFAULT_BLOCKS: ModeratorBlock[] = [
  {
    id: 'welcome-default',
    type: 'welcome',
    enabled: false,
    text: 'Добро пожаловать, {name}! Перед общением познакомьтесь с правилами сообщества.',
  },
];

export function parseBlocks(value: unknown): ModeratorBlock[] {
  if (!Array.isArray(value)) throw new Error('blocks must be an array');
  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new Error(`blocks[${index}] must be an object`);
    const block = raw as Record<string, unknown>;
    if (block['type'] !== 'welcome') throw new Error(`Unsupported block type: ${String(block['type'])}`);
    if (typeof block['id'] !== 'string' || !block['id']) throw new Error(`blocks[${index}].id is required`);
    if (typeof block['enabled'] !== 'boolean') throw new Error(`blocks[${index}].enabled must be boolean`);
    if (typeof block['text'] !== 'string' || !block['text'].trim()) throw new Error(`blocks[${index}].text is required`);
    if (block['text'].length > 3500) throw new Error(`blocks[${index}].text is too long`);
    return {
      id: block['id'],
      type: 'welcome',
      enabled: block['enabled'],
      text: block['text'].trim(),
      ...(typeof block['buttonText'] === 'string' ? { buttonText: block['buttonText'].slice(0, 64) } : {}),
    };
  });
}

export function requiredRightsFor(blocks: ModeratorBlock[]) {
  // Plain welcome messages need no destructive admin permission. ModerBot is
  // still required to be admin by product policy so later blocks can be added
  // without silently losing access to group lifecycle events.
  return {
    can_delete_messages: false,
    can_restrict_members: false,
  };
}
