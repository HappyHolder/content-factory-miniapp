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
