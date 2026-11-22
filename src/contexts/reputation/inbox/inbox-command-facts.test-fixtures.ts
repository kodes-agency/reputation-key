import type { OrganizationId, UserId } from '#/shared/domain/ids'
import type { InboxItem } from '../domain/inbox-types'
import { inboxItemBulkStatusChanged } from '../domain/inbox-events'

/** One closed-to-open bulk status fact per item, all sharing a bulk id. */
export const bulkReopenFacts = (input: {
  items: readonly Pick<InboxItem, 'id' | 'propertyId'>[]
  organizationId: OrganizationId
  userId: UserId
  bulkId: string
  occurredAt: Date
}) =>
  input.items.map((item) =>
    inboxItemBulkStatusChanged({
      inboxItemId: item.id,
      organizationId: input.organizationId,
      propertyId: item.propertyId,
      userId: input.userId,
      oldStatus: 'closed',
      newStatus: 'open',
      bulkId: input.bulkId,
      source: 'web',
      occurredAt: input.occurredAt,
    }),
  )
