import { describe, expect, it, vi } from 'vitest'
import type { ConsumerEvent } from '#/shared/outbox'
import { PrerequisiteNotReadyError } from '#/shared/outbox'
import {
  handleInboxReplyObserved,
  type InboxConsumerDeps,
} from './outbox-consumers.server'

const ORG = 'org-reply'
const PROPERTY = 'property-reply'

const event = {
  eventId: '20000000-0000-4000-8000-000000000001',
  eventType: 'review.reply.observed',
  eventVersion: 1,
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceContext: 'review',
  sourceAggregateId: 'review-1',
  payload: {
    organizationId: ORG,
    propertyId: PROPERTY,
    reviewId: 'review-1',
    occurredAt: '2026-11-16T22:13:00.000Z',
  },
} as unknown as ConsumerEvent

function makeDeps(found: { item: unknown; head: unknown }) {
  const currentObservation = { materialReviewRevision: 1 }
  const findHead = vi.fn(async () => found.head)
  const deps = {
    replyObservationAuthority: {
      withExactCurrent: vi.fn(
        async (_scope: unknown, run: (o: unknown, tx: unknown) => Promise<unknown>) => ({
          status: 'current',
          value: await run(currentObservation, {}),
        }),
      ),
    },
    inboxRepo: { findBySource: vi.fn(async () => found.item) },
    handlingCycleStore: { findHead },
    commandStore: { recordReceipt: vi.fn(), applyReplyObservedOnce: vi.fn() },
  } as unknown as InboxConsumerDeps
  return deps
}

describe('inbox.on-reply-observed ordering wait', () => {
  it('waits quietly while the Review Inbox item does not exist yet', async () => {
    const deps = makeDeps({ item: null, head: null })

    const failure = await handleInboxReplyObserved(deps, event).catch((e: unknown) => e)

    expect(failure).toBeInstanceOf(PrerequisiteNotReadyError)
    expect(failure).toMatchObject({ code: 'not_found' })
    expect(failure).toHaveProperty('message', expect.stringMatching(/Review Inbox item/))
  })

  it('waits quietly while the item has no Handling Cycle yet', async () => {
    const deps = makeDeps({ item: { id: 'item-1', organizationId: ORG }, head: null })

    const failure = await handleInboxReplyObserved(deps, event).catch((e: unknown) => e)

    expect(failure).toBeInstanceOf(PrerequisiteNotReadyError)
    expect(failure).toMatchObject({ code: 'not_found' })
    expect(failure).toHaveProperty('message', expect.stringMatching(/Handling Cycle/))
  })

  it('still fails as an ordinary error when the material revision is behind', async () => {
    const deps = makeDeps({
      item: { id: 'item-1', organizationId: ORG },
      head: { currentMaterialReviewRevision: 0 },
    })

    const failure = await handleInboxReplyObserved(deps, event).catch((e: unknown) => e)

    expect(failure).toBeInstanceOf(Error)
    expect(failure).not.toBeInstanceOf(PrerequisiteNotReadyError)
  })
})
