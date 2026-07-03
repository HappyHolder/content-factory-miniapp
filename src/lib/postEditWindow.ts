/**
 * A published post stays fully editable and re-publishable (edited in place in
 * the channel) for this window, after which the server purges it. Mirrors the
 * backend source of truth in server/src/lib/postRetention.ts — keep in sync.
 */
export const POST_EDIT_WINDOW_MS = 5 * 60 * 60 * 1000

/** True while a published post is still inside its editable window. */
export function isWithinEditWindow(publishedAt: Date | string | null | undefined): boolean {
  if (!publishedAt) return false
  const ms = new Date(publishedAt).getTime()
  if (!ms) return false
  return Date.now() - ms < POST_EDIT_WINDOW_MS
}
