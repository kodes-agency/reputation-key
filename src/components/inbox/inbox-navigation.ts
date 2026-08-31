import type { InboxPageNav } from './use-inbox-page'

/** Search typing is transient state: retain one browser-history entry. */
export const replaceInboxSearch = (
  q: string | undefined,
): Parameters<InboxPageNav>[0] => ({
  to: '.',
  search: (previous) => ({ ...previous, q, itemId: undefined }),
  replace: true,
})
