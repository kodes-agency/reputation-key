// Review context — durable reply-publication intent delivery.
//
// The worker consumer is the recovery path when a manager's reply state and
// publication intent commit, but the request process stops before the fast
// BullMQ admission. It must use the committed publication cycle as both the
// stale-intent fence and the deterministic publish-job identity.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  clearConsumers,
  listRegisteredConsumers,
  type ConsumerEvent,
} from '#/shared/outbox/consumer-registry'
import type { Reply } from '../domain/types'
import {
  handleReplyPublicationRequested,
  ON_REPLY_PUBLICATION_REQUESTED_CONSUMER,
  registerReplyPublicationConsumers,
} from './outbox-consumers'

const NOW = new Date('2026-08-26T12:00:00.000Z')
const EVENT_ID = '97000000-0000-0000-0000-000000000001'

function reply(overrides: Partial<Reply> = {}): Reply {
  return {
    id: '97000000-0000-0000-0000-000000000002' as never,
    reviewId: '97000000-0000-0000-0000-000000000003' as never,
    organizationId: 'org-publication-recovery' as never,
    text: 'Thank you for your visit.',
    replyLanguageTag: 'en',
    status: 'approved',
    source: 'internal',
    createdBy: 'manager-publication-recovery' as never,
    approvedBy: 'manager-publication-recovery' as never,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    stateRevision: 1,
    submittedAt: NOW,
    approvedAt: NOW,
    publishedAt: null,
    publicationState: 'authorized',
    publicationCycle: 4,
    publicationAttempts: 0,
    publicationLastErrorClass: null,
    reconcileDueAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function event(overrides: Partial<ConsumerEvent> = {}): ConsumerEvent {
  return {
    eventId: EVENT_ID,
    eventType: 'review.reply.publication_requested',
    eventVersion: 1,
    payload: {
      replyId: '97000000-0000-0000-0000-000000000002',
      reviewId: '97000000-0000-0000-0000-000000000003',
      propertyId: '97000000-0000-0000-0000-000000000004',
      organizationId: 'org-publication-recovery',
      userId: 'manager-publication-recovery',
      publicationCycle: 4,
      occurredAt: NOW.toISOString(),
    },
    organizationId: 'org-publication-recovery',
    propertyId: '97000000-0000-0000-0000-000000000004',
    sourceContext: 'review',
    sourceAggregateId: '97000000-0000-0000-0000-000000000003',
    occurredAt: NOW.toISOString(),
    recordedAt: NOW.toISOString(),
    correlationId: null,
    causationId: null,
    sourceAggregateVersion: null,
    region: 'unscoped',
    ...overrides,
  }
}

function deps(current: Reply | null = reply()) {
  return {
    replyRepo: { findById: vi.fn(async () => current) },
    queue: { addPublishJob: vi.fn(async () => {}) },
    receipts: { insertReceipt: vi.fn(async () => {}) },
  }
}

beforeEach(() => {
  clearEventSchemas()
  registerAllEventSchemas()
  clearConsumers()
})

afterEach(() => {
  clearConsumers()
  clearEventSchemas()
})

describe('reply publication requested durable consumer', () => {
  it('registers the governed worker consumer under its exact identity', () => {
    registerReplyPublicationConsumers(deps() as never)

    expect(listRegisteredConsumers()).toContainEqual({
      eventType: 'review.reply.publication_requested',
      consumerName: ON_REPLY_PUBLICATION_REQUESTED_CONSUMER,
    })
  })

  it('delivers the committed cycle with a deterministic job identity', async () => {
    const subject = deps()

    await expect(
      handleReplyPublicationRequested(subject as never, event()),
    ).resolves.toEqual({ status: 'applied' })

    expect(subject.queue.addPublishJob).toHaveBeenCalledWith(
      {
        replyId: '97000000-0000-0000-0000-000000000002',
        organizationId: 'org-publication-recovery',
        publicationCycle: 4,
        initiator: { kind: 'user', id: 'manager-publication-recovery' },
      },
      { idempotencyKey: 'reply-97000000-0000-0000-0000-000000000002-v4' },
    )
    expect(subject.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      ON_REPLY_PUBLICATION_REQUESTED_CONSUMER,
      'applied',
    )
  })

  it('marks a superseded cycle obsolete without admitting it', async () => {
    const subject = deps(reply({ publicationCycle: 5 }))

    await expect(
      handleReplyPublicationRequested(subject as never, event()),
    ).resolves.toEqual({ status: 'obsolete' })

    expect(subject.queue.addPublishJob).not.toHaveBeenCalled()
    expect(subject.receipts.insertReceipt).toHaveBeenCalledWith(
      EVENT_ID,
      ON_REPLY_PUBLICATION_REQUESTED_CONSUMER,
      'obsolete',
    )
  })

  it('writes no receipt when queue admission fails so delivery can retry', async () => {
    const subject = deps()
    subject.queue.addPublishJob.mockRejectedValue(new Error('queue unavailable'))

    await expect(
      handleReplyPublicationRequested(subject as never, event()),
    ).rejects.toThrow('queue unavailable')

    expect(subject.receipts.insertReceipt).not.toHaveBeenCalled()
  })
})
