import { Router, Request, Response } from 'express';
import { prisma } from '../db';
import { env } from '../env';
import { validateAndParseTelegramInitData } from '../lib/telegram';

const router = Router();

// ─── POST /api/chat ───────────────────────────────────────────────────────────
//
// Sends a message to DeepSeek with BrandKit context as the system prompt.
// Request body: { initData, channelId, messages: [{role, content}] }
// Response 200: { reply: string }

router.post('/', async (req: Request, res: Response): Promise<void> => {
  const { initData, channelId, messages } = req.body as {
    initData?:  unknown;
    channelId?: unknown;
    messages?:  unknown;
  };

  if (typeof initData  !== 'string' || !initData.trim())  { res.status(400).json({ error: 'initData required' });  return; }
  if (typeof channelId !== 'string' || !channelId.trim()) { res.status(400).json({ error: 'channelId required' }); return; }
  if (!Array.isArray(messages) || messages.length === 0)  { res.status(400).json({ error: 'messages required' });  return; }

  // Validate initData
  let parsed;
  try { parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN); }
  catch (err) { res.status(401).json({ error: err instanceof Error ? err.message : 'Invalid initData' }); return; }

  const telegramId = String(parsed.user.id);
  const dbUser = await prisma.user.findUnique({ where: { telegramId }, select: { id: true } }).catch(() => null);
  if (!dbUser) { res.status(401).json({ error: 'User not found' }); return; }

  if (!env.DEEPSEEK_API_KEY) { res.status(503).json({ error: 'AI not configured' }); return; }

  // Load channel + BrandKit
  const channel = await prisma.channel.findUnique({
    where:  { id: channelId },
    select: { handle: true, name: true, userId: true,
              brandKit: { select: { channelAbout: true, voiceProfile: true, postRules: true, visualKit: true } } },
  }).catch(() => null);

  if (!channel || channel.userId !== dbUser.id) {
    res.status(403).json({ error: 'Channel not found or access denied' }); return;
  }

  // Build system prompt with BrandKit context
  const bk = channel.brandKit;
  const channelLabel = channel.handle ? `@${channel.handle}` : channel.name;
  const contextLines: string[] = [];

  if (bk?.channelAbout && typeof bk.channelAbout === 'object') {
    const a = bk.channelAbout as Record<string, unknown>;
    if (typeof a['topic']          === 'string' && a['topic'])          contextLines.push(`Channel topic: ${a['topic']}`);
    if (typeof a['targetAudience'] === 'string' && a['targetAudience']) contextLines.push(`Target audience: ${a['targetAudience']}`);
    if (typeof a['contentGoal']    === 'string' && a['contentGoal'])    contextLines.push(`Content goal: ${a['contentGoal']}`);
  }

  if (bk?.voiceProfile && typeof bk.voiceProfile === 'object') {
    const vp = bk.voiceProfile as Record<string, unknown>;
    if (typeof vp['tone']        === 'string' && vp['tone'])        contextLines.push(`Tone: ${vp['tone']}`);
    if (typeof vp['language']    === 'string' && vp['language'])    contextLines.push(`Language: ${vp['language']}`);
    if (typeof vp['authorRole']  === 'string' && vp['authorRole'])  contextLines.push(`Author role: ${vp['authorRole']}`);
    if (typeof vp['postLength']  === 'string' && vp['postLength'])  contextLines.push(`Post length: ${vp['postLength']}`);
  }

  if (bk?.postRules && typeof bk.postRules === 'object') {
    const pr = bk.postRules as Record<string, unknown>;
    if (typeof pr['defaultStructure'] === 'string' && pr['defaultStructure'])
      contextLines.push(`Post structure: ${pr['defaultStructure']}`);
  }

  const systemPrompt =
    `You are a personal content and community manager assistant for the Telegram channel ${channelLabel}.\n` +
    `You help the channel owner with: content ideas, post drafts, image prompts, content strategy, audience engagement.\n` +
    (contextLines.length > 0 ? `\nChannel BrandKit:\n${contextLines.join('\n')}\n` : '') +
    `\nAlways respond in the same language the user writes in.\n` +
    `Be concise, practical, and creative. Give actionable advice.`;

  // Call DeepSeek
  try {
    const response = await fetch(`${env.DEEPSEEK_BASE_URL}/chat/completions`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model:       env.DEEPSEEK_MODEL,
        messages:    [{ role: 'system', content: systemPrompt }, ...messages],
        max_tokens:  1024,
        temperature: 0.8,
      }),
    });

    if (!response.ok) {
      console.error(`[chat] DeepSeek error: ${response.status}`);
      res.status(502).json({ error: 'AI request failed' }); return;
    }

    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    const reply = data.choices?.[0]?.message?.content?.trim() ?? '';
    res.json({ reply });

  } catch (err) {
    console.error('[chat] Error:', (err as Error).message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
