/**
 * postRetention.ts
 *
 * A published post "lives fully" for a fixed window after publishing: during it
 * the post stays editable and can be re-published (edited in place) in the
 * channel. After the window it is purged from our DB (and its media from
 * storage) so we don't accumulate data forever.
 *
 * The SAME window governs both the edit/re-publish grace period and the
 * retention cutoff — one source of truth. The frontend mirrors this value in
 * src/config (POST_EDIT_WINDOW_MS); keep them in sync.
 */

/** How long a published post remains editable / retained: 5 hours. */
export const POST_EDIT_WINDOW_MS = 5 * 60 * 60 * 1000;

/** True while a published post is still inside its editable window. */
export function isWithinEditWindow(publishedAt: Date | null | undefined): boolean {
  if (!publishedAt) return false;
  return Date.now() - publishedAt.getTime() < POST_EDIT_WINDOW_MS;
}
