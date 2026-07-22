/**
 * storage.ts
 *
 * Local filesystem object storage — the self-hosted replacement for Vercel Blob.
 *
 * Files are written under env.STORAGE_DIR (a Docker volume in production) and
 * served publicly at `${PUBLIC_BASE_URL}/uploads/<pathname>` by nginx (prod) or
 * by the Express static handler (dev — see index.ts). The returned URL is a real,
 * public HTTPS URL so Telegram can fetch covers and the frontend can render them,
 * exactly like the old Vercel Blob URLs.
 *
 * Drop-in shape: `putObject(pathname, buffer, { contentType })` returns `{ url }`,
 * mirroring the `put()` call sites it replaces. contentType is accepted for
 * call-site compatibility but not needed on disk — the web server sets the
 * Content-Type header from the file extension (pathnames carry .jpg/.png/.html).
 */

import fs from 'fs/promises';
import path from 'path';
import { env } from '../env';

/** Public URL path prefix under which all stored objects are served. */
const PUBLIC_PREFIX = '/uploads';

export interface PutResult {
  /** Public URL of the stored object (e.g. https://domain/uploads/covers/x.jpg). */
  url: string;
  /** Storage-relative path the object was written to. */
  pathname: string;
}

/**
 * Writes a buffer to local storage and returns its public URL.
 * Creates any missing parent directories. Never silently no-ops: local FS is
 * always available, so (unlike the old Blob token guards) callers can assume
 * this succeeds or throws.
 */
export async function putObject(
  pathname: string,
  data: Buffer,
  _opts?: { contentType?: string },
): Promise<PutResult> {
  // Normalize: strip leading slashes and reject path traversal.
  const clean = pathname.replace(/^\/+/, '');
  if (clean.includes('..')) {
    throw new Error(`[storage] Illegal pathname (path traversal): ${pathname}`);
  }

  const dest = path.join(env.STORAGE_DIR, clean);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, data);

  const base = env.PUBLIC_BASE_URL.replace(/\/+$/, '');
  return { url: `${base}${PUBLIC_PREFIX}/${clean}`, pathname: clean };
}

/**
 * Reads a previously stored object's bytes by its public URL (or storage-relative
 * path). Returns null if the file is missing or resolves outside STORAGE_DIR.
 * Applies the same path-traversal guards as deleteObject.
 */
export async function readObject(urlOrPath: string): Promise<Buffer | null> {
  try {
    if (!urlOrPath || typeof urlOrPath !== 'string') return null;
    const marker = `${PUBLIC_PREFIX}/`;
    const idx = urlOrPath.indexOf(marker);
    const rel = (idx >= 0 ? urlOrPath.slice(idx + marker.length) : urlOrPath)
      .split('?')[0]!
      .replace(/^\/+/, '');
    if (!rel || rel.includes('..')) return null;

    const dest = path.resolve(env.STORAGE_DIR, rel);
    const root = path.resolve(env.STORAGE_DIR);
    if (dest !== root && !dest.startsWith(root + path.sep)) return null; // outside storage — refuse
    return await fs.readFile(dest);
  } catch {
    return null;
  }
}

/**
 * Deletes a previously stored object by its public URL (or storage-relative path).
 * Non-fatal and bounded: ignores URLs that aren't ours, rejects path traversal,
 * and never deletes outside STORAGE_DIR. Swallows all errors (best-effort cleanup).
 */
export async function deleteObject(urlOrPath: string): Promise<void> {
  try {
    if (!urlOrPath || typeof urlOrPath !== 'string') return;
    // Accept either a full ".../uploads/<path>" URL or a bare storage-relative path.
    const marker = `${PUBLIC_PREFIX}/`;
    const idx = urlOrPath.indexOf(marker);
    const rel = (idx >= 0 ? urlOrPath.slice(idx + marker.length) : urlOrPath)
      .split('?')[0]!
      .replace(/^\/+/, '');
    if (!rel || rel.includes('..')) return;

    const dest = path.resolve(env.STORAGE_DIR, rel);
    const root = path.resolve(env.STORAGE_DIR);
    if (dest !== root && !dest.startsWith(root + path.sep)) return; // outside storage — refuse
    await fs.unlink(dest).catch(() => { /* already gone — fine */ });
  } catch {
    /* best-effort: never throw from cleanup */
  }
}

/**
 * Deletes files directly inside `<STORAGE_DIR>/<subdir>` older than `maxAgeMs`.
 * Used to sweep short-lived scratch uploads (e.g. assistant chat screenshots,
 * which are deleted right after vision extraction but can be orphaned if a
 * request fails). Best-effort; returns the count removed.
 */
export async function purgeOldFiles(subdir: string, maxAgeMs: number): Promise<number> {
  const safe = subdir.replace(/^\/+|\/+$/g, '');
  if (!safe || safe.includes('..')) return 0;
  const dir = path.resolve(env.STORAGE_DIR, safe);
  const root = path.resolve(env.STORAGE_DIR);
  if (dir !== root && !dir.startsWith(root + path.sep)) return 0;
  let removed = 0;
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const cutoff = Date.now() - maxAgeMs;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const full = path.join(dir, entry.name);
      try {
        const stat = await fs.stat(full);
        if (stat.mtimeMs < cutoff) { await fs.unlink(full).catch(() => undefined); removed++; }
      } catch { /* skip */ }
    }
  } catch { /* dir missing — nothing to do */ }
  return removed;
}
