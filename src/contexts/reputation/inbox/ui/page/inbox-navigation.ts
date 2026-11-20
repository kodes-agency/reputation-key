import type { InboxQueue } from '#/contexts/inbox/application/public-api'
import { offeredListFilters } from './inbox-filter-offer'
import type { InboxPageNav } from './use-inbox-page'

/** Search typing is transient state: retain one browser-history entry. */
export const replaceInboxSearch = (
  q: string | undefined,
): Parameters<InboxPageNav>[0] => ({
  to: '.',
  search: (previous) => ({ ...previous, q, itemId: undefined }),
  replace: true,
})

/**
 * Moving into a queue. The open item does not follow (it may not belong to the
 * queue), and neither do the filters the queue does not offer: the Source
 * filter does not survive a move into a section queue, nor the topics into the
 * private feedback queues, so no choice the person cannot see is left behind in
 * the address (ADR 0057, amended 2026-10-28). Search, rating and sort stay.
 */
export const moveToInboxQueue = (queue: InboxQueue): Parameters<InboxPageNav>[0] => ({
  to: '.',
  search: (previous) => ({
    ...previous,
    ...offeredListFilters(queue, {
      sourceType: previous.sourceType,
      ratingMin: previous.ratingMin,
      ratingMax: previous.ratingMax,
      attention: previous.attention,
      aspect: previous.aspect,
      polarity: previous.polarity,
      issue: previous.issue,
      since: previous.since,
      until: previous.until,
    }),
    queue,
    itemId: undefined,
  }),
})
