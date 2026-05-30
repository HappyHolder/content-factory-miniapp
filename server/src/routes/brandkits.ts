import { Router, Request, Response } from 'express';
import multer from 'multer';
import { put } from '@vercel/blob';
import { prisma } from '../db';
import { env } from '../env';
import { validateAndParseTelegramInitData } from '../lib/telegram';

// ─── Multer setup ─────────────────────────────────────────────────────────────
// Memory storage: file lives only in RAM (req.file.buffer), never on disk.
// Limit: 5 MB. Filter: JPEG, PNG, WebP only (SVG excluded — unsafe script risk).

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Use JPEG, PNG or WebP.`));
    }
  },
});

/** Strips non-safe characters from an original filename and caps length. */
function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 50);
}

const router = Router();

// The 7 Channel Style section keys stored as Json? columns in BrandKit.
// Only keys in this list are accepted from the client — unknown keys are ignored.
const VALID_SECTIONS = [
  'channelAbout',
  'voiceProfile',
  'linkKit',
  'visualKit',
  'signature',
  'postRules',
] as const;

// ─── POST /api/brandkits/upload-asset ────────────────────────────────────────
//
// Uploads a BrandKit visual asset (logo or reference image) to Vercel Blob and
// returns the public URL. Does NOT write to the DB — the caller adds the URL to
// visualKit locally and persists via the existing PATCH endpoint.
//
// Request: multipart/form-data
//   initData   — Telegram WebApp initData string
//   channelId  — channel the asset belongs to
//   assetType  — "logo" | "reference"
//   file       — image file (JPEG / PNG / WebP, max 5 MB)
//
// Response 200: { url: string }
// Response 400: missing fields / unsupported file type
// Response 401: invalid initData / user not found
// Response 403: channel belongs to another user
// Response 404: channel not found
// Response 503: BLOB_READ_WRITE_TOKEN not configured
// Response 500: upload or DB error

router.post(
  '/upload-asset',
  upload.single('file'),   // multer parses multipart; populates req.file + req.body
  async (req: Request, res: Response): Promise<void> => {

    // ── 0. Blob token guard ─────────────────────────────────────────────────
    if (!env.BLOB_READ_WRITE_TOKEN) {
      res.status(503).json({ error: 'File upload is not configured on this server.' });
      return;
    }

    // ── 1. Extract fields from multipart body ───────────────────────────────
    const initData   = req.body['initData']   as unknown;
    const channelId  = req.body['channelId']  as unknown;
    const assetType  = req.body['assetType']  as unknown;
    const file       = req.file;

    // ── 2. Input validation ─────────────────────────────────────────────────
    if (typeof initData !== 'string' || !initData.trim()) {
      res.status(400).json({ error: 'initData is required' }); return;
    }
    if (typeof channelId !== 'string' || !channelId.trim()) {
      res.status(400).json({ error: 'channelId is required' }); return;
    }
    if (assetType !== 'logo' && assetType !== 'reference') {
      res.status(400).json({ error: 'assetType must be "logo" or "reference"' }); return;
    }
    if (!file) {
      res.status(400).json({ error: 'file is required' }); return;
    }

    // ── 3. Validate Telegram initData ───────────────────────────────────────
    let parsed;
    try {
      parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);
    } catch (err) {
      res.status(401).json({ error: err instanceof Error ? err.message : 'Invalid initData' }); return;
    }

    // ── 4. Resolve authenticated user ───────────────────────────────────────
    const telegramId = String(parsed.user.id);
    let dbUser: { id: string } | null = null;
    try {
      dbUser = await prisma.user.findUnique({ where: { telegramId }, select: { id: true } });
    } catch (err) {
      console.error('[brandkits/upload-asset] User lookup failed:', (err as Error).message);
      res.status(500).json({ error: 'Internal server error' }); return;
    }
    if (!dbUser) {
      res.status(401).json({ error: 'User not found. Please re-open the app.' }); return;
    }

    // ── 5. Confirm channel ownership ────────────────────────────────────────
    let channel: { userId: string } | null = null;
    try {
      channel = await prisma.channel.findUnique({
        where:  { id: channelId },
        select: { userId: true },
      });
    } catch (err) {
      console.error('[brandkits/upload-asset] Channel lookup failed:', (err as Error).message);
      res.status(500).json({ error: 'Internal server error' }); return;
    }
    if (!channel) {
      res.status(404).json({ error: 'Channel not found.' }); return;
    }
    if (channel.userId !== dbUser.id) {
      res.status(403).json({ error: 'This channel does not belong to your account.' }); return;
    }

    // ── 6. Build Blob storage path ──────────────────────────────────────────
    const safeName = safeFileName(file.originalname);
    const timestamp = Date.now();
    const pathname = assetType === 'logo'
      ? `brandkits/${channelId}/logo-${timestamp}-${safeName}`
      : `brandkits/${channelId}/references/ref-${timestamp}-${safeName}`;

    // ── 7. Upload to Vercel Blob ─────────────────────────────────────────────
    let blobUrl: string;
    try {
      const blob = await put(pathname, file.buffer, {
        access:      'public',
        token:       env.BLOB_READ_WRITE_TOKEN,
        contentType: file.mimetype,
      });
      blobUrl = blob.url;
    } catch (err) {
      console.error('[brandkits/upload-asset] Blob upload failed:', (err as Error).message);
      res.status(500).json({ error: 'File upload failed. Try again.' }); return;
    }

    res.json({ url: blobUrl });
  },
);

// ─── PATCH /api/brandkits/:channelId ─────────────────────────────────────────
// Persists one or more Channel Style sections for the given channel.
// Only the keys present in `sections` are written — other columns are left as-is.
//
// Request body:  { initData: string, sections: Partial<BrandKit sections> }
// Response 200:  { ok: true }
// Response 400:  missing / invalid body, or no recognised section keys
// Response 401:  invalid initData signature, or user not in DB
// Response 403:  channel belongs to a different user
// Response 404:  channel not found in DB
// Response 500:  DB error

router.patch('/:channelId', async (req: Request, res: Response): Promise<void> => {
  const { channelId } = req.params as { channelId: string };
  const { initData, sections } = req.body as {
    initData?: unknown;
    sections?: unknown;
  };

  // ── 1. Basic input validation ─────────────────────────────────────────────
  if (typeof initData !== 'string' || !initData.trim()) {
    res.status(400).json({ error: 'initData is required' });
    return;
  }
  if (!sections || typeof sections !== 'object' || Array.isArray(sections)) {
    res.status(400).json({ error: 'sections must be a non-null object' });
    return;
  }

  // ── 2. Extract only valid section keys, discard everything else ───────────
  const sectionsObj = sections as Record<string, unknown>;
  const updateData: Record<string, unknown> = {};
  for (const key of VALID_SECTIONS) {
    if (key in sectionsObj && sectionsObj[key] !== undefined) {
      updateData[key] = sectionsObj[key];
    }
  }
  if (Object.keys(updateData).length === 0) {
    res.status(400).json({ error: 'No valid section keys provided' });
    return;
  }

  // ── 3. Validate Telegram initData ────────────────────────────────────────
  let parsed;
  try {
    parsed = validateAndParseTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);
  } catch (err) {
    res.status(401).json({
      error: err instanceof Error ? err.message : 'Invalid initData',
    });
    return;
  }

  // ── 4. Resolve authenticated user ────────────────────────────────────────
  const telegramId = String(parsed.user.id);
  let dbUser: { id: string } | null = null;
  try {
    dbUser = await prisma.user.findUnique({
      where:  { telegramId },
      select: { id: true },
    });
  } catch (err) {
    console.error('[brandkits/patch] User lookup failed:', err);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }
  if (!dbUser) {
    res.status(401).json({ error: 'User not found. Please re-open the app.' });
    return;
  }

  // ── 5. Find channel and verify ownership ─────────────────────────────────
  let channel: { id: string; userId: string } | null = null;
  try {
    channel = await prisma.channel.findUnique({
      where:  { id: channelId },
      select: { id: true, userId: true },
    });
  } catch (err) {
    console.error('[brandkits/patch] Channel lookup failed:', err);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }
  if (!channel) {
    res.status(404).json({ error: 'Channel not found.' });
    return;
  }
  if (channel.userId !== dbUser.id) {
    res.status(403).json({ error: 'This channel does not belong to your account.' });
    return;
  }

  // ── 6. Upsert BrandKit — write only the provided sections ────────────────
  // The values are JSON-parsed objects from Express, compatible with Prisma's
  // Json? column type at runtime. `as any` avoids re-typing the generated
  // Prisma input shape for nullable JSON fields.
  try {
    await prisma.brandKit.upsert({
      where:  { channelId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: updateData as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: { channelId, ...(updateData as any) },
    });
  } catch (err) {
    console.error('[brandkits/patch] BrandKit upsert failed:', err);
    res.status(500).json({ error: 'Internal server error' });
    return;
  }

  res.json({ ok: true });
});

export default router;
