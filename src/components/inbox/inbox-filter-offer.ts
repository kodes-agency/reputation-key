// Which filters the Inbox offers in which queue (ADR 0057, amended 2026-10-28).
// A filter that cannot match anything in a queue is not offered there, so the
// list never goes empty for a reason the person cannot see:
//
//   - Source (All items / Reviews / Feedback) only in the shared views (Mine,
//     Escalated, All open), which hold both kinds. A section queue already is one kind.
//   - The topics (Aspect, Polarity) never in the private feedback queues: they
//     read the analysis of a Review, which feedback has not.
//   - Priority and Rating everywhere. Priority matches the effective level (the
//     one a person set, else the AI's suggestion; ADR 0071), so it can match
//     private feedback a manager has marked.
//
// What is not offered is not applied either, so a bookmark that carries one reads
// the queue as it is, and moving into a queue drops what it cannot use.
import { queueKind } from './inbox-queues'
import type { InboxQueue } from '#/contexts/inbox/application/public-api'
import type { InboxListFilterValues } from './inbox-filters'

type InboxFilterOffer = Readonly<{
  source: boolean
  priority: boolean
  topics: boolean
  rating: boolean
}>

export function filtersOffered(queue: InboxQueue): InboxFilterOffer {
  const kind = queueKind(queue)
  return {
    source: kind === null,
    priority: true,
    topics: kind !== 'feedback',
    rating: true,
  }
}

/** The filter values the queue offers: the rest read as not chosen. */
export function offeredListFilters(
  queue: InboxQueue,
  filters: InboxListFilterValues,
): InboxListFilterValues {
  const offer = filtersOffered(queue)
  return {
    sourceType: offer.source ? filters.sourceType : undefined,
    ratingMin: offer.rating ? filters.ratingMin : undefined,
    ratingMax: offer.rating ? filters.ratingMax : undefined,
    attention: offer.priority ? filters.attention : undefined,
    aspect: offer.topics ? filters.aspect : undefined,
    polarity: offer.topics ? filters.polarity : undefined,
  }
}
