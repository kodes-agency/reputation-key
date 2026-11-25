import type { HandlingCycleCreationAnchor } from './command-store.port.server'
import type { InboxItem } from '../domain/inbox-types'

/** The first-cycle anchor a Review item opens on, as the rebuild writes it. */
export const reviewOpeningAnchor = (
  item: InboxItem,
  sourceRevision = 1,
): HandlingCycleCreationAnchor => ({
  sourceRevision,
  openedReason: item.sourceType === 'review' ? 'review_observed' : 'legacy_backfill',
  actorType: 'provider',
  triggerEventId: null,
  openedAt: item.createdAt,
})
