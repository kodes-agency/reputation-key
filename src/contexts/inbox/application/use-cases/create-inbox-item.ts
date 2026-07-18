// Inbox context — create inbox item use case
// Ingests a new review/feedback into the inbox.

import type { InboxRepository } from '../ports/inbox.repository'
import type { InboxCommandStore } from '../ports/inbox-command-store.port'
import type {
  InboxItemId,
  OrganizationId,
  PropertyId,
  ReviewId,
  FeedbackId,
} from '#/shared/domain/ids'
import type { SourceType, InboxItem } from '../../domain/types'
import { createInboxItem as buildInboxItem } from '../../domain/constructors'
import { inboxItemCreated } from '../../domain/events'
import { inboxError } from '../../domain/errors'

export type CreateInboxItemInput = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  sourceType: SourceType
  sourceId: ReviewId | FeedbackId
  sourceDate: Date
  platform: string | null
}>

export type CreateInboxItemDeps = Readonly<{
  repo: InboxRepository
  commandStore: InboxCommandStore
  idGen: () => InboxItemId
  clock: () => Date
}>

export type CreateInboxItem = (input: CreateInboxItemInput) => Promise<InboxItem>

export const createInboxItem =
  (deps: CreateInboxItemDeps): CreateInboxItem =>
  async (input) => {
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

    // 2. Build domain object (created as 'open', escalation flag clear — ADR 0023)
    const result = buildInboxItem({
      id: deps.idGen(),
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceDate: input.sourceDate,
      platform: input.platform,
      assignedTo: null,
      clock: deps.clock,
    })

    if (result.isErr()) {
      throw result.error
    }

    const item = result.value

    // 3. Persist + record the created fact atomically (identifier-only — BQC-1.2).
    //    The store tolerates the unique source race: a conflicting concurrent
    //    insert returns created:false with no fact — same already_exists
    //    contract as the pre-check above.
    const created = await deps.commandStore.createItem(
      item,
      inboxItemCreated({
        inboxItemId: item.id,
        organizationId: item.organizationId,
        propertyId: item.propertyId,
        sourceType: item.sourceType,
        sourceId: item.sourceId,
        occurredAt: item.createdAt,
      }),
    )

    if (!created.created) {
      throw inboxError('already_exists', 'An inbox item already exists for this source', {
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      })
    }

    return created.item
  }
