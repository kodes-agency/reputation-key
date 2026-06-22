// Inbox context — create inbox item use case
// Ingests a new review/feedback into the inbox.

import type { InboxRepository } from '../ports/inbox.repository'
import type { NewCounterPort } from '../ports/new-counter.port'
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
import { createInboxItem as buildInboxItem } from '../../domain/constructors'
import { inboxItemCreated } from '../../domain/events'
import { inboxError } from '../../domain/errors'
import type { LoggerPort } from '#/shared/domain/logger.port'

export type CreateInboxItemInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceType: SourceType
  sourceId: ReviewId | FeedbackId
  rating: number | null
  sourceDate: Date
  platform: string | null
  snippet: string | null
  reviewerName: string | null
}>

// fallow-ignore-next-line unused-type
export type CreateInboxItemDeps = Readonly<{
  repo: InboxRepository
  events: EventBus
  newCounter: NewCounterPort
  idGen: () => InboxItemId
  clock: () => Date
  logger: LoggerPort
}>

export const createInboxItem =
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
    const result = buildInboxItem({
      id: deps.idGen(),
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      rating: input.rating,
      sourceDate: input.sourceDate,
      platform: input.platform,
      snippet: input.snippet,
      reviewerName: input.reviewerName,
      assignedTo,
      clock: deps.clock,
    })

    if (result.isErr()) {
      throw result.error
    }

    const item = result.value

    // 3. Persist
    await deps.repo.create(item, input.organizationId)

    // 4. Increment new counter (new item starts as 'new')
    try {
      await deps.newCounter.increment(item.organizationId)
    } catch (err) {
      deps.logger.warn(
        { err, organizationId: item.organizationId },
        'New counter increment failed after inbox item creation',
      )
    }

    // 5. Emit event
    await deps.events.emit(
      inboxItemCreated({
        inboxItemId: item.id,
        organizationId: item.organizationId,
        propertyId: item.propertyId,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        occurredAt: item.createdAt,
      }),
    )

    // 6. Return
    return item
  }

// fallow-ignore-next-line unused-type
export type CreateInboxItemUseCase = ReturnType<typeof createInboxItem>
