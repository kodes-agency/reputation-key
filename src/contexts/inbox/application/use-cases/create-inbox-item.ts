// Inbox context — create inbox item use case
// Ingests a new review/feedback into the inbox.

import type { InboxRepository } from '../ports/inbox.repository'
import type { UnreadCounterPort } from '../ports/unread-counter.port'
import type { EventBus } from '#/shared/events/event-bus'
import type {
  InboxItemId,
  OrganizationId,
  PropertyId,
  ReviewId,
  FeedbackId,
  UserId,
} from '#/shared/domain/ids'
import type { SourceType, InboxItem } from '../../domain/types'
import { createInboxItem } from '../../domain/constructors'
import { inboxItemCreated } from '../../domain/events'
import { inboxError } from '../../domain/errors'
import { getLogger } from '#/shared/observability/logger'

export type CreateInboxItemInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceType: SourceType
  sourceId: ReviewId | FeedbackId
  rating: number | null
  sourceDate: Date
  platform: string | null
  snippet: string | null
}>

// fallow-ignore-next-line unused-type
export type CreateInboxItemDeps = Readonly<{
  repo: InboxRepository
  events: EventBus
  unreadCounter: UnreadCounterPort
  idGen: () => InboxItemId
  clock: () => Date
}>

export const createInboxItemUseCase =
  (deps: CreateInboxItemDeps) =>
  async (input: CreateInboxItemInput): Promise<InboxItem> => {
    // 1. Check for duplicate source
    const existing = await deps.repo.findBySource(
      input.sourceType,
      input.sourceId as string,
      input.organizationId,
    )
    if (existing) {
      throw inboxError('already_exists', 'An inbox item already exists for this source', {
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      })
    }

    // 2. Build domain object
    const assignedTo: UserId | null = null
    const result = createInboxItem({
      id: deps.idGen(),
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      rating: input.rating,
      sourceDate: input.sourceDate,
      platform: input.platform,
      snippet: input.snippet,
      assignedTo,
      clock: deps.clock,
    })

    if (result.isErr()) {
      throw result.error
    }

    const item = result.value

    // 3. Persist
    await deps.repo.create(item)

    // 4. Increment unread counter (new item starts as 'new')
    try {
      await deps.unreadCounter.increment(item.organizationId)
    } catch {
      // Counter unavailable — non-critical, DB is source of truth
      getLogger().warn(
        { organizationId: item.organizationId },
        'Unread counter increment failed after inbox item creation',
      )
    }

    // 5. Emit event
    await deps.events.emit(
      inboxItemCreated({
        inboxItemId: item.id,
        organizationId: item.organizationId,
        propertyId: item.propertyId,
        sourceType: item.sourceType,
        sourceId: item.sourceId as string,
        occurredAt: item.createdAt,
      }),
    )

    // 6. Return
    return item
  }

// fallow-ignore-next-line unused-type
export type CreateInboxItemUseCase = ReturnType<typeof createInboxItemUseCase>
