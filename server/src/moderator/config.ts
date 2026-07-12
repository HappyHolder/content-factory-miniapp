export type WelcomeButton = { id: string; label: string; url: string };
export type WelcomeBlock = { id: string; type: 'welcome'; enabled: boolean; text: string; returnText?: string; imageUrl?: string; buttons?: WelcomeButton[]; autoDeleteSeconds?: number; deleteJoinMessage?: boolean; firstJoinOnly?: boolean; skipBots?: boolean; skipAdmins?: boolean };
export type CaptchaBlock = { id: string; type: 'captcha'; enabled: boolean; text: string; buttonText: string; timeoutSeconds: number; failureAction: 'kick' | 'restrict'; deleteOnSuccess: boolean; skipBots: boolean; skipAdmins: boolean; skipTrusted: boolean };
export type AntiSpamBlock = { id: string; type: 'antispam'; enabled: boolean; floodEnabled: boolean; maxMessages: number; windowSeconds: number; duplicateEnabled: boolean; maxDuplicates: number; duplicateWindowSeconds: number; linksMode: 'allow' | 'block_all' | 'allowlist'; allowedDomains: string[]; action: 'delete' | 'delete_warn'; skipBots: boolean; skipAdmins: boolean; skipTrusted: boolean };
export type ModeratorBlock = WelcomeBlock | CaptchaBlock | AntiSpamBlock;

export const DEFAULT_BLOCKS: ModeratorBlock[] = [
  { id: 'welcome-default', type: 'welcome', enabled: false, text: 'Добро пожаловать, **{name}**! Перед общением познакомьтесь с правилами {group}.', buttons: [], autoDeleteSeconds: 0, deleteJoinMessage: false, firstJoinOnly: false, skipBots: true, skipAdmins: true },
  { id: 'captcha-default', type: 'captcha', enabled: false, text: '**{name}**, подтвердите, что вы человек.', buttonText: 'Я человек', timeoutSeconds: 300, failureAction: 'kick', deleteOnSuccess: true, skipBots: true, skipAdmins: true, skipTrusted: true },
  { id: 'antispam-default', type: 'antispam', enabled: false, floodEnabled: true, maxMessages: 6, windowSeconds: 10, duplicateEnabled: true, maxDuplicates: 3, duplicateWindowSeconds: 60, linksMode: 'allow', allowedDomains: [], action: 'delete', skipBots: true, skipAdmins: true, skipTrusted: true },
];

const bool = (v: unknown, fallback: boolean) => typeof v === 'boolean' ? v : fallback;
const integer = (v: unknown, fallback: number, min: number, max: number) => Math.max(min, Math.min(Number.isInteger(v) ? Number(v) : fallback, max));
const idAndEnabled = (b: Record<string, unknown>, index: number) => { if (typeof b['id'] !== 'string' || !b['id']) throw new Error(`blocks[${index}].id is required`); if (typeof b['enabled'] !== 'boolean') throw new Error(`blocks[${index}].enabled must be boolean`); return { id: b['id'], enabled: b['enabled'] }; };

export function parseBlocks(value: unknown): ModeratorBlock[] {
  if (!Array.isArray(value)) throw new Error('blocks must be an array');
  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object') throw new Error(`blocks[${index}] must be an object`);
    const b = raw as Record<string, unknown>; const base = idAndEnabled(b, index);
    if (b['type'] === 'captcha') { const text = typeof b['text'] === 'string' ? b['text'].trim() : ''; if (!text) throw new Error(`blocks[${index}].text is required`); return { ...base, type: 'captcha', text: text.slice(0, 1000), buttonText: (typeof b['buttonText'] === 'string' && b['buttonText'].trim() ? b['buttonText'].trim() : 'Я человек').slice(0, 64), timeoutSeconds: integer(b['timeoutSeconds'], 300, 60, 1800), failureAction: b['failureAction'] === 'restrict' ? 'restrict' : 'kick', deleteOnSuccess: bool(b['deleteOnSuccess'], true), skipBots: bool(b['skipBots'], true), skipAdmins: bool(b['skipAdmins'], true), skipTrusted: bool(b['skipTrusted'], true) }; }
    if (b['type'] === 'antispam') { const rawDomains = Array.isArray(b['allowedDomains']) ? b['allowedDomains'] : []; const allowedDomains = [...new Set(rawDomains.flatMap(v => typeof v === 'string' ? [v.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] ?? ''] : []).filter(Boolean))].slice(0, 100); return { ...base, type: 'antispam', floodEnabled: bool(b['floodEnabled'], true), maxMessages: integer(b['maxMessages'], 6, 3, 20), windowSeconds: integer(b['windowSeconds'], 10, 5, 60), duplicateEnabled: bool(b['duplicateEnabled'], true), maxDuplicates: integer(b['maxDuplicates'], 3, 2, 10), duplicateWindowSeconds: integer(b['duplicateWindowSeconds'], 60, 10, 300), linksMode: b['linksMode'] === 'block_all' || b['linksMode'] === 'allowlist' ? b['linksMode'] : 'allow', allowedDomains, action: b['action'] === 'delete_warn' ? 'delete_warn' : 'delete', skipBots: bool(b['skipBots'], true), skipAdmins: bool(b['skipAdmins'], true), skipTrusted: bool(b['skipTrusted'], true) }; }
    if (b['type'] !== 'welcome') throw new Error(`Unsupported block type: ${String(b['type'])}`);
    const text = typeof b['text'] === 'string' ? b['text'].trim() : ''; if (!text) throw new Error(`blocks[${index}].text is required`);
    const buttons = Array.isArray(b['buttons']) ? b['buttons'].slice(0, 3).flatMap((x, i) => { if (!x || typeof x !== 'object') return []; const q = x as Record<string, unknown>, label = typeof q['label'] === 'string' ? q['label'].trim().slice(0, 64) : '', url = typeof q['url'] === 'string' ? q['url'].trim().slice(0, 2000) : ''; return label && /^(https?:\/\/|@)/i.test(url) ? [{ id: typeof q['id'] === 'string' ? q['id'] : `welcome-btn-${i}`, label, url }] : []; }) : [];
    return { ...base, type: 'welcome', text: text.slice(0, 3500), ...(typeof b['returnText'] === 'string' && b['returnText'].trim() ? { returnText: b['returnText'].trim().slice(0, 3500) } : {}), ...(typeof b['imageUrl'] === 'string' && /^https?:\/\//i.test(b['imageUrl']) ? { imageUrl: b['imageUrl'].slice(0, 2000) } : {}), buttons, autoDeleteSeconds: integer(b['autoDeleteSeconds'], 0, 0, 172800), deleteJoinMessage: bool(b['deleteJoinMessage'], false), firstJoinOnly: bool(b['firstJoinOnly'], false), skipBots: bool(b['skipBots'], true), skipAdmins: bool(b['skipAdmins'], true) };
  });
}

export function requiredRightsFor(blocks: ModeratorBlock[]) {
  const welcome = blocks.find(b => b.type === 'welcome' && b.enabled) as WelcomeBlock | undefined;
  const captcha = blocks.find(b => b.type === 'captcha' && b.enabled);
  const antiSpam = blocks.find(b => b.type === 'antispam' && b.enabled);
  return { can_delete_messages: Boolean((welcome && (welcome.deleteJoinMessage || welcome.autoDeleteSeconds)) || captcha || antiSpam), can_restrict_members: Boolean(captcha) };
}
